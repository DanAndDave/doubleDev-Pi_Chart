# Task suite source

Type: grilling
Status: closed
Blocked by: 11-long-horizon-coding-benchmarks

## Question

Where do graded tasks come from? They have to be long enough that pi-chart evicts, and each needs an automatic pass/fail. The options are:

- multi-Turn tasks on this repo checked by its tests;
- a chained suite where each task builds on the last;
- tasks from a published benchmark run back to back in one Conversation;
- something the research turns up.

Settle also how many tasks there are, who writes or curates them, where they live, and how a run is reset between tasks.

## What's known

- pi-chart only behaves differently from plain omp once the tail evicts. Under the defaults that happens at about turn 6 of the read-only workload (`scripts/bench-tokens.ts:55-61`), with `PICHART_TAIL_TOKENS=25000`, `PICHART_TAIL_TURNS=8` and `PICHART_TAIL_LOW_WATER=0.2`. A single-shot task never gets there.
- The bench runs one `omp -p` process per Turn, continuing the Conversation. A task suite has to fit that shape, or the shape has to change.

## Resolution

- **Source:** both, with our own Workloads as the main source.
  - Our own multi-Turn Workloads on this repo, with a test check after each step (Harbor-style steps, no Docker), drive the Gate and Budget tuning. Prompts are the same bytes for both Arms, and each Run gets its own copy of the codebase.
  - A small EvoCode-Bench subset, run through an omp agent written for Harbor, backs the comparison report. It is admitted only after a probe Run shows its tasks make pi-chart evict. Its dataset licence is CC-BY-NC.
  - Chaining unrelated tasks into one Conversation is ruled out: it rewards forgetting (ticket 11).
- **Unit of grading:** a Graded Task is one step of a Workload: its prompts plus a check run after the last of them. A Run yields about 6 Passes or Fails. Steps are not repaired between checks, so a break in step 2 carries into step 3; each Run also reports its first failing step.
- **Starting workspace:** a pinned commit of this repo plus the Workload's overlay, not `copyCodebase` at HEAD (`scripts/bench-tokens.ts:249`), so both sides of a Gate work on the same code. The pi-chart under test is loaded with `-e`. Each Run gets a fresh copy; nothing resets mid-Run.
- **Checks:** one hidden test file per step, copied in only at check time and run with `bun test <file>`. Pure unit tests: no Postgres, no network. A failing check does not stop the Run.
- **Size:** one Gate Workload of about 40 Turns in about 6 steps, carrying the Plants of ticket 07, costing at most about $3.75 per pi-chart Run so 20 Runs fit the $75 Gate cap. A held-out second Workload belongs to the Budget sweep. The EvoCode-Bench subset is sized by its probe Run under the comparison report's budget.
- **Authoring and storage:** the agent drafts, the user reviews. `bench/workloads/<name>/` holds `workload.json` (steps, prompts, workspace commit), `overlay/` and `checks/`; `bench/` is excluded from every workspace copy. A reviewed Workload is frozen; any edit is a new version and, like a model change, resets saved reference figures (A/A calibration, pooled σ).
