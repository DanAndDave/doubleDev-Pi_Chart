## 1. Prove a worker runs under omp

- [x] 1.1 Add `src/graph-load.ts` (`readExtraction`, `loadInWorker`, `Loaded`) and `src/graph-load-worker.ts`. Load `~/dev/smoke/vscode/graphify-out/graph.json` through `loadInWorker` from a throwaway command that the extension registers, inside a real `omp` session. Verify the result has 244k symbols and a hash. If `Worker` fails under omp, make the main-thread `readExtraction` the default `load` instead, and run `/opsx-update` to revise the "Reading a large graph" scenario before going on.

## 2. Indexing without copying

- [x] 2.1 Make `prepare` (`src/symbols.ts`) append in place for `byName`, `byStem` and `incident`. Verify that the existing index tests in `test/graph-store.test.ts` and the selection tests in `test/graph.test.ts` pass unchanged, and that a throwaway timing on the VS Code graph shows `prepare` under 600 ms.

## 3. Extraction reading, pure

- [x] 3.1 Write `test/graph-load.test.ts` first (red), then implement `readExtraction`. Cover: identical text gives an identical hash; a hash in `skip` returns `skipped` without parsing; malformed JSON and a graph missing required fields come back as `{ failure }` carrying the adapter's message. Verify with `bun test test/graph-load.test.ts`.
- [x] 3.2 Make `loadInWorker` settle when the worker crashes: it rejects on `error`, and on `exit` without a message. Verify with a throwaway script that points it at a worker which exits without posting, and confirm it rejects.

## 4. GraphStore serves the loaded graph and reloads on a single flight

- [x] 4.1 Add the `load` option (default `loadInWorker`). Replace `parsed` with the `Loading` entry described in design.md §3. Delete the tests in "reading a codebase's graph" that require a changed file to be parsed again before `graph()` returns ("a changed extraction is parsed again", "a changed extraction invalidates the indexes with the parse"). Write their replacements red first, using a deferred `load`: the older graph is served while a load is pending, and the newer graph is served after it resolves. Verify with `bun test test/graph-store.test.ts`.
- [x] 4.2 Several `graph()` calls after one change start exactly one `load`, and a change seen during an in-flight load starts the next load on the following Call, not during the current one. Verify by counting `load` calls in a test.
- [x] 4.3 First load: when no graph is in use, `graph()` waits for the in-flight load, then returns its graph or throws its error. Port "an unreadable graph is reported once, not re-parsed every call" onto `load` and keep it. Verify with `bun test test/graph-store.test.ts`.
- [x] 4.4 Unchanged rewrite: if the hash is in `skip` and matches the graph in use, the same indexes are kept (`byName` is the same object) and `extractedAt` moves to the new modified time. Verify with a test.
- [x] 4.5 A failed reload while a graph is in use: `graph()` keeps returning the older graph, `takeLoadFailure` returns the error once and `undefined` after that, and the same modified time starts no further `load`. A file that changes again is loaded again. Verify with a test.

## 5. Extension wiring

- [x] 5.1 At `session_start`, start `graph.graph(codebase)` in the background when `deps.graph` is set and `graphSymbols > 0`, and swallow its error. Verify with an extension test: after `session_start` and before any `context` call, the injected `load` has been called once, and the first `context` call does not call it again.
- [x] 5.2 In `structureFor`, after a graph is returned, report `takeLoadFailure` once through `reportSafely`. Verify with an extension test: a failed reload while a graph is in use produces one report across two Calls, and both Calls still carry structure.
- [x] 5.3 Update the README `PICHART_GRAPH_DEADLINE_MS` row: it bounds only a Call that finds no graph read yet in the session, and reloads happen in the background. Update the doc comment on `GraphStore.graph` to match. Verify by reading the rendered row.

## 6. Verification

- [x] 6.1 Run `bun test` and the typecheck once, and confirm both pass.
- [x] 6.2 Smoke test, responsiveness: a throwaway script loads the VS Code graph through `GraphStore` with a 5 ms `setInterval` running. Verify that the longest gap is roughly the indexing time, that taking in the worker's result is a separate, shorter gap, and that both are well under the 2,271 ms in-process figure. Record the numbers in the change's archive note, then delete the script.
  - Measured, three runs: first `graph()` 4,991–5,103 ms end to end. The longest gaps were 514/516/576 ms (indexing) and 260/261/301 ms (taking in the worker's message). The two stalls are kept apart by resolving on a `setTimeout(0)` turn; with no yield they merged into one stall of 798–910 ms. `prepare` alone takes 453–537 ms, down from 2,540 ms. A second `graph()` on an unchanged file takes 0.1 ms.
- [x] 6.3 Smoke test, the real harness: start `omp` in `~/dev/smoke/vscode` and send a first prompt that names a VS Code symbol. Verify that `/pack` shows structure and that no "Graph Store did not answer" report appears. Then touch `graph.json` without changing it, send a second prompt, and verify that structure is still carried with no stall and no reload (only the hash runs).
  - `omp -p` (18.4.11) with a first prompt naming `registerSingleton`: the Call's accounting record (what `/pack` reads) shows a structure part with 3 symbols and 772 tokens, headed by `registerSingleton() (src/vs/platform/instantiation/common/extensions.ts:L27)`. The model named its callers without using tools, and no Graph Store report appeared. `/pack` sends its output to `ui.notify`, which `-p` mode does not print, so the accounting record was read instead.
  - Touch without a content change, checked in one process through the real `GraphStore` and worker: each `omp -p` is a new process, so it cannot show a reload being skipped. The Call during the read took 2.9 ms and was served the same graph. After the read, the indexes were the same objects and `extractedAt` had moved forward. The longest gap was 11 ms, so only the hash ran.
