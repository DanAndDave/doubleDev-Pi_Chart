# Proposal: Structure is matched precisely enough to stay put

Triage: needs-triage
Blocked by: None

## Why

The structure part carries the wrong symbols more often than the right ones. Across the 25 benchmark Conversations of 2026-10-13/14 (1,689 symbol slots), 43.6% of carried symbols were defined in a file the Turn named or read, or were written as code in the Turn's final reply. The part changed between consecutive Calls of one Turn in 202 of 388 pairs (52.1%), at about 378 tokens each time.

`symbolsInPlay` (`src/symbols.ts`) causes this in three ways:

- **Tool names match the Codebase.** The harness's `read` tool, scanned as `read({...})`, counts as `read()` written as code. It brought in `DocStore.read()` on 251 slots and was involved in 141 of the 202 changes.
- **Ordinary words match functions and types.** Only words matching *methods* are set aside today, so "explain", "summarise", "conversation" and "report" bring in `explain()`, `summarise()`, the test helper `conversation()` and `report()`.
- **A file the prompt names ranks last.** With the default 3 symbols, "Read src/journal.ts" carried three test helpers and nothing from `journal.ts`. In 255 of the 493 Calls whose prompt names a file, nothing from that file was carried.

Since `pack-parts-follow-the-turn`, a changed structure part costs only its own uncached tokens, not the cache beneath it. The main problem is now wrong picks, not churn.

The first after-audit fixed the tool-name and file-ranking causes but not the total: correct slots went from 43.6% to 42.2%. In run 2, `test/` took 82 of 270 slots and none were correct. Most came from plain words on a Turn's first Call, before any tool result has shown code: "conversation" matched the test helper `conversation()` and `CONVERSATION` in three test files.

## What Changes

- A tool's own name no longer counts as naming a symbol. Its arguments and results are still scanned.
- A plain word, meaning one with no sign of being code, counts only when nothing in the Turn is written as code. Signs of code are a compound name, a leading `.`, a following `(`, or a capital on something other than a member. This replaces the rule that set aside only words matching methods. As a result, "does recordPack call assemble?" no longer finds `assemble()`. Writing `assemble()` still finds it, and so does naming its file.
- A file the prompt names ranks right after the names the prompt writes as code, ahead of anything only the rest of the Turn names. Files reached only later in the Turn stay last. Within a file, symbols with more connections come first, and ties go to the earlier position in the file.
- A plain word, or a bare word equal to a file's name, never reaches a symbol defined in a test or script file. Writing the name as code, or naming the file's path, still does. A test or script file is one with a directory named `test`, `tests`, `__tests__` or `scripts` in its path, or a file name `*.test.*`, `*.spec.*`, `*_test.*` or `test_*`.
- Unchanged: the part is not frozen within a Turn, test and script files are not ranked lower when the evidence is strong, and `MESSAGE_HEAD`, `RECENT_MESSAGES` and the name-splitting fallback stay as they are.
- A before/after audit of the benchmark runs, written up under `docs/benchmarks/` with the query that produced it. It passes when correct % rises, changed % falls, and the structure tokens re-written per pair of consecutive Calls do not rise.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `graph-store`: "The symbols in play are found by name" (plain words count only when nothing is written as code, and never reach test or script files) and "The symbols in play are those the Turn is working with" (tool names excluded, a file the prompt names ranks ahead of what the rest of the Turn names, and a bare file-name word does not reach a test or script file).

## Impact

- `src/symbols.ts`: `prepare`, `widerText`, `mentioned`, `symbolsInPlay`, `throughFiles`.
- `test/graph.test.ts`: new cases at the `symbolsInPlay` seam. Two existing cases assert that a plain word sitting beside a compound name is found, which this change reverses; they are rewritten.
- `README.md`: the paragraph on how symbols in play are chosen.
- `test/graphify.test.ts`: the refresh case reads the refreshed graph through a fresh Store. It failed at HEAD before this change: since `e6c0dfb` a Store that has read a graph serves it while the newer one loads in the background, as the graph-store spec requires.
- `docs/benchmarks/`: the audit write-up.
- No configuration, storage or Accounting change.
