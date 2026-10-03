## Context

The reasons and the measurements are in proposal.md, under "Why". Today `GraphStore.graph(codebase)` (`src/graph-store.ts`) does four things on the Call path. It `stat`s `graph.json`, compares the modified time with the one in `parsed`, and on a miss calls `prepare(readGraph(await this.read(path)), at)`. The result is cached in `parsed`, which keeps one `{ changedAt, graph?, failure? }` per Codebase. A failure is cached as well, so a broken file is not parsed again until it changes. `structureFor` (`src/extension.ts`) wraps the call in `inTime("Graph Store", graphDeadlineMs, …)` and reports a throw through `reportSafely`.

Constraints:

- `readGraph` is one synchronous `JSON.parse` followed by filtering. Neither can be interrupted.
- omp runs the extension from `src/` under its own compiled Bun. `LocalEmbedder` runs a separate *process* because native modules don't load in that runtime. Nothing in `src/` has used a `Worker` thread yet.
- ADR-0001 keeps the adapter's format rules in TypeScript, so the Python runner cannot take over filtering.

## Goals / Non-Goals

**Goals:**
- A Call never waits for a reload, and waits for the first load only up to the existing deadline.
- Only taking in the worker's result (≈260 ms on VS Code) and indexing (≈520 ms) run on the main thread, as two separate stalls.
- One code path loads the graph whether the load starts at `session_start` or from a Call.

**Non-Goals:**
- Memory (see proposal.md).
- Making indexing incremental or moving it off the main thread.
- Changing how a missed deadline is reported or accounted.

## Decisions

### 1. `prepare` appends in place

`byName`, `byStem` and `incident` use the `byFile` pattern already in place: `get`, then `push` or `set`. The output is the same, so the existing "the indexes are built with the parse" tests cover it. *Alternative:* precount, then fill typed arrays. It isn't needed: appending in place already brings indexing from 2,456 ms down to ~400 ms.

### 2. The read, hash, parse and filter run in a short-lived worker thread

There is a new module, `src/graph-load.ts`, with a separate entry file, `src/graph-load-worker.ts`, because a Bun `Worker` needs its own file.

- `readExtraction(text, skip): Loaded` is pure. It hashes `text` (SHA-256, as `stateDirectory` already does). If the hash is in `skip` it returns `{ hash, skipped: true }`. Otherwise it returns `{ hash, graph: readGraph(text) }`, or `{ hash, failure: message }` when `readGraph` throws.
- The worker entry reads the file with `Bun.file(path).text()`, runs `readExtraction`, posts the result back and exits. A structured clone keeps the `from`/`to` references that `GraphEdge` shares with `GraphSymbol`.
- `loadInWorker(path, skip): Promise<Loaded>` starts one `Worker` for each load and resolves on its message. It rejects on the `error` event, or on an `exit` with no message, so a worker that crashes settles the load and never leaves it pending forever.

The worker exits after every load, so the memory its parse used is released. The main thread takes in the worker's message, a structured clone that stalls it ≈260 ms on VS Code, and then runs `prepare`. `loadInWorker` resolves on a `setTimeout(0)` turn after the message, so timers and input run between the two; with no yield they merge into one 800–900 ms stall. `setImmediate` does not separate them, because it runs before the timer phase.

*Alternatives:* (a) parse on the main thread in the background. That freezes pi for 2.3 s (measured), and it is the documented fallback if task 1 fails. (b) index in the worker too. The `Map`s cost more to copy back than they cost to build, so the main thread saves no time. (c) a long-lived worker. That holds the parse memory between loads for no gain, since a load happens once per session plus once per changed extraction.

### 3. `GraphStore` keeps one entry per Codebase and loads on a single flight

`parsed` is replaced by:

```ts
interface Loading {
  seenAt: number;                                  // the modified time the latest load started from
  current?: { graph: PreparedGraph; hash: string };
  broken?: { hash?: string; error: Error; reported: boolean };
  inFlight?: Promise<void>;
}
```

`graph(codebase)`:
1. `at = changedAt(path)`. If it is `undefined`, return `undefined` (never extracted), as today.
2. If there is no entry, or `at !== seenAt` and nothing is in flight, start a load: set `seenAt = at` and `inFlight = this.reload(...)`. A change seen while a load is running is left for the next Call. That Call sees `seenAt` lagging behind and starts another load, so there is at most one load in flight per Codebase.
3. If `current` is set, return `current.graph`, even while a load is in flight.
4. Otherwise, await `inFlight`. Then return `current.graph`, or throw `broken.error`. The caller's `inTime` bounds this wait.

`reload` calls `load(path, skip)` with `skip` holding `current?.hash` and `broken?.hash`. For each result:
- **Skipped and the same as `current`:** replace `current.graph` with `{ ...graph, extractedAt: at }`. This is a shallow copy, and the indexes stay shared. A refresh that rewrote identical content no longer marks every edited file as outgrown.
- **Skipped and the same as `broken`:** nothing changes.
- **Parsed:** `current = { graph: prepare(graph, at), hash }` and `broken` is cleared.
- **Failure,** or a rejected `load`: `broken = { hash, error, reported: false }`. `current` is left alone. A rejected `load` has no hash, so `broken.hash` is left undefined, and the next change of the file tries again.

`extractedAt` is the modified time read *before* the worker read the file. If the file is written again during the load, the graph is dated older than its content, which errs toward marking a file outgrown, and the next Call reloads anyway.

*Alternative:* key on the hash alone and drop the `stat`. Hashing 556 MB on every Call is about 0.3 s, which is too much to pay on every Call.

### 4. A failure is reported once, through the extension, whichever path it took

- **No graph in use:** `graph()` throws `broken.error`. `structureFor`'s existing `catch` reports it, as today, and marks it reported.
- **A graph in use:** `graph()` returns the older graph. A new method, `takeLoadFailure(codebase): Error | undefined`, returns `broken.error` once and sets `reported`. This follows the pattern of `takeFailure`. `structureFor` calls it after getting a graph and reports `Graph Store could not read the newer graph, structure is from the one before it: …` through `reportSafely`.

*Alternative:* inject a `report` callback into `GraphStore`. No Store reports on its own today, and the extension owns how a report is worded and where it goes.

### 5. The load starts at `session_start` when structure is wanted

In `session_start`, when `deps.graph` is set and `deps.config.graphSymbols > 0`, call `void graph.graph(codebase).catch(() => undefined)`. This doesn't depend on `graphExtract`, because reading an existing graph needs no extraction. The error is swallowed because the Call that needs the graph reports it. Reporting it here as well would report one failure twice.

### 6. The loader is injected

`GraphStoreOptions.load?: (path: string, skip: readonly string[]) => Promise<Loaded>`, which defaults to `loadInWorker`. `read` stays, and is used only for `outcome.json`.

## Risks / Trade-offs

- [`Worker` may not run under omp's compiled Bun] → Task 1 tests this in the real harness before anything depends on it. If it fails, `load` defaults to `async (path, skip) => readExtraction(await readText(path), skip)` on the main thread, and the "remains responsive" scenario is revised through `/opsx-update` before shipping.
- [During a reload the older graph and the new parse are both in memory, an extra ~1.4 GB on VS Code] → Accepted. The load happens only once per changed extraction, and memory is out of scope.
- [Two stalls on VS Code, ≈260 ms taking in the worker's result and ≈520 ms indexing] → Accepted and recorded. Each is a fraction of the 2.3 s stall that parsing on the main thread would cause.
- [A Call can carry structure from a graph older than one already on disk] → This is already correct: `changedSince` discloses outgrown files against the older `extractedAt`, and the reload replaces that graph within seconds.
- [A worker that is killed with no message] → The `exit` handler rejects the load and it is treated as a failure. The Call path is never left on a promise that never settles.

## Testing seams

- **`GraphStore` with injected `load` and `changedAt`** (`test/graph-store.test.ts`, "reading a codebase's graph"). This is the target seam for every scenario in "Reading a graph does not hold up a Call" except "Reading a large graph". A deferred `load` controls when a load completes. `changedAt` moves the modified time, and `load` calls are counted and their `skip` lists recorded. The tests cover: the old graph served while a deferred load is pending; one load for several Calls; the first-Call wait; a skipped hash keeping the same indexes with a newer `extractedAt`; a failure while a graph is in use (`graph()` still returns it, `takeLoadFailure` returns the error once, and an unchanged modified time starts no new load).
- **`readExtraction`** (`test/graph-load.test.ts`): the hash is stable for identical text, `skip` stops the parse, and a malformed graph comes back as `{ failure }` with the adapter's message. It is pure, so no worker is needed.
- **The extension through `piChart` with a `GraphStore`** (`test/extension.test.ts` structure tests): the warm-up at `session_start` loads before the first `context` call, and a reload failure while a graph is in use is reported once and the structure is still carried.
- **"Reading a large graph" and the worker under omp are checked by smoke tests, not unit tests.** A throwaway script on `~/dev/smoke/vscode/graphify-out/graph.json` measures the longest gaps of a 5 ms `setInterval` during `store.graph()`. The longest should be the indexing time, ≈520 ms, with taking in the result a separate ≈260 ms gap, nowhere near 2 s. Then a real `omp` session in that Codebase should show structure on its first prompt with no Graph Store deadline report.
