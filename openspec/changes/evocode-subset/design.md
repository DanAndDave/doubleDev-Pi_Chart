# Design: EvoCode-Bench subset

## Context

What the archived slices built, which an EvoCode Run reuses:

- `scripts/runs.ts` `runOne` is the only way a Run happens. It is a host process that sends one `omp -p` per Turn with `-c` after the first, in a temp workspace. It finds the Journals under `~/.omp/agent/sessions` by the workspace's name (`journalsFor`), and grades a step by copying `checks/<step>.check.ts` in and running `bun test`. Then it exports Accounting from the Run's own database (`createDatabase`, `exportAccounting`, `dropDatabase`), writes `run.json` and calls `measureRun`.
- `scripts/measures.ts` reads only the record folder: `run.json`, `journal.jsonl`, `subagents/*.jsonl` and `accounting.json`. It never opens a Workload folder. It needs `record.checks` and `record.prompts` (step ids, empty `probes`), and takes `plants: []` and `revisits: []` without complaint. Retention then reads "no Probe reached".
- A pi-chart Run gets its database address as `BENCH_RUN_DATABASE_URL`. `scripts/run-url-set.ts` hands it to pi-chart's factory and `scripts/run-url-unset.ts` removes it before any tool runs (budget-sweep decision 12).
- `scripts/sweep.ts` `runCapped({ jobs, width, cap })` starts jobs while spend is below a cap.
- `srcIsCommitted()` decides whether a pi-chart Run can name its commit.

What the research found, from [Harbor](https://github.com/harbor-framework/harbor) at `7331d8a3` (0.24.0: `src/harbor/trial/multi_step.py`, `agents/installed/base.py`, `agents/installed/pi.py`, `cli/jobs.py`, `docs-mintlify/tasks/multi-step.mdx`), the [EvoCodeBench repo](https://github.com/UniPat-AI/EvoCodeBench), the [HF dataset](https://huggingface.co/datasets/UnipatAI/EvoCodeBench) and [arXiv 2605.24110](https://arxiv.org/abs/2605.24110):

- **Harbor multi-step tasks.**
  - The container persists across steps.
  - The verifier runs after every step, even after an agent exception.
  - Without a step `min_reward`, a low reward does not stop the trial. No EvoCode task sets one.
  - Per-step rewards are in `result.json` at `step_results[i].verifier_result.rewards.reward`.
- **Resumed sessions.** `--resume-trajectory` calls the agent's `resume()` for every step after the first. It requires an agent that declares `resume=True`. It also keeps `/logs/agent` between steps and copies it into `steps/<step>/agent/` after each one.
- **Agent API.**
  - Custom agents subclass `BaseInstalledAgent` and load with `-a module:Class` from the Harbor process's import path.
  - Options reach the agent through `--ak`, environment through `--ae`.
  - Host files reach the container through `--mounts` (Compose volume JSON, read-only allowed).
  - On Linux, the host's address needs an `--extra-docker-compose` overlay with `host.docker.internal:host-gateway`.
- **EvoCode-Bench.**
  - The current scoring runs on upstream Harbor. There are 26 tasks with 227 rounds, every image `FROM ubuntu:22.04`, 1 to 2 CPUs and 4 GB each, and 1,800 s per round (3,600 s for four tasks).
  - The tasks live only in the HF dataset. Its revision is `9fcae3e5539d1c0e85e2481fe06bd6af42cc4bc6` (2026-06-24), and `archives/evocodebench_wotraj.tar.zst` is 70 MB.
  - Code is MIT. The dataset is CC BY-NC 4.0, and its card adds "not intended for model training".
- **Published cost.** The v2 runs are terminus-2 on Opus 4.8, each round a fresh session. At list prices they cost $6 to $156 per task, mean $42 [INFERENCE: token counts × assumed prices]. The cheapest are `d10_w8` (8 rounds, ≈ $6), `d10_w12` (7, ≈ $8), `d10_w9` (8, ≈ $12) and `d1_w1` (9, ≈ $14). Their largest single round instruction is 11.1 KB.

Checked locally:
- omp 18.11.0 is a single dynamically linked ELF binary. It runs in `ubuntu:22.04` (glibc 2.35) when mounted in.
- The host's Thread Store server is the `pi-chart-thread-store` container, published on `0.0.0.0:55432`.
- The host's Anthropic credential is an omp-stored OAuth login, not an environment variable.

## Goals / Non-Goals

**Goals:**

- A Run of any EvoCode task on either Arm whose record `measures.ts` reads as it reads a Workload Run's.
- The admission Runs, `subset.json`, and a command the comparison report can call to run pairs.

**Non-Goals:**

- Paper scoring (fail-stop MT@4, SR from a fast-forwarded state). The record keeps every round's outcome, so it can be computed later.
- Other Harbor suites (Terminal-Bench, SWE-bench adapters). The agent would run them, but nothing here admits or reports them.
- Plants or Revisits in EvoCode tasks. The tasks are taken as published.
- Running Harbor in parallel inside one job (`-n`). Parallelism is ours, one job per Run.

## Decisions

### 1. A host orchestrator, and a thin agent in the container

`scripts/evocode.ts` owns everything a Run owns on the host: the cache, the database, the Harbor job, turning the trial into a record, measuring it, and dropping the database. `scripts/harbor/omp_agent.py` only runs omp, once per round.

Alternatives considered:
- An agent that writes the record itself, in Python. Rejected because the record format, the Accounting export and the Measures are TypeScript, and this would duplicate them.
- Porting the tasks into `bench/workloads/` and grading with `bun test`. Rejected for three reasons: ticket 06 chose Harbor, the tasks need their own Docker images and Go toolchains, and committing them conflicts with the licence (decision 9).

### 2. One Harbor job per Run

Each Run is one `harbor run` over one task directory with one attempt and no retries:
- `-n 1 --n-attempts 1 --max-retries 0`;
- `--jobs-dir <out>/harbor --job-name <label>`;
- `--resume-trajectory`.

Our `runCapped` decides how many Runs are in flight and when spend stops new ones, as for a sweep. Harbor's own concurrency is not used, so a Run maps to exactly one database, one record folder and one cost.

Harbor runs as `uvx --from harbor==0.24.0 harbor`, with `PYTHONPATH=scripts/harbor`. No global install and no Python project file are added to the repo. The record's `harbor` field holds `harbor --version`.

### 3. omp, Bun and pi-chart are mounted read-only

`--mounts` binds:
- the host's omp binary at `/opt/omp/omp`;
- the host's Bun at `/opt/bun/bun`;
- for the pi-chart Arm only, this checkout at `/opt/pi-chart`.

All three are read-only. pi-chart's embedder runs under `PICHART_BUN=/opt/bun/bun`, from the checkout's `node_modules` and its cached model.

The agent's `install()` installs nothing. It fails the trial unless `/opt/omp/omp --version` prints the host's version, so both Arms and the host run one omp.

Alternative considered: installing omp in the container from the network, as Harbor's Pi agent installs pi. Rejected because the version could drift from the host's, it needs network access, and it costs minutes per Run.

### 4. The Conversation lives in `/logs/agent`

- **The command.** Each round runs `omp -p --no-title --no-extensions --session-dir /logs/agent/sessions --model <model> [--thinking <level>] [-c] <instruction>`. It runs in the task's working directory, with `-c` when Harbor resumes. The pi-chart Arm inserts the three `-e` of `piChartExtensions`, under `/opt/pi-chart`.
- **The instruction** is passed as one argv string, `shlex`-quoted, so it reaches omp byte for byte. A round over 128 KiB, Linux's limit for one argument, fails the Turn with that reason. No candidate comes near it.
- **The environment** is built from nothing:
  - `HOME=/tmp/omp-home` (fresh, so omp runs at its defaults with none of the user's settings);
  - `ANTHROPIC_OAUTH_TOKEN` (decision 6);
  - `PICHART_DOC_BUNDLE=/tmp/pichart-bundle` (created empty);
  - `PICHART_BUN`;
  - for pi-chart, `BENCH_RUN_DATABASE_URL`.

  No `PICHART_*` Budget from the host's shell is passed on, so the record names no Budget.
- **Reading the Journals.** Because Harbor keeps `/logs/agent` across resumed steps, the final step's snapshot `steps/<last round>/agent/sessions/` holds the whole Conversation. `journalsFor` becomes `journalsIn(root, cwd)`, where the root is a session folder. `runOne` calls it on its `SESSION_ROOT` folder matched by name. The adapter calls it on the snapshot directly.
- **The session layout is unverified** [INFERENCE]: where `--session-dir` puts main and subagent Journals. Task 1.2 checks it on the host, for under $1, before any Harbor Run.

### 5. The Thread Store is reached through the host gateway

- **Before the job.** The host creates and migrates the Run's database exactly as `runOne` does, with `createDatabase` on the configured server.
- **The container's address** is the same URL with its host replaced by `host.docker.internal`. It reaches omp as `BENCH_RUN_DATABASE_URL` via `--ae`, and `run-url-set.ts` / `run-url-unset.ts` keep it out of the agent's shell, as on the host.
- **The host gateway.** A Compose overlay written into the Run's output folder adds `extra_hosts: ["host.docker.internal:host-gateway"]`.
- **After the job,** `exportAccounting` and `dropDatabase` run on the host, inside the same `attempt` chain as `runOne`, so a failed job still drops its database.

Alternative considered: Postgres inside each task container. Rejected because it adds a pgvector install to every image, and the Accounting would have to be dumped out before the container goes.

### 6. Credentials are a short-lived token, never the login

Before each Run, the host runs `omp token anthropic` and passes the access token as `ANTHROPIC_OAUTH_TOKEN` via `--ae`. This is the variable omp documents as taking precedence over an API key.

Alternative considered: `omp auth export` / `import` into the container. Rejected because the container would refresh the OAuth login, rotate its refresh token and sign the host out.

### 7. A failed Turn ends the Run inside Harbor's loop

Harbor keeps running steps after an agent exception, as long as the verifier gives a result. The agent therefore writes `/logs/agent/turns/<n>.started` before omp and `<n>.done` after omp exits zero.

At the start of each round, the agent sends nothing when any earlier round started without finishing. A timeout kills the agent mid-round and leaves `.done` unwritten, so it is caught the same way. The rest of the trial then costs only verifier time.

The adapter's `failedTurn` is the first round with no `.done`. It records outcomes only for rounds before it (spec: *A failed Turn ends an EvoCode Run*).

Alternative considered: `min_reward` in a local task copy. Rejected because it stops on a Fail, which the Graded Task rule forbids, and it would modify the dataset.

### 8. Trial to record

| Record field | Source |
| --- | --- |
| `arm`, `index`, `thinking`, `omp`, `piChart` | as `runOne` |
| `workload` | `{ name: "evocode-<task id>", version: 1, commit: <dataset revision> }` |
| `harbor` (new, optional) | `harbor --version` |
| `cwd`, `sessionId`, `model` | the main Journal's header and first `model_change`, as `runOne` |
| `prompts` | one per round, in `task.toml` step order: `{ step: <round name>, text: <steps/<round>/instruction.md>, probes: [] }` |
| `checks` | per round before `failedTurn`, from `step_results[i]`: `pass` = reward is 1, `exitCode` 0 on Pass and 1 otherwise (Harbor reports a reward, not an exit code), `durationMs` from the verifier's timing, `output` the last 2 KB of `steps/<round>/verifier/test-stdout.txt` |
| `plants`, `revisits` | `[]` |
| `failedTurn` | decision 7 |

`text` is read from the task folder on the host, not from Harbor. The byte-for-byte scenario then compares the Journal against the task as published.

### 9. Dataset: pinned, verified, cached outside the repo

`bench/evocode/subset.json` holds:
- the dataset id, the revision `9fcae3e5539d1c0e85e2481fe06bd6af42cc4bc6`, the archive path, and its SHA-256, recorded by task 2.1 at the first fetch;
- the licence and the paper;
- the four candidates;
- the admission results.

The archive is downloaded from `https://huggingface.co/datasets/UnipatAI/EvoCodeBench/resolve/<revision>/<archive>`. It is hashed, and only then extracted with `tar --zstd` into `~/.cache/pi-chart/evocode/<revision>/`, through a temp folder renamed into place, so a refused download leaves nothing behind.

Admission records stay in the output folder, because their Journals quote task text. `subset.json` keeps their figures.

### 10. Admission

`bun scripts/evocode.ts --admit [--out <dir>]` runs the four candidates on the pi-chart Arm with the reference model `anthropic/claude-opus-5-5`, at the default thinking level. They run in `subset.json` order, which is cheapest-first by the published estimate, 2 at a time, through `runCapped` with a $60 cap.

**The Eviction test.** It reads the Run's main Calls (`measureRun(...).calls`). A Call with a known window evicted when some Turn before its own is absent from `window.tail.turns`.

**Status.**
- No `failedTurn` and an evicting Call: admitted.
- No `failedTurn`, and every Call that could show an Eviction is known and carried every earlier Turn: `no eviction`.
- Otherwise: `unknown`.

The Calls that could show an Eviction are those of Turn 2 and later.

`subset.json` is rewritten after each Run, so a stopped admission keeps what finished. The command prints one line per candidate.

`bun scripts/evocode.ts --task <id> --arm <arm> [--runs n] [--rounds n] [--out <dir>]` runs Runs outside admission. The comparison report calls it. `--rounds n` gives Harbor a copy of the task, made in the Run's output folder, whose `task.toml` keeps only the first *n* steps. The record then holds those *n* prompts. This is for smoke Runs, the way `bench-tokens --turns` is.

**Preconditions,** checked before any Run:
- `srcIsCommitted()`;
- `uvx --from harbor==0.24.0 harbor --version` and `docker info` succeed;
- a server URL from `PICHART_DATABASE_URL` or the saved one;
- `zstd` on `PATH`.

## Risks / Trade-offs

- **[The token can expire during a Run of up to 9 rounds × 30 min]** → It is fetched right before each Run. An expiry ends the Run as a failed Turn, and admission records it as `failed Turn`, not as a task property.
- **[The token is in the agent's environment inside the container]** → The agent on the host could already read the same credential with `omp token`. The container is the Run's alone and is removed with the trial.
- **[The cost estimates come from another agent loop]** → The $60 cap stops new Runs, and `subset.json` records actual costs, so the comparison report sizes pairs on omp's figures.
- **[pi-chart's embedder runs on the task's 1 CPU]** → This slows pi-chart Turns, not their tokens. Wall time is recorded in the trial, and the cost Measures are unaffected.
- **[The embedder or the store may need to write under the read-only `/opt/pi-chart`]** → Task 3.4's 2-round smoke loads pi-chart and makes its Calls before any admission Run.
- **[The host's Postgres must accept connections from the Docker bridge]** → It is published on `0.0.0.0`. The smoke Run proves it, and a refused connection fails the Run before its first Call is billed.
- **[7–9 rounds is under `PICHART_TAIL_TURNS` 8, so Eviction relies on the token Budget]** → That is what admission measures. A task that never evicts is left out.
- **[Images build per task on first use, and disk is 57 GB free]** → Four `ubuntu:22.04` images with Go toolchains. Harbor reuses a built image across Runs of one task.
- **[Harbor's API changes]** → Pinned to 0.24.0 through `uvx`.
- **[Plain omp in the container runs at omp's defaults, while host Runs use the user's settings]** → Both Arms of an EvoCode pair share this, and the comparison report's caveat 4 ("plain omp at its default compaction settings") then holds exactly.

## Migration Plan

Additive. `RunRecord.harbor` is optional. `journalsIn` replaces `journalsFor` at its one caller, with the same behaviour for `runOne`. Rollback deletes `scripts/evocode.ts`, `scripts/harbor/` and `bench/evocode/`.

## Testing seams

| Requirement | Seam | Cases |
| --- | --- | --- |
| Tasks come from a pinned revision | `fetchTasks(subset, { download, cacheRoot })` with an injected download | A cached revision skips the download. A hash mismatch throws, naming both hashes, and leaves the cache without the revision. A match extracts and returns the task folders. |
| Rounds as Turns; Graded Tasks by reward; failed Turn ends the Run; same record | `recordOf(trialDir, task, spec)` over fixture trial folders (a `result.json`, `steps/round-N/{agent/sessions,agent/turns,verifier}`, a two-Turn Journal) | Rewards 1, 0, 1 give Pass, Fail, Pass. `.done` missing for round 3 gives `failedTurn` 2, outcomes for rounds 1–2 only, though `result.json` has rewards for all. Prompts equal `instruction.md` bytes, including a trailing newline. Workload id `evocode-<id>`, version 1, commit = revision. Plants and Revisits empty. |
| Journals outside `~/.omp` | `journalsIn(root, cwd)` | Main chosen by header `cwd` among top-level files. Subagents one deeper. A Journal of another cwd ignored. The existing `runOne` paths stay green. |
| Admission keeps only tasks that evict | `admissionOf(record, calls)` | A Turn-3 Call missing Turn 1: admitted. All carried: `no eviction`. Turn-2+ Calls all `unknown`: `unknown`. `failedTurn` 4: `failed Turn 4`. |
| Cap; statuses written | `admit` with injected `runTask` | $61 after three Runs leaves the fourth `not run`. `subset.json` rewritten after each Run. Preconditions refused with their messages. |
| Agent command line | smoke | Harbor oracle run (no model) builds a candidate's image and passes round 1. Host `--session-dir` check. `--task <cheapest> --arm pi-chart --rounds 2` through Harbor, read by `measures.ts`. |
| Measures read the record unchanged | smoke | `bun scripts/measures.ts <out>/runs/<label>` over an admission Run. |
