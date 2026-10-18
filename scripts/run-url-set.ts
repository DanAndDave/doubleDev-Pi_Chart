/**
 * Loaded with `-e` just before a Run's or replay's pi-chart extension, with
 * `scripts/run-url-unset.ts` just after it (`piChartExtensions` in
 * `scripts/runs.ts`), so that the Run's Thread Store is out of the agent's
 * reach.
 *
 * A Workload over pi-chart's own source puts pi-chart's test suite in the
 * agent's hands, and its store tests use the server `PICHART_DATABASE_URL`
 * names and truncate it: a Run that gave omp the variable lost its
 * Accounting and its stored Turns to the agent's own `bun test`. A variable
 * omp starts with reaches its tools' shells whatever an extension does, so a
 * Run gives omp the database as `BENCH_RUN_DATABASE_URL`, which nothing in
 * pi-chart reads. omp calls extension factories in `-e` order, so this one
 * sets `PICHART_DATABASE_URL` for pi-chart's, which reads it once, and the
 * next removes it before any tool runs.
 */
export default function setRunUrl(): void {
	const url = process.env.BENCH_RUN_DATABASE_URL;
	if (!url) throw new Error("run-url-set.ts needs BENCH_RUN_DATABASE_URL");
	process.env.PICHART_DATABASE_URL = url;
}
