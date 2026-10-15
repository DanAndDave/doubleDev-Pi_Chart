# Design: Measures walking skeleton

## Context

Today's `scripts/bench-tokens.ts` works like this:

- It builds each workspace with `git archive HEAD | tar -x` plus `git init` (`copyCodebase`).
- It runs one `omp -p` per Turn, adding `-c` after the first Turn.
- It appends `NO_EDITS` to every prompt except the probe.
- It reads Calls from the main and subagent Journals under `SESSION_ROOT` (`journalsFor`, `callsIn`).
- It scores the probe from stdout.
- It deletes the workspace and writes one JSON file with every Run.

pi-chart Runs use whatever Thread Store database and bundle the user has. The decisions this design implements are in `openspec/changes/context-need-measures/questions/` 02, 06, 09 and 16. The per-Run database lifecycle copies what the replay experiment proved in ticket 04: create, migrate before the first Turn, read, then drop with `FORCE` (`evidence/replay.ts:198–239`).

## Goals / Non-Goals

**Goals:**

- One path from a Workload folder to a Measures report, with every piece a later slice needs already in place: the Turn-indexed Journal, the exported Accounting, the per-Run stores and the check outcomes.
- Measures as a library the benchmark calls and that runs on its own over a record folder.

**Non-Goals:**

- Window parts, Re-fetch, Pulls, Lapses, Plant kinds or bands, Revisits, Utilisation, Ablation, the Gate and statistics. Each is a later slice in `context-need-measures/slices.md`.
- Running the pi-chart of another commit (the Gate needs it; it adds `--extension` then).
- Typechecking `bench/` or the other `scripts/measure-*.ts`.

## Decisions

### 1. Workload file shape

```json
{
  "name": "smoke",
  "version": 1,
  "commit": "c6fe516…full sha",
  "plants": [{ "id": "codeword", "value": "PLUM-17" }],
  "steps": [
    { "id": "add-double", "prompts": ["Remember this codeword for later: PLUM-17. …"] },
    { "id": "probe", "prompts": ["Read src/elision.ts …", { "text": "What codeword …", "probes": ["codeword"] }] }
  ]
}
```

- A prompt is a string, or `{ text, probes }` when it is a Probe. A step is graded if, and only if, `checks/<id>.check.ts` exists. An extra `graded` flag would be a second source of truth, and validation already catches checks that name no step.
- Plants carry only `id` and `value` here. Slice 4 adds kind, placement and band as new fields, so the file stays backward compatible.
- `commit` is stored as a full sha. Validation resolves it with `git rev-parse --verify <commit>^{commit}`.
- A Turn's index is the prompt's position in all the Workload's prompts in order. `--turns N` keeps the first N prompts. A step whose last prompt falls past N is not checked.
- `scripts/workload.ts` exports `loadWorkload(dir): Promise<Workload>`. It throws one `Error` that lists every problem it finds, not just the first.
- Alternative rejected: one file per step. That spreads one Workload's order across file names, and the Gate Workload is about 40 prompts long, which is easy to read as one array.

### 2. Building a workspace

`buildWorkspace(workload, dir)` does three things:

1. `git -C <repo> archive <commit> -- . ':(exclude)bench'`, piped to `tar -x -C dir`;
2. `cp -a overlay/. dir/`, then `graphify-out/` copied to `dir/graphify-out/` if the Workload has one;
3. `git init -q`.

`installDependencies(dir)` then runs `bun install --frozen-lockfile`. It is a separate function so `buildWorkspace` can be tested without a network or cache.

- Install runs for every Workload. A graded step's check needs `node_modules`, and both Arms then see the same tree. A failed install stops the benchmark: it is a property of the Workload, not of one Run.
- The pathspec exclusion keeps `bench/` out even when the pinned commit contains it. That happens to the first Workload pinned after this change lands.
- `PICHART_GRAPH` stays unset, so pi-chart reads the frozen `graphify-out/graph.json` from the workspace root (`src/graph-store.ts:22`) and never re-extracts it. Ticket 16 said "`PICHART_GRAPH` pointed at it"; the actual setting is the `on`/off extraction switch, so placing the folder is the mechanism.

### 3. Run isolation

- The server URL is `PICHART_DATABASE_URL ?? readSavedUrl()` (`src/config.ts:199`). With neither set, a pi-chart Run stops before it starts and names both.
- Each pi-chart Run gets the database `bench_<epoch-ms>_<arm>_<index>`. The steps:
  1. `CREATE DATABASE`;
  2. `PostgresStore.connect(url).migrate()`;
  3. run the Turns with `PICHART_DATABASE_URL` set to the Run's database;
  4. in `finally`, export the Accounting, then `DROP DATABASE … WITH (FORCE)`.
- The export calls `readAccounting(conversationId)` for every distinct `conversation_id` in `call_accounting` and writes `{ [conversationId]: TurnAccounting[] }` to `accounting.json`. Reusing the store's own reader keeps the export in the shape the extension already defines (`src/accounting.ts`). The alternative, a raw row dump, would need a second parser in slice 2.
- Every Run, of either Arm, gets `PICHART_DOC_BUNDLE=<runTmp>/bundle`, a copy of the Workload's `bundle/` or an empty folder.
- Every other `PICHART_*` variable in the caller's environment still reaches both Arms. That is how a Budget sweep sets its cells.
- The plain omp Arm still runs with `--no-extensions` and gets no database.

### 4. Graded Task checks

After the Turn of a graded step's last prompt:

1. copy `checks/<id>.check.ts` to `<workspace>/<id>.check.ts`;
2. run `bun test ./<id>.check.ts` with the workspace as `cwd` and a 120 s timeout;
3. remove the file in `finally`.

- The check runs between `omp -p` processes, so no Turn can see it.
- A check imports workspace modules relative to the workspace root (`./src/…`).
- The recorded outcome is `{ step, pass, exitCode, durationMs, output }`, where `output` is the last 2 KB of stdout and stderr.
- The `.check.ts` suffix keeps the repo's own `bun test` from collecting check files. Bun 1.4.2 runs an explicit `./path` whatever its name; this was observed while writing this design.

### 5. Run record layout

```
<out>/
  bench.json                 # options, omp version, every run.json and its Measures
  runs/<arm>-<index>/
    run.json                 # arm, index, workload {name, version, commit}, model, omp, cwd,
                             # sessionId, prompts[], checks[], failedTurn?
    journal.jsonl            # copy of the main Journal
    subagents/<n>.jsonl      # copies of subagent Journals
    accounting.json          # pi-chart only
```

- `model` is read from the Journal's `model_change` entry (for example `anthropic/claude-opus-5-5`).
- `omp` is the output of `omp --version`, read once per benchmark.
- Journals are copied rather than referenced, because the record has to outlive session clean-up. `journalsFor` stays as the way to find them.
- `--out` defaults to `$TMPDIR/pichart-bench-<epoch-ms>/`.

### 6. Measures

`scripts/measures.ts` exports two functions:

- **`measureRun(dir): Promise<RunMeasures>`**, which reads only the record folder. It returns:
  - `calls`: one row per Call, with turn, subagent flag, the usage fields, `promptTokens` and `floor`. Main-Journal Calls are assigned to Turns by `readJournal` from `src/journal.ts`, the same Turn indexing Accounting uses, so slice 2 can join on it. Subagent Calls get turn −1, as they do today.
  - `totals`: today's `Totals`, so the token table keeps its rows, `prefixHeld` included.
  - `cost`;
  - `graded`, `passes` and `firstFail`;
  - `plants`: one `{ id, turn, right }` per Plant per Probe Turn the Run reached.
  
  Probe text is the concatenated text blocks of the Turn's last assistant message.
- **`aggregate(records)`**, which applies the report rules in the `measures` spec:
  - only complete Runs;
  - Cost per Pass as summed cost over summed Passes, or "no Pass" or "n/a";
  - Retention per Plant as a share of complete Runs.
  
  The token rows stay medians per Run, as today.

The CLI is `bun scripts/measures.ts <run-dir> [--json]`. It prints one Run's Measures, or with `--json` writes the `RunMeasures` JSON. `bench-tokens` calls `measureRun` when each Run ends, stores the result in `bench.json`, and `report()` prints the existing tables plus three new ones: Graded Tasks, Cost per Pass and Retention.

Alternative rejected: spawning the Measures CLI from the benchmark. An import shares the types and gives the same code path without serialising through stdout.

### 7. CLI cutover

- `--workload <name>` defaults to `read-only-40` and names `bench/workloads/<name>/`. A value containing `/` is a path to a Workload folder elsewhere, which lets a throwaway variant run without being added to `bench/`.
- `--report <dir>` reads `<dir>/bench.json`.
- `--arm`, `--runs`, `--parallel`, `--turns`, `--model`, `--thinking` and `--turn-timeout` keep their meaning.
- These are removed:
  - `DEFAULT_WORKLOAD`, `CODEWORD`, `BUILD_NUMBER`, `PROBE` and `NO_EDITS`;
  - the stdout probe scoring;
  - the `scored` parameter;
  - the JSON-array `--workload`.
- The header comment's long description of the workload moves to `bench/workloads/read-only-40/README.md`. It keeps the workload's rationale: why the build number leaves the tail at about Turn 6.

### 8. The two Workloads

- **`read-only-40` v1:** pinned to `c6fe516`. Its prompts are today's exact bytes, `NO_EDITS` included and the probe excluded, in one step `read`, plus a final step `probe` whose single prompt probes `codeword` (`TANGERINE-42`) and `build` (`7341`). It has no checks, no overlay and an empty bundle. Its figures should match `docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.md` within run-to-run noise. The one difference is that each workspace now carries `node_modules/` (a risk, below).
- **`smoke` v1:** also pinned to `c6fe516`, three Turns in two steps.
  - **`add-double`** is graded. Its prompt plants `PLUM-17` and asks for `src/smoke.ts` exporting `double(n)`. Its check imports `./src/smoke.ts` and expects `double(4) === 8`.
  - **`probe`** has a read-only prompt, then a Probe of the codeword with tools forbidden.

## Risks / Trade-offs

- **`node_modules/` in the workspace changes the read-only Workload's window a little.** A directory listing, for example, now includes it. → `read-only-40` v1 is a new Workload version, so no saved reference figures carry over. The acceptance Run compares against the 2026-10-14 figures for plausibility only.
- **Dropping the database loses anything the export missed.** → The export runs before the drop in the same `finally`. Slice 2 reads only `TurnAccounting`, which is exactly what is exported.
- **A pinned commit can go missing**, after a history rewrite for example. → Workload validation resolves the commit before any Run starts. Rewriting history is out of this repo's practice: there is no remote and no rebase.
- **A check imports by relative path, so it breaks if the Workload's overlay moves a file.** → The Workload author owns the check and its overlay together, and an edit is a new version.
- **A Probe is scored on an exact substring.** A reply that formats the value differently, `TANGERINE 42` for example, scores wrong. → This keeps today's rule, so reports stay comparable. Slice 4 owns scoring changes.

## Migration Plan

- The benchmark CLI changes in place; nothing else depends on it.
- Raw files from earlier benchmarks are printed by checking out the commit their write-up cites.
- Rollback is a revert: no stored state changes. The per-Run databases are dropped, and the user's database and bundle are never touched.

## Testing seams

| Requirement / scenario | Seam |
| --- | --- |
| A Workload is a versioned folder (all three scenarios) | `loadWorkload(dir)` on temp folders (`test/workload.test.ts`) |
| Both Arms start from the same tree; overlay replaces pinned; `bench/` and checks stay out | `buildWorkspace(workload, dir)` twice on a temp Workload pinned to a real commit of this repo, compared file by file (`test/workload.test.ts`) |
| Store migrated before the first Turn, dropped after Accounting kept; bundle writes stay inside | The `smoke` Workload, run for real: `bun scripts/bench-tokens.ts --workload smoke --runs 1`. Then check that no `bench_%` database is left (`psql … -c '\l bench_*'`), that `accounting.json` holds every Turn, and that the Workload's `bundle/` is unchanged. A smoke check, not a permanent test, because it costs model spend. |
| Prompts reach both Arms byte for byte | The same smoke Run: every `run.json` prompt equals the user message of the same Turn in the copied Journal (a throwaway `jq` comparison) |
| A graded step is checked after its last prompt: a failing check continues, the check is invisible, a cut-short step is not graded | A real Run of a temp copy of `smoke` whose check expects `double(4) === 9` (`--workload /tmp/smoke-fail`): the record holds a Fail for `add-double`, the later Turns ran, and no tool call in the Journal names a `.check.ts`. The full `smoke` Run records a Pass. Cut-short grading is tested on `gradedSteps(workload, turns)` (`test/workload.test.ts`), the function that decides which steps get checked. |
| Every Run leaves a self-contained record; failed Turn recorded | `measureRun` on fixture record folders (below), plus the smoke Run's folder after its workspace and database are gone |
| Measures are computed offline; Cost per Run; Graded Task outcomes; Retention per Plant | `measureRun(dir)` on hand-built fixture record folders under `test/fixtures/runs/` (`test/measures.test.ts`) |
| Cost per Pass; reports exclude incomplete Runs | `aggregate(records)` on in-memory `RunMeasures` (`test/measures.test.ts`) |
