# Proposal: Load the Graph Off the Call Path

Triage: ready-for-agent

## Why

A Call that needs structure waits for the Codebase's graph to be parsed and indexed. On VS Code (`graph.json` 556 MB: 248k nodes, 934k links; 244k code symbols and 862k edges after filtering) that wait is 4.4 s against the 5 s `PICHART_GRAPH_DEADLINE_MS`. It happens on the first Call of a session, and again after every Turn whose refresh rewrote `graph.json`. The parse is cached against the file's modified time, and a refresh that changed nothing still moves that time: in this repository the modified time changed while the content hash stayed the same. On a slower machine the same load passes the deadline, and the Call loses its structure.

Measured on VS Code, cold `GraphStore.graph`:

| Stage | Time | Peak memory |
|---|---|---|
| read file | 216–348 ms | 0.57 GB |
| `readGraph` (`JSON.parse` + filtering) | 1,517 ms | 1.39 GB |
| `prepare` (building the lookup indexes) | 2,456 ms | 2.84 GB |
| **cold `store.graph`** | **4,362 ms** | **3.14 GB** |
| cached `store.graph` | 12 ms | 1.2 GB resident |

Most of `prepare` is wasted. `src/symbols.ts` copies a symbol's whole list each time it adds one entry (`[...(map.get(k) ?? []), x]`), and one symbol has 11,452 edges. Appending in place builds the same indexes in 384–451 ms. A load in the background on the main thread would still freeze pi, because `JSON.parse` cannot pause partway: the longest unresponsive stretch measured 2,271 ms. With the parse and filtering in a worker thread, the main thread is held up only while it takes in the result (≈260 ms), and a load measures about 5 s end to end.

## What Changes

- `prepare` appends to its index lists in place instead of copying them. The indexes it builds are the same.
- A Call no longer waits for a reload. When a graph is already loaded, the Call uses it straight away. If `graph.json` has changed since that graph was loaded, the Call starts one reload in the background, and Calls that ask at the same time share it. The loaded graph stays correct while the reload runs: `changedSince` marks every file edited after the graph's `extractedAt` as outgrown.
- A session starts loading its Codebase's graph at `session_start` without waiting for it, so the load usually finishes before the first prompt is sent.
- A Call that finds no graph loaded yet waits for the load in progress, up to `PICHART_GRAPH_DEADLINE_MS` as it does now, and reports the part as `failed` once the deadline passes. No new `unavailable` reason is added.
- The read, hash, `JSON.parse` and filtering of `graph.json` run in a worker thread that exits after each load, which releases its memory. Indexing stays on the main thread, and so does taking in the worker's result; together about 780 ms on VS Code, run as two separate stalls, a cost this change accepts.
- Each load hashes `graph.json` before parsing it. If the content has not changed, the loaded graph is kept and only its `extractedAt` moves forward. A refresh that rewrote identical content therefore costs one hash and no reload.
- A reload that fails while an older graph is loaded keeps the older graph in use. The failure is reported once, and it is remembered against the file's hash so the same broken file is not parsed again. A reload is attempted again only when the file changes. When no graph has loaded yet, a failed load still costs the Call its structure, as it does now.

**Not in scope:** memory. The process peaks at 3.1 GB during a load and keeps 1.2 GB resident with VS Code's graph loaded. Fixing `prepare` lowers the peak somewhat. Bringing memory down properly would need the runner to write a smaller graph, which keeps only the symbols and edges actually used (45 MB, parsed in 117 ms). That would move the filtering rules out of TypeScript, so it would be a change of its own. Also out of scope: a new `unavailable` reason for "still loading", and starting a reload from the refresh's `finished` promise.

**Fallback:** if a worker thread cannot run under the real `omp` binary (this is the first task), the parse stays on the main thread in the background. In that case pi freezes for about 2.3 s at each load. Before that ships, the requirement that the session stays responsive is revised through `/opsx-update`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `graph-store`: a new requirement covers reading a graph without holding up a Call: a loaded graph is served while a reload runs, loading starts at session start, an unchanged rewrite keeps the loaded graph, the parse does not stall the session, and an older graph is kept when a reload fails. The scenario for an unparseable graph is narrowed so that a broken newer file no longer withdraws an older graph that is already loaded.

## Impact

- **Code:** `src/symbols.ts` (`prepare`); `src/graph-store.ts` (`graph()` serves the loaded graph, single-flight background reload, hash check, remembered failures, an injectable loader); a new worker module beside it; `src/extension.ts` (`session_start` warm-up, and `structureFor` reporting a reload failure); README's `PICHART_GRAPH_DEADLINE_MS` row (it now bounds only a Call that finds no graph loaded yet).
- **Tests:** `test/graph-store.test.ts` "reading a codebase's graph" tests that assume a changed file is re-parsed before `graph()` returns; the structure tests in `test/extension.test.ts`.
- **Runtime:** a worker thread lives for each load, which happens once per session and once per changed extraction. During a reload, the older graph and the newly parsed one are both in memory.
- **Dependencies:** none added.
- **Blocked by:** nothing.
