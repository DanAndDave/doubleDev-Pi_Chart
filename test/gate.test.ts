import { describe, expect, test } from "bun:test";

import {
	type Batch,
	changesSource,
	type ConnectionState,
	connectionRefusal,
	decide,
	gatherPairs,
	type GateKey,
	type GateRecord,
	gateLapses,
	isComplete,
	keyOf,
	LOOKS,
	lookPairs,
	MARGIN,
	mayStart,
	nextIndex,
	offModel,
	ownDatabases,
	type PairFigures,
	type PairRun,
	PairStop,
	pairEstimate,
	pooledBatches,
	REFERENCE_MODEL,
	resumeRefusal,
	runLooks,
	staleDatabases,
} from "../scripts/gate.ts";
import type { Banded, RevisitScore, RunMeasures, RunRecord } from "../scripts/measures.ts";
import { studentQuantile } from "../scripts/stats.ts";

const banded = (total: number): Banded => ({ total, bands: [total, 0, 0, 0, 0] });

/** A complete pi-chart Run's Measures with the given counts; everything the Gate does not read is empty. */
function runMeasures(counts: {
	left: number;
	recall?: number;
	recallUnknown?: number;
	lapse: number;
	leftRevisits?: number;
	refetchUnknown?: number;
	probeUnknown?: number;
}): RunMeasures {
	const revisit = { class: "left", outcome: "Pass" } as RevisitScore;
	return {
		arm: "pi-chart",
		index: 0,
		complete: true,
		turns: 40,
		calls: [],
		totals: {} as RunMeasures["totals"],
		cost: 4,
		steps: [],
		passes: 0,
		plants: [],
		probe: { lapse: banded(counts.lapse), unknown: banded(counts.probeUnknown ?? 0) },
		refetches: [],
		refetch: { held: banded(9), left: banded(counts.left), unknown: banded(counts.refetchUnknown ?? 0) },
		...(counts.recall === undefined
			? {}
			: { recall: { recall: banded(counts.recall), unknown: banded(counts.recallUnknown ?? 0) } }),
		revisits: Array.from({ length: counts.leftRevisits ?? 0 }, () => revisit),
	};
}

describe("gateLapses", () => {
	test("adds Re-fetch Lapses, recall Pulls and failed-Probe Lapses, and nothing else", () => {
		const run = runMeasures({ left: 13, recall: 6, lapse: 6, leftRevisits: 2, recallUnknown: 1, refetchUnknown: 3, probeUnknown: 2 });

		expect(gateLapses(run)).toBe(25);
	});

	test("a Run without recall figures counts its other two routes", () => {
		expect(gateLapses(runMeasures({ left: 4, lapse: 3 }))).toBe(7);
	});
});

describe("offModel", () => {
	const sonnet = "anthropic/claude-sonnet-5-5";
	const record = { model: sonnet } as RunRecord;

	test("a Run passes under the model its batch asked for, and fails under another", () => {
		expect(offModel(record, runMeasures({ left: 0, lapse: 0 }), sonnet)).toBeUndefined();
		expect(offModel(record, runMeasures({ left: 0, lapse: 0 }), REFERENCE_MODEL)).toBe(`ran on ${sonnet}, not ${REFERENCE_MODEL}`);
	});

	test("a complete Run with no recorded model fails", () => {
		expect(offModel({} as RunRecord, runMeasures({ left: 0, lapse: 0 }), sonnet)).toBe(`ran on no recorded model, not ${sonnet}`);
	});
});

const KEY: GateKey = { workload: { name: "gate", version: 1 }, model: REFERENCE_MODEL, omp: "omp/18.11.0" };

/** Pairs whose cost log ratios and Lapse differences are the given values. */
function pairs(costDiffs: number[], lapseDiffs: number[] = costDiffs.map(() => 0)): PairFigures[] {
	return costDiffs.map((d, at) => ({
		base: { cost: 4, lapses: 20 },
		candidate: { cost: 4 * Math.exp(d), lapses: 20 + (lapseDiffs[at] as number) },
	}));
}

function batch(kind: Batch["kind"], of: PairFigures[], key: GateKey = KEY): Batch {
	return { kind, key, date: "2026-10-16T00:00:00.000Z", base: "b", candidate: kind === "aa" ? "b" : "c", out: "/tmp/x", pairs: of };
}

describe("the pool", () => {
	test("a key is the Workload's name and version, the reference model and the omp version", () => {
		expect(keyOf({ name: "gate", version: 1, commit: "abc" }, "omp/18.11.0")).toEqual(KEY);
	});

	test("only batches under the current key are pooled", () => {
		const other = { ...KEY, omp: "omp/18.12.0" };
		const aa = batch("aa", pairs([0.1, -0.1, 0, 0.05, -0.05]));
		const earlier = batch("gate", pairs([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

		expect(pooledBatches([batch("aa", pairs([0, 0]), other), aa, earlier], KEY)).toEqual([aa, earlier]);
	});

	test("an A/A batch under another omp version leaves the key without one", () => {
		const pool = [batch("aa", pairs([0.1, -0.1, 0, 0.05, -0.05]), { ...KEY, omp: "omp/18.11.0" })];

		expect(() => pooledBatches(pool, { ...KEY, omp: "omp/18.12.0" })).toThrow(/no A\/A batch.*--aa/s);
	});

	test("Gate batches alone do not seed a key", () => {
		expect(() => pooledBatches([batch("gate", pairs([0, 0, 0, 0, 0]))], KEY)).toThrow(/--aa/);
	});
});

describe("decide", () => {
	/** An A/A batch of 5 pairs whose differences have sample SD `cost` and `lapses`. */
	const aa = (cost: number, lapses: number) =>
		batch("aa", pairs([-cost, cost, -cost, cost, 0], [-lapses, lapses, -lapses, lapses, 0]));
	/** `n` pairs that all differ by `cost` (log ratio) and `lapses`: they add df but no variance. */
	const constant = (n: number, cost: number, lapses: number) =>
		pairs(Array(n).fill(cost) as number[], Array(n).fill(lapses) as number[]);
	// With the A/A batch's 4 df and n constant pairs, the pooled variance is
	// 4σ² / (n + 3) on n + 3 df, and the standard error its root over n.
	const se = (sd: number, n: number) => Math.sqrt((4 * sd * sd) / (n + 3) / n);
	const critical = (look: number, n: number) => studentQuantile(1 - (LOOKS[look] as { alpha: number }).alpha, n + 3);
	/** The A/A cost SD that puts the upper bound of an even cost ratio at `bound`. */
	const sdForBound = (bound: number, look: number, n: number) => Math.log(bound) / critical(look, n) / se(1, n);

	test("a clear pass stops at the first look", () => {
		const decision = decide({ look: 0, pairs: constant(5, 0, 0), history: [aa(sdForBound(1.06, 0, 5), 2)], key: KEY, margin: MARGIN });

		expect(decision.cost.ratioUpper).toBeCloseTo(1.06, 6);
		expect(decision.nonInferior).toBe(true);
		expect(decision.verdict).toBe("pass");
	});

	test("a first look that neither passes nor fails goes on to the second", () => {
		const decision = decide({ look: 0, pairs: constant(5, 0, 0), history: [aa(sdForBound(1.14, 0, 5), 2)], key: KEY, margin: MARGIN });

		expect(decision.cost.ratioUpper).toBeCloseTo(1.14, 6);
		expect(decision.verdict).toBe("continue");
	});

	test("undecided after both looks is inconclusive", () => {
		const decision = decide({ look: 1, pairs: constant(10, 0, 0), history: [aa(sdForBound(1.14, 1, 10), 2)], key: KEY, margin: MARGIN });

		expect(decision.cost.df).toBe(13);
		expect(decision.cost.ratioUpper).toBeCloseTo(1.14, 6);
		expect(decision.verdict).toBe("inconclusive");
	});

	test("a Lapse rise fails a change whose Cost is non-inferior", () => {
		const decision = decide({ look: 0, pairs: constant(5, 0, 5), history: [aa(sdForBound(1.06, 0, 5), 1)], key: KEY, margin: MARGIN });

		expect(decision.nonInferior).toBe(true);
		expect(decision.lapses.rejected).toBe(true);
		expect(decision.cost.rejected).toBe(false);
		expect(decision.verdict).toBe("fail");
	});

	test("a clear Cost rise fails", () => {
		const decision = decide({ look: 0, pairs: constant(5, Math.log(1.3), 0), history: [aa(0.02, 2)], key: KEY, margin: MARGIN });

		expect(decision.cost.rejected).toBe(true);
		expect(decision.cost.ratio).toBeCloseTo(1.3, 10);
		expect(decision.verdict).toBe("fail");
	});

	test("Holm's correction holds back two marginal rises at the second look", () => {
		const cost = 0.05;
		const lapses = 2;
		const at = (p: number) => studentQuantile(1 - p, 13);
		const decision = decide({
			look: 1,
			pairs: constant(10, at(0.03) * se(cost, 10), at(0.04) * se(lapses, 10)),
			history: [aa(cost, lapses)],
			key: KEY,
			margin: MARGIN,
		});

		expect(decision.cost.p).toBeCloseTo(0.03, 8);
		expect(decision.lapses.p).toBeCloseTo(0.04, 8);
		expect([decision.cost.rejected, decision.lapses.rejected]).toEqual([false, false]);
		expect(decision.verdict).not.toBe("fail");
	});

	test("a standard error of zero rejects any rise and keeps anything else", () => {
		const rise = decide({ look: 0, pairs: constant(5, 0.01, 0), history: [aa(0, 0)], key: KEY, margin: MARGIN });
		const fall = decide({ look: 0, pairs: constant(5, -0.01, 0), history: [aa(0, 0)], key: KEY, margin: MARGIN });

		expect([rise.cost.p, rise.lapses.p, rise.verdict]).toEqual([0, 1, "fail"]);
		expect([fall.cost.p, fall.verdict]).toEqual([1, "pass"]);
	});

	test("batches under another key are not pooled", () => {
		const other = batch("gate", pairs([1, -1, 1, -1, 1, -1]), { ...KEY, omp: "omp/18.12.0" });
		const decision = decide({ look: 0, pairs: constant(5, 0, 0), history: [aa(0.05, 2), other], key: KEY, margin: MARGIN });

		expect(decision.cost.df).toBe(8);
	});

	test("an upper bound of 1.04 is non-inferior at the Gate's margin and not at a margin of 1", () => {
		const input = { look: 1, pairs: constant(10, 0, 0), history: [aa(sdForBound(1.04, 1, 10), 2)], key: KEY };
		const gate = decide({ ...input, margin: MARGIN });
		const cheaper = decide({ ...input, margin: 1 });

		expect(gate.cost.ratioUpper).toBeCloseTo(1.04, 6);
		expect([gate.nonInferior, gate.verdict]).toEqual([true, "pass"]);
		expect([cheaper.margin, cheaper.nonInferior, cheaper.verdict]).toEqual([1, false, "inconclusive"]);
	});
});

/** A finished pair: each Run costs `cost`; the base Run completes unless `void`. */
const finished = (index: number, cost: number, isVoid = false): PairRun => ({
	index,
	base: { cost, lapses: 20, complete: !isVoid },
	candidate: { cost, lapses: 20, complete: true },
});
const completeCount = (pairs: PairRun[]) => pairs.filter(isComplete).length;

describe("gatherPairs", () => {
	test("a void pair is replaced and its Runs count as spend", async () => {
		const gathered = await gatherPairs({
			want: 5,
			cap: 55,
			width: 2,
			runPair: async (index) => finished(index, 1, index === 2),
		});

		expect(completeCount(gathered.pairs)).toBe(5);
		expect(gathered.pairs.map((pair) => pair.index)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(gathered.spent).toBe(12);
		expect(gathered.capped).toBe(false);
	});

	test("voids that bring spend to $55.20 at 4 complete pairs stop the look", async () => {
		const started: number[] = [];
		const gathered = await gatherPairs({
			want: 5,
			cap: 55,
			width: 1,
			runPair: async (index) => {
				started.push(index);
				return finished(index, 5.52, index >= 4);
			},
		});

		expect(started).toEqual([0, 1, 2, 3, 4]);
		expect(completeCount(gathered.pairs)).toBe(4);
		expect(gathered.spent).toBeCloseTo(55.2, 10);
		expect(gathered.capped).toBe(true);
	});

	test("the second look carries the first look's pairs and spend", async () => {
		const first = await gatherPairs({ want: 5, cap: 55, width: 2, runPair: async (index) => finished(index, 1) });
		const second = await gatherPairs({ ...first, want: 10, cap: 110, width: 2, runPair: async (index) => finished(index, 1) });

		expect(second.pairs.map((pair) => pair.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(second.spent).toBe(20);
	});

	/** Lets every pending promise callback run, so the loop under test reaches its next wait. */
	const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

	test("no more than `width` pairs are ever in flight", async () => {
		const waiting = new Map<number, () => void>();
		let inFlight = 0;
		let most = 0;
		let finishedAll = false;
		const gathering = gatherPairs({
			want: 6,
			cap: 110,
			width: 2,
			runPair: async (index) => {
				most = Math.max(most, ++inFlight);
				const { promise, resolve } = Promise.withResolvers<void>();
				waiting.set(index, resolve);
				await promise;
				inFlight--;
				return finished(index, 1);
			},
		}).then(() => {
			finishedAll = true;
		});

		// Finish the pairs out of order: the later of the two in flight first.
		while (!finishedAll) {
			await settle();
			const latest = Math.max(...waiting.keys());
			waiting.get(latest)?.();
			waiting.delete(latest);
		}
		await gathering;

		expect(most).toBe(2);
	});

	test("a pair that stops lets the pairs in flight finish, starts no other, and returns what finished", async () => {
		const started: number[] = [];
		const first = Promise.withResolvers<void>();
		let settled = false;
		const gathering = gatherPairs({
			want: 5,
			cap: 55,
			width: 2,
			runPair: async (index) => {
				started.push(index);
				if (index === 1) throw new PairStop("model mismatch", 3);
				await first.promise;
				return finished(index, 1);
			},
		});
		gathering.finally(() => {
			settled = true;
		});

		await settle();
		expect(settled).toBe(false);
		first.resolve();

		const gathered = await gathering;
		expect(started).toEqual([0, 1]);
		expect((gathered.stopped as Error).message).toBe("model mismatch");
		expect(gathered.pairs.map((pair) => pair.index)).toEqual([0]);
		// Pair 0's two Runs at $1, and the $3 the stopping pair's Runs cost.
		expect(gathered.spent).toBe(5);
		expect(gathered.capped).toBe(false);
	});

	test("a pair projected to cross the cap does not start", async () => {
		const started: number[] = [];
		const gathered = await gatherPairs({
			want: 10,
			cap: 55,
			width: 2,
			estimate: () => 9.6,
			runPair: async (index) => {
				started.push(index);
				return finished(index, 4.8);
			},
		});

		// Five $9.60 pairs project to $48.00; a sixth would make $57.60.
		expect(started).toEqual([0, 1, 2, 3, 4]);
		expect(gathered.spent).toBeCloseTo(48, 10);
		expect(gathered.capped).toBe(true);
	});

	test("without an estimate a pair starts while spend is below the cap", async () => {
		const started: number[] = [];
		const gathered = await gatherPairs({
			want: 10,
			cap: 55,
			width: 2,
			runPair: async (index) => {
				started.push(index);
				return finished(index, 4.8);
			},
		});

		// The same $9.60 pairs run on past five, and spend passes the cap.
		expect(started.length).toBeGreaterThan(5);
		expect(gathered.spent).toBeGreaterThan(55);
	});

	test("an estimate that has none keeps the spend-only rule", async () => {
		const started: number[] = [];
		const gathered = await gatherPairs({
			want: 10,
			cap: 55,
			width: 2,
			estimate: () => undefined,
			runPair: async (index) => {
				started.push(index);
				return finished(index, 4.8);
			},
		});

		expect(started.length).toBeGreaterThan(5);
		expect(gathered.spent).toBeGreaterThan(55);
	});

	test("the pool's median is the estimate until the Gate's own first pair finishes", async () => {
		// Pooled pairs cost $30, so a second pair ($60 projected) waits for the first; it costs $2.
		const pool = [batch("aa", [0, 1, 2].map(() => ({ base: { cost: 15, lapses: 0 }, candidate: { cost: 15, lapses: 0 } })))];
		const finishedAtStart: number[] = [];
		let finishedCount = 0;
		const gathered = await gatherPairs({
			want: 5,
			cap: 55,
			width: 2,
			estimate: (pairs) => pairEstimate(pairs, pool, KEY),
			runPair: async (index) => {
				finishedAtStart.push(finishedCount);
				await Promise.resolve();
				finishedCount++;
				return finished(index, 1);
			},
		});

		expect(finishedAtStart.slice(0, 2)).toEqual([0, 1]);
		expect(completeCount(gathered.pairs)).toBe(5);
		expect(gathered.spent).toBe(10);
	});

	test("each settled pair is reported before its slot refills, a stopping pair included", async () => {
		const started: number[] = [];
		const reports: { pairs: number[]; spent: number; next: number; stopped?: string; startedSoFar: number }[] = [];
		const gathered = await gatherPairs({
			want: 3,
			cap: 110,
			width: 1,
			runPair: async (index) => {
				started.push(index);
				if (index === 1) throw new PairStop("base-1 could not export its Accounting", 3);
				return finished(index, 1);
			},
			settled: async ({ pairs, spent, next, stopped }) => {
				reports.push({
					pairs: pairs.map((pair) => pair.index),
					spent,
					next,
					...(stopped ? { stopped: (stopped as Error).message } : {}),
					startedSoFar: started.length,
				});
			},
		});

		expect(reports).toEqual([
			{ pairs: [0], spent: 2, next: 1, startedSoFar: 1 },
			{ pairs: [0], spent: 5, next: 2, stopped: "base-1 could not export its Accounting", startedSoFar: 2 },
		]);
		expect(gathered.next).toBe(2);
	});

	test("a report that fails stops the gathering", async () => {
		const started: number[] = [];
		const gathered = await gatherPairs({
			want: 3,
			cap: 110,
			width: 1,
			runPair: async (index) => {
				started.push(index);
				return finished(index, 1);
			},
			settled: async () => {
				throw new Error("disk full");
			},
		});

		expect(started).toEqual([0]);
		expect((gathered.stopped as Error).message).toBe("disk full");
		expect(gathered.pairs.map((pair) => pair.index)).toEqual([0]);
	});

	test("carried pairs, spend and next index seed the gathering", async () => {
		const started: number[] = [];
		const gathered = await gatherPairs({
			want: 3,
			cap: 110,
			width: 1,
			pairs: [finished(0, 1)],
			spent: 5,
			next: 5,
			runPair: async (index) => {
				started.push(index);
				return finished(index, 1);
			},
		});

		expect(started).toEqual([5, 6]);
		expect(gathered.pairs.map((pair) => pair.index)).toEqual([0, 5, 6]);
		expect(gathered.spent).toBe(9);
		expect(gathered.next).toBe(7);
	});
});

describe("the projected cap", () => {
	test("a pair starts only when spend and every pair in flight, at the estimate, stay within the cap", () => {
		expect(mayStart({ spent: 38.4, inFlight: 1, cap: 55, estimate: 9.6 })).toBe(false);
		expect(mayStart({ spent: 19.2, inFlight: 1, cap: 55, estimate: 9.6 })).toBe(true);
		expect(mayStart({ spent: 35, inFlight: 1, cap: 55, estimate: 10 })).toBe(true);
	});

	test("without an estimate spend alone is checked", () => {
		expect(mayStart({ spent: 54.9, inFlight: 5, cap: 55 })).toBe(true);
		expect(mayStart({ spent: 55, inFlight: 0, cap: 55 })).toBe(false);
	});

	const figures = (base: number, candidate: number): PairFigures => ({ base: { cost: base, lapses: 0 }, candidate: { cost: candidate, lapses: 0 } });

	test("the estimate is the median pair cost of the Gate's own finished pairs, void ones included", () => {
		const pool = [batch("aa", [figures(50, 50)])];

		expect(pairEstimate([finished(0, 4.8), finished(1, 5.25), finished(2, 2, true)], pool, KEY)).toBeCloseTo(9.6, 10);
	});

	test("before the Gate has a pair, the estimate is the median over the pool's pairs under its key", () => {
		const pool = [
			batch("aa", [figures(4.5, 4.5), figures(5, 5)]),
			batch("gate", [figures(5.5, 5.5)]),
			batch("aa", [figures(100, 100)], { ...KEY, omp: "omp/18.13.0" }),
		];

		expect(pairEstimate([], pool, KEY)).toBe(10);
		expect(pairEstimate([], [], KEY)).toBeUndefined();
	});
});

describe("resuming", () => {
	const options = { workload: { name: "gate", version: 1, commit: "w" }, model: REFERENCE_MODEL, turns: 40, omp: KEY.omp };
	const record = (over: Partial<GateRecord> = {}): GateRecord => ({
		kind: "aa",
		base: "b",
		candidate: "b",
		key: KEY,
		options,
		workload: "gate",
		pool: "/tmp/pool.json",
		parallel: 2,
		turnTimeout: 600,
		pairs: [finished(0, 4.8)],
		spent: 19.2,
		next: 2,
		cap: 55,
		capped: false,
		looks: [],
		...over,
	});
	const current = { omp: KEY.omp, workload: options.workload };

	test("a stopped run, and one that crashed before it recorded why, resume", () => {
		expect(resumeRefusal(record({ stopped: "base-1: too many clients" }), current)).toBeUndefined();
		expect(resumeRefusal(record(), current)).toBeUndefined();
	});

	test("a run that ended is not resumed", () => {
		expect(resumeRefusal(record({ ended: true, verdict: "pass" }), current)).toBeDefined();
	});

	test("a record from before resume existed ended unless it stopped", () => {
		const { next: _next, ...legacy } = record();

		expect(resumeRefusal(legacy, current)).toBeDefined();
		expect(resumeRefusal({ ...legacy, stopped: "base-0: too many clients" }, current)).toBeUndefined();
	});

	test("a new omp or Workload version refuses, naming both", () => {
		const omp = resumeRefusal(record({ stopped: "x" }), { ...current, omp: "omp/18.13.0" });
		const workload = resumeRefusal(record({ stopped: "x" }), { ...current, workload: { ...options.workload, version: 2 } });

		expect(omp).toContain(KEY.omp);
		expect(omp).toContain("omp/18.13.0");
		expect(workload).toContain("gate v1");
		expect(workload).toContain("gate v2");
	});

	test("the next pair index is past every recorded pair, the recorded index and every runs/ folder", () => {
		const pairs = [finished(0, 1), finished(1, 1)];

		expect(nextIndex({ pairs, next: 3 }, ["base-0", "candidate-0", "base-4", "candidate-4", "notes.txt"])).toBe(5);
		expect(nextIndex({ pairs: [finished(0, 1), finished(2, 1)] }, ["base-3"])).toBe(4);
		expect(nextIndex({ pairs: [], next: 0 }, [])).toBe(0);
	});

	test("a look decides on the first complete pairs by index", () => {
		const pairs = [finished(3, 1), finished(0, 1), finished(1, 9, true), finished(2, 2), finished(4, 3), finished(5, 4)];

		expect(lookPairs(pairs, 3).map((pair) => pair.base.cost)).toEqual([1, 2, 1]);
	});

	/** An A/A batch wide enough that 5 even pairs neither fail nor pass. */
	const history = [batch("aa", pairs([-0.3, 0.3, -0.3, 0.3, 0]))];

	test("a resumed Gate carries its pairs, spend and next index, and recomputes its first look", async () => {
		// Pair 3 was void and pair 8 stopped the Gate during its second look.
		const carried = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => finished(index, 4.8, index === 3));
		const started: number[] = [];
		const outcome = await runLooks({
			aa: false,
			history,
			key: KEY,
			width: 2,
			carried: { pairs: carried, spent: 81.6, next: 9 },
			runPair: async (index) => {
				started.push(index);
				return finished(index, 4.8);
			},
		});

		expect(started).toEqual([9, 10, 11]);
		expect(outcome.spent).toBeCloseTo(81.6 + 3 * 9.6, 10);
		expect(outcome.next).toBe(12);
		expect(outcome.looks.map((look) => look.pairs)).toEqual([5, 10]);
		expect(outcome.looks[0]).toEqual(decide({ look: 0, pairs: lookPairs(carried, 5), history, key: KEY, margin: MARGIN }));
		expect(outcome.looks[0]?.verdict).toBe("continue");
		expect(outcome.verdict).toBe(outcome.looks[1]?.verdict);
	});

	test("a resumed A/A run starts past its stopped pair and gathers its 5 complete pairs", async () => {
		const started: number[] = [];
		const outcome = await runLooks({
			aa: true,
			history: [],
			key: KEY,
			width: 1,
			carried: { pairs: [finished(0, 4.8)], spent: 19.2, next: 2 },
			runPair: async (index) => {
				started.push(index);
				return finished(index, 4.8);
			},
		});

		expect(started).toEqual([2, 3, 4, 5]);
		expect(completeCount(outcome.pairs)).toBe(5);
		expect(outcome.spent).toBeCloseTo(19.2 + 4 * 9.6, 10);
		expect(outcome.looks).toEqual([]);
		expect(outcome.verdict).toBeUndefined();
	});
});

describe("the server", () => {
	const busy: ConnectionState = {
		max: 100,
		superuserReserved: 3,
		reserved: 0,
		clients: 51,
		holders: [
			{ application: "", user: "pi_chart", database: "thread_store", count: 50 },
			{ application: "psql", user: "pi_chart", database: "thread_store", count: 1 },
		],
	};

	test("a Gate the free connections cannot hold is refused, naming free, needed and the holders", () => {
		const refusal = connectionRefusal(busy, 2);

		expect(refusal).toContain("46 free");
		expect(refusal).toContain("48 needed");
		expect(refusal).toContain("50 by no application name as pi_chart on thread_store");
		expect(refusal).toContain("1 by psql as pi_chart on thread_store");
	});

	test("a Gate the free connections hold may start", () => {
		expect(connectionRefusal(busy, 1)).toBeUndefined();
	});

	test("reserved connections are not free", () => {
		expect(connectionRefusal({ ...busy, reserved: 23 }, 1)).toContain("23 free");
	});

	test("only Run databases stamped more than 24 hours ago are stale", () => {
		const now = Date.UTC(2026, 9, 27, 21, 20);
		const day = 24 * 60 * 60 * 1000;
		const names = [
			"bench_1792117753912_pi_chart_0",
			`bench_${now - 60 * 60 * 1000}_base_0`,
			`bench_${now - day}_base_1`,
			`bench_${now - day - 1}_base_2`,
			"bench_1000000000000_smoke_0",
			"thread_store",
			"pcval_1793135880353",
			"postgres",
			"bench_179211775391_base_0",
			"bench_1792117753912_Base-0",
			"xbench_1792117753912_base_0",
		];

		expect(staleDatabases(names, now)).toEqual(["bench_1792117753912_pi_chart_0", `bench_${now - day - 1}_base_2`, "bench_1000000000000_smoke_0"]);
	});

	test("a Gate's own Run databases carry exactly its stamp", () => {
		const names = [
			"bench_1793135880353_base_0",
			"bench_1793135880353_candidate_1",
			"bench_1793135880354_base_0",
			"bench_17931358803530_base_0",
			"thread_store",
		];

		expect(ownDatabases(names, 1793135880353)).toEqual(["bench_1793135880353_base_0", "bench_1793135880353_candidate_1"]);
	});
});

describe("changesSource", () => {
	test("a change that touches nothing under src/ needs no Gate", async () => {
		// These commits differ under bench/, openspec/, scripts/ and test/ only.
		expect(await changesSource("7ef6898", "3b4304b")).toBe(false);
	});

	test("a change under src/ does", async () => {
		expect(await changesSource("352b5d1~1", "352b5d1")).toBe(true);
	});
});
