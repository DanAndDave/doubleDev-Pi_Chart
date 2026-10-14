## Context

See proposal.md (Why). The current state the design has to fit:

- `symbolsInPlay(graph, turn)` in `src/symbols.ts` is the only selection entry point. `src/extension.ts:2194` passes its result to `neighbourhoods()` and then slices to `graphSymbols * 2`. `neighbourhoods()` keeps the input order and drops symbols that have no edges. The assembler fits what is left to the structure Budget, so **order is the whole contract**: the Budget takes symbols from the front.
- `widerText(turn)` pushes `message.toolName` (line 179), the message text, and `renderToolCall(block)` (line 184). The rendered call is `name(` + JSON arguments + `)`, so `IDENTIFIER` reads the tool name with a following `(` and counts it as written as code.
- `mentioned(graph, text)` records, for each canonical identifier, whether it is written as code, then drops plain words whose matches are all methods (`label` starts with `.`) when anything unambiguous remains. Plain words matching a function or a type stay.
- `symbolsInPlay` builds `all = mentioned(prompt + wider)` and `named = mentioned(prompt)`, then orders the result: prompt-named, then the rest of `all`, then `throughFiles(prompt + wider)`.
- `throughFiles` collects files from `PATH_TOKEN` matches (suffix match at a directory boundary) and from bare identifiers that equal a file stem (`byStem`), then concatenates `byFile` lists in Map order, which is extraction order.
- `byFile` includes each file's own node (e.g. `journal.ts` at `L1`, 26 connections in this repo's graph), so a file node is a symbol like any other.
- `PreparedGraph.incident` holds every edge that touches a symbol, in both directions. `neighbourhoods` already counts it.

## Goals / Non-Goals

**Goals:**
- One selection rule, still in `src/symbols.ts`, still deterministic for the same Turn and graph (ADR-0003).
- No change to the `symbolsInPlay` signature or to its callers.

**Non-Goals:**
- Freezing the part within a Turn. Changes cost the part's own ~378 tokens since `pack-parts-follow-the-turn`.
- Ranking test and script files lower when the evidence is strong (written as code, or a path). Nothing has measured that case; §6 covers only weak evidence.
- Changing `MESSAGE_HEAD`, `RECENT_MESSAGES`, `MAX_EDGES`, `balance`, or the name-splitting fallback.
- A lasting audit report in `/pack` or `bench-tokens.ts`.

## Decisions

### 1. Tool calls contribute only their arguments

`widerText` drops the `message.toolName` push. For each tool call it pushes `toolCallText(block).passed.slice(0, MESSAGE_HEAD)` in place of `renderToolCall(block)`. Tool results keep contributing their text through `messageText`.

Why `passed` and not a regex that strips the name: `toolCallText` (`src/messages.ts`) already separates `head` from `passed` for the shortener, so the split exists and stays the single source of how a call is rendered.

Alternative: keep the name and leave it out of the written-as-code test. That would still match `read` as a plain word when the Turn writes nothing as code, so the name would keep naming `.read()`.

### 2. Plain words count only when nothing is written as code

In `mentioned`, the `unambiguous` filter moves inside the fallback, and code alone decides first:

```ts
const all = [...mentions.values()];
const code = all.filter((mention) => mention.code);
const unambiguous = all.filter((mention) =>
	mention.symbols.some((each) => !each.label.startsWith(".")),
);
const considered =
	code.length > 0 ? code : unambiguous.length > 0 ? unambiguous : all;
```

The written-as-code test itself is unchanged. It still covers `COMPOUND`, a leading `.`, a following `(`, and a capital on a name that matches something other than a method. "Nothing is written as code" is judged over the whole text `symbolsInPlay` passes in, which is the prompt plus `widerText`. This is the same scope as today's rule (Round 2 Q4).

Why the method-only rule survives in fallback: the first after-audit (3 Conversations, 249 slots) dropped it with the rest and failed the bar, 41.8% correct against 43.6%. Every Call 0 of Turns 1–10 is in fallback, since no tool result has shown code yet, and "Read src/elision.ts" brought back `.read()` beside `ELISION()`. 24 of that run's 27 method slots were wrong. A plain word naming a function or a type is still prose, but it is the evidence the fallback exists to use; a plain word naming only a method is the case the original rule was measured on.

The two-pass ordering inside `mentioned` (code first, then plain) is kept. It is redundant now that the two never mix, but it costs nothing and keeps the round-robin loop as it is. Remove it only if a reviewer finds it misleading.

### 3. Ranking: four tiers

`symbolsInPlay` returns, de-duplicated by id, first occurrence wins:

1. **Prompt, written as code**: symbols in `all` that `mentioned(prompt)` also found, in `all`'s order. In fallback mode, when nothing is written as code, this tier is empty.
2. **Files whose path the prompt names**: `throughFiles` over the prompt's `PATH_TOKEN` matches only.
3. **The rest of `all`**: names from the rest of the Turn written as code, or, in fallback mode, every plain word (the prompt's first).
4. **Every other file**: paths in `widerText`, plus bare words that equal a file stem, from the prompt or the rest of the Turn.

Tier 1 needs one change: in fallback mode a prompt's plain word must not outrank the file the prompt names. So tier 1 keeps only the prompt's mentions that are written as code. `mentioned` returns which of its symbols came from a written-as-code mention: `{ symbols, code: Set<string> }`, or a second exported helper. Pick whichever keeps `mentioned` single-pass.

Why tier 2 counts only path-shaped tokens: a bare word that equals a stem is a plain word, and Round 1 Q3 made plain words the weakest evidence. Measured on the benchmark prompts, "explain" reaches `test/explain.test.ts`, and "report" and "sections" each reach a test file as well as the `src/` file. Promoting those would bring back the noise the plain-word rule removes. Their current place, last, is kept.

Why files the Turn opens later stay last: Round 2 Q3. The prompt is what was asked about.

### 4. Within files: most-connected first, files taken in turn

`throughFiles(graph, text)` returns its files' symbols ordered by:

- within one file, `incident.get(id)?.length ?? 0` descending, with ties going to the earlier position (the numeric part of `position`; a symbol with no position sorts after those that have one, then by extraction order);
- across files, round-robin in the order the files were first named: the first symbol of each file, then the second of each, and so on. This is the same fairness rule `mentioned` applies across identifiers ("each named symbol gets a turn before any gets a second"), so "Read src/turns.ts and src/thread-store.ts" carries both files under a Budget of 3.

The file's own node takes part like any other symbol. In this repo it is usually the most-connected (`journal.ts` 26, `readJournal()` 15, `JournalTurn` 9), and its connections say what the file imports and what imports it, which suits a prompt that names the file. Alternative: exclude file nodes. Rejected because it is a special case with no evidence behind it. The after-audit shows whether they earn their slot.

The ordering is computed per Call over at most a few files' symbols, at most tens each. No index is added to `PreparedGraph`.

### 5. Audit

The query lives in this change at `openspec/changes/structure-match-precision/audit.sql`, the archived copy being the record. It reports conversations, slots, correct slots and their %, consecutive-Call pairs, changed pairs and their %, and average structure tokens per Call, over bench Conversations whose first Call falls in a `:since`/`:until` window. A slot is correct when its file was named or read anywhere in the Turn, or when the Turn's final reply writes its name as code. That is the definition settled in Round 1 Q1 and Round 2 Q1.

Baseline (window 2026-10-13 to 2026-10-14 06:00): 25 conversations, 1,689 slots, 737 correct (43.6%), 202 of 388 pairs changed (52.1%), 378 tokens per Call, 255 tokens re-written per pair, 36.2% of slots in test or script files.

The pass bar: correct % rises, changed % falls, and the structure tokens re-written per pair of consecutive Calls do not rise. That figure is the tokens of every Call whose structure part differs from the previous Call's, divided by the number of pairs. Tokens per Call stay in the report but no longer decide the result.

The bar changed after the first audit. Round 1 Q7 set "average structure tokens do not rise", which predates the cache measure: since `pack-parts-follow-the-turn` a changed part costs only its own tokens and an unchanged one is read from cache, so what a Call pays for structure is the part re-written, not the part's size. The first audit's token rise (378 → 415 per Call) came from §4's most-connected ordering, while re-written tokens fell (255 → 211). The query reports both figures, plus the share of slots in test or script files.

The query also reports `correct_first`: the same judgement with re-reads taken out. File evidence counts only when the prompt names the file, or when the Turn's messages show it and no earlier Turn of the Conversation did. pi-chart trims old Turns out of the context, so an agent may read again a file it saw Turns ago, and under `correct` each such re-read marks that file's slots correct without the slot having helped. `correct_first` is a lower bound on the same quantity; the bar is still judged on `correct`, with `correct_first` reported beside it. Baseline: 737 (43.6%), identical to `correct`. It does not address the other bias, a slot that causes its own file to be read; that needs an ablation run with the structure part switched off, which is a benchmark change outside this one.

The after run is `bun scripts/bench-tokens.ts --runs 9 --parallel 6`: the first audit's two runs of 3 differed by under a point on correct %, so 3 cannot show a gain of a few points. The write-up goes in `docs/benchmarks/2026-10-14-structure-match-precision.md`, beside the earlier benchmark notes, and keeps the first audit's figures as its history.

### 6. Weak evidence does not reach test or script files

A file is *held back* when a directory in its path is `test`, `tests`, `__tests__` or `scripts`, or its name matches `*.test.*`, `*.spec.*`, `*_test.*` or `test_*`. The rule is decided on the path alone: pi-chart runs on any Codebase, so it can't depend on what this repository's tests happen to be called, nor on how often a name matches.

- `prepare` decides once per graph which symbols are held back and keeps their ids in `PreparedGraph.heldBack`. It leaves held-back files out of `byStem`, so a bare word equal to a file's name never reaches them, at no per-Call cost. `byFile` keeps them, so a path still reaches them.
- `mentioned` drops held-back symbols from mentions that are not written as code. It does so *after* choosing which mentions count, so the method-only rule (§2) still sees the plain word as naming a function. "Read what conversation holds" therefore finds neither `.read()` nor `conversation()`, rather than falling back to `.read()`.
- A mention written as code keeps every symbol it matches, held back or not.

Why not rank them last instead: the measured case is Call 0 with nothing written as code, where tier 3 is only plain words. Moving them last would still fill the slots whenever nothing in source matched, which is the case that produced 0% correct.

Evidence (first audit, run 2): `test/` took 82 of 270 slots, 0 correct; `scripts/` 8, 0 correct. Baseline: `test/` 490 slots at 22.4%, `scripts/` 121 at 11.6%.

## Testing seams

| Requirement | Seam |
| --- | --- |
| graph-store: found by name (plain word disregarded beside code, including functions and types; plain-word fallback; two code-written names both found; plain word reaches no test helper; test helper written as code is found; a test-helper word still sets aside a method word) | `symbolsInPlay` via `inPlay(text, graph)` in `test/graph.test.ts`, `describe("finding the symbols in play")`, with small local graphs from `readGraph(JSON.stringify(...))` as the existing cases build them |
| graph-store: the Turn (tool name names nothing; arguments still count; prompt path ahead of rest-of-Turn code; files taken in turn; most-connected first within a file; bare file-name word passes over test files; a path to a test file still counts) | `symbolsInPlay` via `turn(prompt, ...messages)` in `describe("the symbols a turn is working with")`, plus `forPath` cases in `describe("a file in play")` |
| Which paths are held back | `symbolsInPlay` via `inPlay` over a local graph with one same-named function in each candidate path: every held-back form, and look-alikes that must not be (`src/testing.ts`, `src/latest.ts`, `src/contest.ts`) |
| End-to-end: structure still reaches a tool-loop Call through a `read` call's path | Existing `register()` case "structure reaches a call whose prompt named nothing" in `test/extension.test.ts`, unchanged; it must stay green |
| Real graph: "who calls assemble" still finds `assemble()` (fallback) | Existing `test/graphify.test.ts` under `PICHART_GRAPHIFY=1`. Its refresh case, failing at HEAD for an unrelated reason, now reads the refreshed graph through a fresh Store; selection cases unchanged |
| Audit | No seam: a SQL query over the Thread Store, verified by reproducing the baseline figures above (including 255 and 36.2%) before the after run |

## Risks / Trade-offs

- [A prose question that also writes one name as code loses the plain names beside it. "does recordPack call assemble?" no longer finds `assemble()`] → Accepted in Round 1 Q3. Writing `assemble()` or naming its file still finds it. Two existing tests assert the old behaviour and are rewritten.
- [Once a tool result shows code, a Turn whose prompt is all plain words drops the prompt's plain names] → This is the intended effect of judging over the whole Turn (Round 2 Q4). The files the Turn reads take their place.
- [The file node uses one of the default 3 slots] → It carries imports and importers, which suits the question. The after-audit counts it like any other slot.
- [A bare-word stem like "report" still reaches `src/report.ts`, last] → Unchanged from today. It only fills slots the higher tiers leave empty. It no longer reaches `test/report.test.ts` (§6).
- [A Turn that asks about its tests in prose loses them until code or a path appears] → Accepted. The first tool call that reads a test file names its path.
- [A Codebase whose real source lives under `scripts/` loses plain-word matches to all of it] → Accepted; code and paths still reach it. The audit's `scripts/` slots were 0% (after) and 11.6% (baseline) correct.
- [Baseline and after runs are different workloads in time and tree] → Both use the same default workload and the same query. The baseline window predates this change's tree, and the write-up names both commits.
