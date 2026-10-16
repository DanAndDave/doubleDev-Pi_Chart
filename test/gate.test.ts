import { describe, expect, test } from "bun:test";

import {
	type Batch,
	changesSource,
	decide,
	gatherPairs,
	type GateKey,
	gateLapses,
	isComplete,
	keyOf,
	LOOKS,
	type PairFigures,
	type PairRun,
	PairStop,
	pooledBatches,
	REFERENCE_MODEL,
} from "../scripts/gate.ts";
import type { Banded, RevisitScore, RunMeasures } from "../scripts/measures.ts";
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
		const decision = decide({ look: 0, pairs: constant(5, 0, 0), history: [aa(sdForBound(1.06, 0, 5), 2)], key: KEY });

		expect(decision.cost.ratioUpper).toBeCloseTo(1.06, 6);
		expect(decision.nonInferior).toBe(true);
		expect(decision.verdict).toBe("pass");
	});

	test("a first look that neither passes nor fails goes on to the second", () => {
		const decision = decide({ look: 0, pairs: constant(5, 0, 0), history: [aa(sdForBound(1.14, 0, 5), 2)], key: KEY });

		expect(decision.cost.ratioUpper).toBeCloseTo(1.14, 6);
		expect(decision.verdict).toBe("continue");
	});

	test("undecided after both looks is inconclusive", () => {
		const decision = decide({ look: 1, pairs: constant(10, 0, 0), history: [aa(sdForBound(1.14, 1, 10), 2)], key: KEY });

		expect(decision.cost.df).toBe(13);
		expect(decision.cost.ratioUpper).toBeCloseTo(1.14, 6);
		expect(decision.verdict).toBe("inconclusive");
	});

	test("a Lapse rise fails a change whose Cost is non-inferior", () => {
		const decision = decide({ look: 0, pairs: constant(5, 0, 5), history: [aa(sdForBound(1.06, 0, 5), 1)], key: KEY });

		expect(decision.nonInferior).toBe(true);
		expect(decision.lapses.rejected).toBe(true);
		expect(decision.cost.rejected).toBe(false);
		expect(decision.verdict).toBe("fail");
	});

	test("a clear Cost rise fails", () => {
		const decision = decide({ look: 0, pairs: constant(5, Math.log(1.3), 0), history: [aa(0.02, 2)], key: KEY });

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
		});

		expect(decision.cost.p).toBeCloseTo(0.03, 8);
		expect(decision.lapses.p).toBeCloseTo(0.04, 8);
		expect([decision.cost.rejected, decision.lapses.rejected]).toEqual([false, false]);
		expect(decision.verdict).not.toBe("fail");
	});

	test("a standard error of zero rejects any rise and keeps anything else", () => {
		const rise = decide({ look: 0, pairs: constant(5, 0.01, 0), history: [aa(0, 0)], key: KEY });
		const fall = decide({ look: 0, pairs: constant(5, -0.01, 0), history: [aa(0, 0)], key: KEY });

		expect([rise.cost.p, rise.lapses.p, rise.verdict]).toEqual([0, 1, "fail"]);
		expect([fall.cost.p, fall.verdict]).toEqual([1, "pass"]);
	});

	test("batches under another key are not pooled", () => {
		const other = batch("gate", pairs([1, -1, 1, -1, 1, -1]), { ...KEY, omp: "omp/18.12.0" });
		const decision = decide({ look: 0, pairs: constant(5, 0, 0), history: [aa(0.05, 2), other], key: KEY });

		expect(decision.cost.df).toBe(8);
	});
});

describe("gatherPairs", () => {
	/** A finished pair: each Run costs `cost`; the base Run completes unless `void`. */
	const finished = (index: number, cost: number, isVoid = false): PairRun => ({
		index,
		base: { cost, lapses: 20, complete: !isVoid },
		candidate: { cost, lapses: 20, complete: true },
	});
	const completeCount = (pairs: PairRun[]) => pairs.filter(isComplete).length;

	test("a void pair is replaced and its Runs count as spend", async () => {
		const gathered = await gatherPairs({
			want: 5,
			cap: 45,
			width: 2,
			runPair: async (index) => finished(index, 1, index === 2),
		});

		expect(completeCount(gathered.pairs)).toBe(5);
		expect(gathered.pairs.map((pair) => pair.index)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(gathered.spent).toBe(12);
		expect(gathered.capped).toBe(false);
	});

	test("voids that bring spend to $45.20 at 4 complete pairs stop the look", async () => {
		const started: number[] = [];
		const gathered = await gatherPairs({
			want: 5,
			cap: 45,
			width: 1,
			runPair: async (index) => {
				started.push(index);
				return finished(index, 4.52, index >= 4);
			},
		});

		expect(started).toEqual([0, 1, 2, 3, 4]);
		expect(completeCount(gathered.pairs)).toBe(4);
		expect(gathered.spent).toBeCloseTo(45.2, 10);
		expect(gathered.capped).toBe(true);
	});

	test("the second look carries the first look's pairs and spend", async () => {
		const first = await gatherPairs({ want: 5, cap: 45, width: 2, runPair: async (index) => finished(index, 1) });
		const second = await gatherPairs({ ...first, want: 10, cap: 90, width: 2, runPair: async (index) => finished(index, 1) });

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
			cap: 90,
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
			cap: 45,
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
