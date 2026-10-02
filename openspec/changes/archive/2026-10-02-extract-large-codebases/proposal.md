# Proposal: Extract Large Codebases

Triage: ready-for-agent

## Why

A Codebase's first extraction can never finish once the Codebase is large. `GraphStore` stops `graphify extract` after 60 s (`EXTRACT_MS`, `src/graph-store.ts`), a figure set by measuring this repository's 69 files. A shallow clone of VS Code (15,543 code files, graphify 0.9.63, 12 workers) took 448 s and 470 s cold. Stopped at 60 s twelve times in a row, it never produced `graph.json`, and its cache stayed at 613 files. graphify does not cache per-file results for TS/JS (`_JS_CACHE_BYPASS_SUFFIXES`), so every retry after every Turn repeats the same doomed minute. A session shorter than the extraction cannot finish it under any deadline, because shutdown stops the work with the session.

The same Codebase then fails a second way. Its `graph.json` is 544 MB, over graphify's 512 MiB cap, so every later incremental refresh exits with code 1. That failure currently shows up as a raw error after every Turn, with nothing saying what it means or what to do about it.

## What Changes

- Extraction runs detached from the session. A run started by a session keeps going after that session ends, and the next session reads what it wrote. A session no longer waits for an extraction at shutdown. It waits only for the run to be launched, which includes installing graphify.
- One extraction at a time per Codebase, across every process on the machine, not just within one session. A refresh requested while a run is in progress is not lost: the Codebase is extracted again after that run ends, so edits made during the run reach the graph.
- The 60 s limit is replaced by a deadline of 60 minutes by default, set with the new `PICHART_GRAPH_EXTRACT_DEADLINE_MS`. It exists only to free the Codebase from a hung graphify. A run that reaches it is stopped along with every process it started, and this is reported.
- A run that fails is reported in the session that started it, if that session is still open. Otherwise it is reported once by the next session in that Codebase.
- While a Codebase has no graph but an extraction is running, the Turn says that extraction is in progress and when it started. It no longer tells the user to set `PICHART_GRAPH=on`, which is already set.
- A refresh refused by graphify's graph-size cap is reported once per session. The report names the graph's size, the cap, `GRAPHIFY_MAX_GRAPH_BYTES`, `.graphifyignore`, and what reading a graph that size costs. pi-chart does not raise the cap. The existing graph stays readable and is disclosed as older where files changed, as it is today.
- `/pi-chart`'s `codebase graph` line says whether an extraction is running, and how the last one ended.

**Not in scope:** raising or managing `GRAPHIFY_MAX_GRAPH_BYTES`; skipping refreshes that will hit the cap again; lowering how much memory and time it takes pi-chart to read a very large graph (4.0 s and 2.6 GiB RSS for the 544 MB graph, measured); a silence-based watchdog (graphify was measured silent for 255 s during a healthy run).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `graph-store`: keeping the graph current now spans sessions, is serialised per Codebase across processes, is bounded by a configurable deadline instead of 60 s, and never loses a refresh requested mid-run. New requirements cover reporting an extraction in progress, and reporting a graph that has outgrown graphify's size cap.

## Impact

- **Code:** `src/graph-store.ts` (refresh launches a detached run; `EXTRACT_MS` removed; the last run's outcome is read back); new `src/graphify-runner.py`, run by the private graphify environment's Python; `src/extension.ts` (`session_start`, `agent_end`, `session_shutdown`, `reportMissingGraph`, run-outcome reporting); `src/install.ts` (`codebase graph` detail); `src/config.ts` (`PICHART_GRAPH_EXTRACT_DEADLINE_MS`); README settings table and the codebase-graph section.
- **Machine state:** per-Codebase run state (lock, request marker, log, last outcome) under `~/.pi-chart/graphify/runs/`. Nothing new is written into the Codebase.
- **Processes:** a graphify run may outlive the pi session that started it, for up to the deadline.
- **Dependencies:** none added. The runner uses only the Python standard library, from the environment pi-chart already installs graphify into.
- **Blocked by:** nothing.
