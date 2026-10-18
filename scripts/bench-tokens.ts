/**
 * Benchmarks a Conversation with pi-chart against plain oh-my-pi, on a frozen
 * Workload (`bench/workloads/<name>/`, see `scripts/workload.ts`).
 *
 * Two Arms:
 *
 * - **vanilla**: `omp --no-extensions`, the harness's accumulate-forward window.
 * - **pi-chart**: `omp --no-extensions -e src/extension.ts`, this checkout's
 *   extension alone, so the only difference between the Arms is pi-chart.
 *   `scripts/run-url-set.ts` and `run-url-unset.ts` load either side of it,
 *   to keep the Run's database out of the agent's shell.
 *
 * Every Run starts from the same bytes: the Workload's pinned commit without
 * `bench/`, its overlay, its frozen `graphify-out/`, and dependencies
 * installed from the workspace's own lockfile. That tree is built once per
 * benchmark and copied into each Run's workspace (about 1 GB under $TMPDIR
 * per Run in flight). The user's own database and bundle are never touched;
 * every other `PICHART_*` setting in the environment reaches both Arms, and
 * a pi-chart Run's record names any tunable Budget it set. How a Run goes, Turn by Turn,
 * with its own bundle and Thread Store database, is `scripts/runs.ts`,
 * which the Gate (`scripts/gate.ts`) shares. Prompts are sent exactly as
 * the Workload states them.
 *
 * Each Run leaves a record in `<out>/runs/<arm>-<index>/`, and its Measures
 * come from that record alone (`scripts/measures.ts`), so they can be
 * recomputed later at no model cost. `<out>/bench.json` holds the options and
 * every Run's record and Measures.
 *
 *     bun scripts/bench-tokens.ts                          # read-only-40, 3 Runs per Arm
 *     bun scripts/bench-tokens.ts --workload smoke --runs 1
 *     bun scripts/bench-tokens.ts --runs 5 --parallel 4 --model sonnet
 *     bun scripts/bench-tokens.ts --workload ./my-workload --arm pi-chart
 *     bun scripts/bench-tokens.ts --report /tmp/pichart-bench-1789…   # re-print
 *     bun scripts/bench-tokens.ts --sweep grid.json        # a Budget sweep: scripts/sweep.ts
 *
 * `--report <dir>` re-prints a sweep from `<dir>/sweep.json` when there is one.
 *
 * `--workload` takes a name under `bench/workloads/`, or a path (anything
 * with a `/`). `--turns N` sends the first N prompts; a step cut short is not
 * checked. `--out` names the output directory. `--arm` runs one Arm alone.
 * pi-chart Runs need the Thread Store server: `PICHART_DATABASE_URL`, else
 * the URL setup saved.
 *
 * Not counted: anything charged outside the provider's `usage`, such as the
 * local embedder.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readSavedUrl } from "../src/config.ts";
import {
	aggregate,
	BANDS,
	bandLabel,
	EARLY_TURNS,
	int,
	median,
	percent,
	POSITIONS,
	probeKey,
	READ_RATE,
	REVISIT_CLASSES,
	REVISIT_POSITIONS,
	type Banded,
	type RecallClass,
	type RefetchClass,
	type RunMeasures,
	type RunRecord,
	type ScoreClass,
	SOURCES,
	usd,
	WRITE_RATE,
} from "./measures.ts";
import { PULL_TOOLS } from "./units.ts";
import { armHolds, CAVEATS, JUDGED_KINDS, KIND_LABEL, share, type Tally as UsedTally, utilisationLabel } from "./utilisation.ts";
import { type Arm, ARMS, buildContext, flagsOf, loadNamedWorkload, log, type Options, pool, runOne, srcIsCommitted } from "./runs.ts";
import { runSweep, sweepReport } from "./sweep.ts";
import { REPO, run, turnsOf } from "./workload.ts";

/** `bench.json`. */
interface Bench {
	options: Options;
	runs: { record: RunRecord; measures: RunMeasures }[];
}

// ------------------------------------------------------------------ args --

const { flag, positive } = flagsOf(process.argv.slice(2));

// ---------------------------------------------------------------- report --

function report(bench: Bench): void {
	const all = bench.runs.map((run) => run.measures);
	const arms = aggregate(all);
	const present = ARMS.filter((arm) => arms.has(arm));
	const both = present.length === ARMS.length;
	const complete = (arm: Arm) => arms.get(arm)?.complete ?? [];
	const { workload, turns } = bench.options;
	const distinct = (values: (string | undefined)[]) =>
		[...new Set(values.map((value) => value ?? "(unknown)"))].join(", ");
	const excluded = present.reduce((acc, arm) => acc + (arms.get(arm)?.excluded ?? 0), 0);

	console.log(
		`\nWorkload ${workload.name} v${workload.version} (${workload.commit.slice(0, 7)}), ` +
			`model ${distinct(bench.runs.map((run) => run.record.model))}, ${bench.options.omp}, ` +
			`thinking ${bench.options.thinking ?? "(default)"}, ${turns} Turns; ` +
			`complete Runs: ${present.map((arm) => `${arm} ${complete(arm).length}`).join(", ")}` +
			(excluded > 0 ? ` (${excluded} failed, excluded)` : ""),
	);

	const header = (first: string) => {
		console.log(`| ${first} | ${present.join(" | ")} |${both ? " pi-chart / vanilla |" : ""}`);
		console.log(`| --- | ${present.map(() => "---:").join(" | ")} |${both ? " ---: |" : ""}`);
	};

	// A pick gives `undefined` for a Measure the Run's Arm does not have:
	// that Arm reads "n/a", and the row has no ratio. NaN is a figure
	// the record lacks, as in a `bench.json` older than the Measure.
	const figure = (arm: Arm, pick: (run: RunMeasures) => number | undefined): number | "n/a" => {
		const picked = complete(arm).map(pick);
		return picked.length > 0 && picked.every((value) => value === undefined)
			? "n/a"
			: median(picked.map((value) => value ?? Number.NaN));
	};
	const shown = (value: number | "n/a", show: (x: number) => string) => (value === "n/a" ? value : show(value));
	const rows: [string, (run: RunMeasures) => number | undefined, (x: number) => string][] = [
		["Calls", (r) => r.totals.calls, int],
		["Prompt tokens sent (input + cache read + cache write)", (r) => r.totals.prompt, int],
		["Uncached input", (r) => r.totals.input, int],
		["Cache read", (r) => r.totals.cacheRead, int],
		["Cache write", (r) => r.totals.cacheWrite, int],
		["Output", (r) => r.totals.output, int],
		[`Effective input (read ×${READ_RATE}, write ×${WRITE_RATE})`, (r) => r.totals.effective, int],
		["Cost per Run, USD (harness pricing)", (r) => r.totals.cost, usd],
		["Peak window, tokens", (r) => r.totals.peak, int],
		["Floor, tokens", (r) => r.totals.floor, int],
		[`Cache write, Turns 1–${EARLY_TURNS}`, (r) => r.totals.earlyWrite, int],
		[`Prefix held, Turns 1–${EARLY_TURNS} (next Call read all the last read or wrote)`, (r) => r.totals.prefixHeld, percent],
		// Absent on pi-chart and in an older `bench.json` alike; `refetch`,
		// which came with it on every Arm, tells the older record apart.
		["Compactions", (r) => (r.refetch === undefined ? Number.NaN : r.compactions), int],
	];
	console.log("\nPer Conversation, median over complete Runs:\n");
	header("Measure");
	for (const [label, pick, show] of rows) {
		const values = present.map((arm) => figure(arm, pick));
		const cells = values.map((value) => shown(value, show)).join(" | ");
		if (!both) {
			console.log(`| ${label} | ${cells} |`);
			continue;
		}
		const [v, p] = values;
		const ratio =
			v === "n/a" || p === "n/a"
				? "n/a"
				: v !== undefined && p !== undefined && v > 0 && Number.isFinite(p)
					? `${(p / v).toFixed(2)}×`
					: "—";
		console.log(`| ${label} | ${cells} | ${ratio} |`);
	}

	// Plain omp has no Pull tool: its Pull figures do not exist, and read
	// "n/a". A pi-chart record older than them lacks them, and reads "—".
	const pulled = (pick: (run: RunMeasures) => number | undefined) => (run: RunMeasures) =>
		run.arm === "pi-chart" ? (pick(run) ?? Number.NaN) : undefined;
	console.log("\nPulls per Run, median over complete Runs:\n");
	console.log(`| Tool | ${present.map((arm) => `${arm} calls | ${arm} tokens returned`).join(" | ")} |`);
	console.log(`| --- | ${present.map(() => "---: | ---:").join(" | ")} |`);
	for (const tool of PULL_TOOLS) {
		const cells = present.map(
			(arm) =>
				`${shown(figure(arm, pulled((r) => r.pulls?.[tool].calls)), int)} | ` +
				shown(figure(arm, pulled((r) => r.pulls?.[tool].tokens)), int),
		);
		console.log(`| ${tool} | ${cells.join(" | ")} |`);
	}
	// A write adds nothing to the window: there are no tokens returned to count.
	const writes = present.map((arm) => `${shown(figure(arm, pulled((r) => r.writes)), int)} | n/a`);
	console.log(`| write_documentation (not a Pull) | ${writes.join(" | ")} |`);

	// Each Run's own share, then the median: a kind the Arm cannot hold is
	// `undefined` ("n/a"); a Run with no judged tokens of it, or a
	// `bench.json` older than Utilisation, gives NaN ("—"). No ratio column:
	// a ratio of shares invites reading one Arm as more Needed.
	const used = (tally: UsedTally | undefined) => (tally ? share(tally) : Number.NaN);
	console.log(
		`\nUtilisation per Run (${utilisationLabel(present.flatMap((arm) => complete(arm).map((run) => run.utilisation)))}), median over complete Runs:\n`,
	);
	console.log(`| Judged | ${present.join(" | ")} |`);
	console.log(`| --- | ${present.map(() => "---:").join(" | ")} |`);
	const utilisationRows: [string, (run: RunMeasures) => number | undefined][] = [
		["Total", (r) => used(r.utilisation)],
		...JUDGED_KINDS.map((kind): [string, (run: RunMeasures) => number | undefined] => [
			KIND_LABEL[kind],
			(r) => (armHolds(r.arm, kind) ? used(r.utilisation?.byKind[kind]) : undefined),
		]),
	];
	for (const [label, pick] of utilisationRows) {
		console.log(`| ${label} | ${present.map((arm) => shown(figure(arm, pick), percent)).join(" | ")} |`);
	}
	console.log(`\n${CAVEATS.join(" ")}`);

	type BandColumn = { arm: Arm; name: string; count: (run: RunMeasures, of: (banded: Banded) => number | undefined) => number | undefined };
	const refetched = (kind: RefetchClass) => (run: RunMeasures, of: (banded: Banded) => number | undefined) =>
		// `refetch` is absent from a `bench.json` older than the Measure: "—".
		run.refetch ? (of(run.refetch[kind]) ?? Number.NaN) : Number.NaN;
	const recalled = (kind: RecallClass) => (run: RunMeasures, of: (banded: Banded) => number | undefined) =>
		run.arm === "pi-chart" ? (run.recall ? (of(run.recall[kind]) ?? Number.NaN) : Number.NaN) : undefined;
	const probed = (kind: Extract<ScoreClass, "lapse" | "unknown">) =>
		(run: RunMeasures, of: (banded: Banded) => number | undefined) =>
			// `probe` is absent from a `bench.json` older than the Measure: "—".
			run.probe ? (of(run.probe[kind]) ?? Number.NaN) : Number.NaN;
	console.log("\nRe-fetches, recall Pulls and failed Probes per Run by distance band, median over complete Runs:\n");
	const columns: BandColumn[] = present.flatMap((arm) => [
		{ arm, name: "held", count: refetched("held") },
		{ arm, name: "Lapses", count: refetched("left") },
		{ arm, name: "unknown", count: refetched("unknown") },
		{ arm, name: "recall", count: recalled("recall") },
		{ arm, name: "recall unknown", count: recalled("unknown") },
		{ arm, name: "failed Probe", count: probed("lapse") },
		{ arm, name: "failed Probe unknown", count: probed("unknown") },
	]);
	console.log(`| Distance, Turns | ${columns.map(({ arm, name }) => `${arm} ${name}`).join(" | ")} |`);
	console.log(`| --- | ${columns.map(() => "---:").join(" | ")} |`);
	const bandRow = (label: string, of: (banded: Banded) => number | undefined) => {
		const cell = ({ arm, count }: BandColumn) => shown(figure(arm, (run) => count(run, of)), int);
		console.log(`| ${label} | ${columns.map(cell).join(" | ")} |`);
	};
	for (const [at, band] of BANDS.entries()) bandRow(bandLabel(band), (banded) => banded.bands[at]);
	bandRow("Total", (banded) => banded.total);
	console.log(
		"\nEach row is its own median, so the bands need not sum to the Total row. " +
			"A recall Pull unknown with no Turn on record counts in the Total only.",
	);
	if (both) {
		console.log(
			"Lapses are recovered by different routes: plain omp only through Re-fetches, " +
				"pi-chart through Re-fetches and recall Pulls. Failed Probes are Lapses neither Arm recovered. " +
				"None of the three is added to another. " +
				"Plain omp's recall reads n/a because it has no recall tool, not because it had no Lapses.",
		);
	}

	const stepIds = [
		...new Set(
			present.flatMap((arm) =>
				complete(arm).flatMap((run) => run.steps.filter((s) => s.outcome !== "not graded").map((s) => s.id)),
			),
		),
	];
	console.log("\nGraded Tasks (Passes over complete Runs):\n");
	if (stepIds.length === 0) {
		console.log("No graded step within the Turns sent.");
	} else {
		console.log(`| Step | ${present.join(" | ")} |`);
		console.log(`| --- | ${present.map(() => "---:").join(" | ")} |`);
		for (const id of stepIds) {
			const cell = (arm: Arm) => {
				const runs = complete(arm);
				const passed = runs.filter((run) => run.steps.some((s) => s.id === id && s.outcome === "Pass"));
				return `${passed.length}/${runs.length}`;
			};
			console.log(`| ${id} | ${present.map(cell).join(" | ")} |`);
		}
	}

	console.log("\nCost per Pass:\n");
	for (const arm of present) {
		const value = arms.get(arm)?.costPerPass ?? "n/a";
		console.log(`- ${arm}: ${typeof value === "string" ? value : usd(value.usd)}`);
	}

	// An Arm whose `bench.json` predates a breakdown has no figures for it: "—".
	type Tally = { right: number; of: number } | undefined;
	const ratio = (tally: Tally) => (tally ? `${tally.right}/${tally.of}` : "—");
	const breakdown = (title: string, column: string, rows: [string, (arm: Arm) => Tally][]) => {
		console.log(`\n${title}:\n`);
		console.log(`| ${column} | ${present.join(" | ")} |`);
		console.log(`| --- | ${present.map(() => "---:").join(" | ")} |`);
		for (const [label, pick] of rows) {
			const tallies = present.map(pick);
			// A row only where some Arm scored; "—" from an older record keeps its row.
			if (tallies.every((tally) => tally?.of === 0)) continue;
			console.log(`| ${label} | ${tallies.map(ratio).join(" | ")} |`);
		}
	};

	const probes = [
		...new Map(present.flatMap((arm) => arms.get(arm)?.retention ?? []).map((probe) => [probeKey(probe), probe])).values(),
	].sort((a, b) => a.turn - b.turn);
	console.log("\nRetention per Probe (complete Runs whose Probe answered the Plant correctly):\n");
	if (probes.length === 0) {
		console.log("No Probe within the Turns sent.");
	} else {
		console.log(`| Plant | Kind | Probe Turn | Tools | ${present.join(" | ")} |`);
		console.log(`| --- | --- | ---: | --- | ${present.map(() => "---:").join(" | ")} |`);
		for (const probe of probes) {
			const { id, kind, turn, tools } = probe;
			const cell = (arm: Arm) => {
				const retention = arms.get(arm)?.retention.find((r) => probeKey(r) === probeKey(probe));
				return retention ? `${retention.right}/${retention.of}` : "—";
			};
			console.log(
				`| ${id} | ${kind} | ${turn + 1} | ${tools === false ? "forbidden" : "allowed"} | ${present.map(cell).join(" | ")} |`,
			);
		}

		breakdown(
			"Retention by distance band",
			"Distance, Turns",
			BANDS.map((band, at) => [bandLabel(band), (arm) => arms.get(arm)?.byBand?.[at]]),
		);
		breakdown(
			"Retention by position",
			"Position",
			POSITIONS.map((position) => [position, (arm) => arms.get(arm)?.byPosition?.[position]]),
		);

		console.log("\nAnswer sources (scores right and wrong, over complete Runs):\n");
		console.log(`| Source | ${present.map((arm) => `${arm} right | ${arm} wrong`).join(" | ")} |`);
		console.log(`| --- | ${present.map(() => "---: | ---:").join(" | ")} |`);
		for (const source of SOURCES) {
			const counts = present.map((arm) => arms.get(arm)?.sources?.[source]);
			if (counts.every((count) => count && count.right + count.wrong === 0)) continue;
			const cells = counts.map((count) => (count ? `${count.right} | ${count.wrong}` : "— | —"));
			console.log(`| ${source} | ${cells.join(" | ")} |`);
		}
		const tallied = present.map((arm) => {
			const counts = arms.get(arm)?.counts;
			return counts
				? `${arm} ${counts.leak} leak${counts.leak === 1 ? "" : "s"}, ${counts.despite} wrong despite a source, ` +
						`${counts.stale} stale, ${counts.breach} breach${counts.breach === 1 ? "" : "es"}`
				: `${arm} —`;
		});
		console.log(`\n${tallied.join("; ")}.`);
	}

	const revisitFigures = (arm: Arm) => arms.get(arm)?.revisits;
	const revisits = [
		...new Map(present.flatMap((arm) => revisitFigures(arm)?.each ?? []).map((each) => [each.id, each])).values(),
	];
	console.log("\nRevisit scores (complete Runs per class):\n");
	if (!present.some((arm) => revisitFigures(arm))) {
		console.log("— Revisits were not scored for these Runs.");
	} else if (revisits.length === 0) {
		console.log("No Revisit within the Turns sent.");
	} else {
		console.log(`| Revisit | File | Step | Class | ${present.join(" | ")} |`);
		console.log(`| --- | --- | --- | --- | ${present.map(() => "---:").join(" | ")} |`);
		for (const { id, file, step } of revisits) {
			for (const revisitClass of REVISIT_CLASSES) {
				const counts = present.map((arm) => {
					const figures = revisitFigures(arm);
					return figures ? (figures.each.find((each) => each.id === id)?.classes[revisitClass] ?? 0) : undefined;
				});
				if (!counts.some((count) => count !== undefined && count > 0)) continue;
				const cells = counts.map((count) => (count === undefined ? "—" : String(count)));
				console.log(`| ${id} | ${file} | ${step} | ${revisitClass} | ${cells.join(" | ")} |`);
			}
		}
		const passes = (tally: { pass: number; of: number } | undefined): Tally =>
			tally && { right: tally.pass, of: tally.of };
		breakdown(
			"Revisit Passes by class (graded scores)",
			"Class",
			REVISIT_CLASSES.map((revisitClass) => [revisitClass, (arm) => passes(revisitFigures(arm)?.byClass[revisitClass])]),
		);
		breakdown(
			"Revisit Passes by position of the earlier read (graded scores)",
			"Position",
			REVISIT_POSITIONS.map((position) => [position, (arm) => passes(revisitFigures(arm)?.byPosition[position])]),
		);
		console.log(
			"\nA left Revisit is a recovered Lapse: the step fetched the file after the earlier read had left the window. " +
				"It is reported apart from Re-fetch Lapses, recall Pulls and failed Probes, and never added to them, " +
				"since the same fetch can also be a Re-fetch.",
		);
	}

	console.log("\nWindow size per Turn (median prompt tokens of the Turn's last Call):\n");
	console.log(`| Turn | ${present.join(" | ")} |`);
	console.log(`| ---: | ${present.map(() => "---:").join(" | ")} |`);
	for (let turn = 0; turn < turns; turn++) {
		const cell = (arm: Arm) =>
			int(
				median(
					complete(arm)
						.map((run) => run.calls.filter((c) => !c.subagent && c.turn === turn).at(-1)?.promptTokens)
						.filter((x): x is number => x !== undefined),
				),
			);
		console.log(`| ${turn + 1} | ${present.map(cell).join(" | ")} |`);
	}
	const sub = present.flatMap((arm) => complete(arm).flatMap((run) => run.calls.filter((c) => c.subagent)));
	if (sub.length > 0) console.log(`\nIncludes ${sub.length} subagent Calls (counted in the totals above).`);
}

// ------------------------------------------------------------------ main --

const reportFrom = flag("--report");
if (flag("--sweep")) {
	await runSweep(process.argv.slice(2));
} else if (reportFrom && existsSync(join(reportFrom, "sweep.json"))) {
	process.stdout.write(await sweepReport(reportFrom));
} else if (reportFrom) {
	report(JSON.parse(await readFile(join(reportFrom, "bench.json"), "utf8")) as Bench);
} else {
	const workload = await loadNamedWorkload(flag("--workload") ?? "read-only-40");
	const all = turnsOf(workload);
	const turns = all.slice(0, Math.min(positive("--turns", all.length), all.length));
	const runs = positive("--runs", 3);
	const parallel = positive("--parallel", 2);
	const only = flag("--arm");
	if (only !== undefined && !ARMS.includes(only as Arm)) {
		throw new Error(`--arm is "${only}"; expected ${ARMS.join(" or ")}`);
	}
	const arms = only === undefined ? ARMS : [only as Arm];
	const server = process.env.PICHART_DATABASE_URL ?? readSavedUrl();
	if (arms.includes("pi-chart") && !server) {
		throw new Error("pi-chart Runs need a Thread Store server: set PICHART_DATABASE_URL, or run setup to save one");
	}
	const stamp = Date.now();
	const out = resolve(flag("--out") ?? join(tmpdir(), `pichart-bench-${stamp}`));
	await mkdir(join(out, "runs"), { recursive: true });

	const options: Options = {
		workload: { name: workload.name, version: workload.version, commit: workload.commit },
		model: flag("--model"),
		thinking: flag("--thinking"),
		turns: turns.length,
		omp: (await run(["omp", "--version"])).trim(),
	};
	// A pi-chart Run names the commit it loaded only when this checkout's `src/` is that commit's.
	const commit = srcIsCommitted() ? (await run(["git", "-C", REPO, "rev-parse", "HEAD"])).trim() : undefined;

	// Every Run copies the same template, built once.
	const ctx = await buildContext(workload, turns, {
		server,
		out,
		options,
		timeoutMs: positive("--turn-timeout", 600) * 1000,
		stamp,
	});
	try {
		// Interleave the Arms so drift over the session (provider load, cache
		// state) falls on both alike.
		const jobs = Array.from({ length: runs }, (_, index) =>
			arms.map((arm) => () => runOne({ arm, index, label: `${arm}-${index}`, source: REPO, commit }, ctx)),
		).flat();
		log(`${jobs.length} Conversations × ${turns.length} Turns, ${parallel} at a time`);
		const bench: Bench = { options, runs: await pool(jobs, parallel) };
		await writeFile(join(out, "bench.json"), JSON.stringify(bench, null, "\t"));
		log(`record: ${out}`);
		report(bench);
	} finally {
		await rm(ctx.template, { recursive: true, force: true });
	}
}
