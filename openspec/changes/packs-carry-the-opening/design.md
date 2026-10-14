## Context

See proposal.md (Why) and ADR-0014 for the decision. Current state the design has to fit:

- `assemble()` (`src/assembler.ts`) builds parts in a fixed array: recalled, curated, structure, verbatim-tail, pinned, current-turn. `compose()` writes the Briefing as framing → Pins → `BRIEFING_MARKER` → `REFERENCE` parts (`["recalled", "curated", "structure"]`).
- `reduceToCeiling()` walks `REDUCTION_ORDER` (`structure, curated, recalled, verbatim-tail`), re-running each part's `Selector` with the room left, and marks a part that ends up carrying nothing `absent: "size"`.
- Absence is an `AbsenceCause` union (`disabled | unconfigured | failed | none | irrelevant | size`), rendered through the exhaustive `ABSENCE` record in `src/report.ts`.
- `src/extension.ts` fetches the tail with `tailFor()` under `tailDeadlineMs`, then recall, concepts and structure in parallel, each returning `Supplied<T>` with `unavailable: "unconfigured" | "failed"`. With no Store, `register()` gets a `MemoryTurnSource` and no `recall` dep, so recall reports `unconfigured`.
- `turns.prompt` is `TEXT NOT NULL DEFAULT ''`, keyed by `(conversation_id, turn_index)`. Turn indices are 0-based, and recollections are labelled `[recalled from turn N of this conversation]` with that index.
- Accounting stores `parts` and `budgets` as JSONB. No enum or CHECK constraint covers part names.

## Goals / Non-Goals

**Goals:**
- The Opening is a part like recall: one Store query, one `AssembleInput` field, one Selector, one reduction slot, one absence vocabulary.
- Existing tests and Packs with the Opening off are unchanged, byte for byte.

**Non-Goals:**
- Any change to recall: threshold, embedded text, query, or deduplication against the Opening.
- `/pack why <subject>` explaining an absent Opening. Its absence reason is already on the part.
- A recall-scoring set. That belongs to whichever change tunes recall.

## Decisions

### 1. A separate optional `OpeningSource` dependency, not a new `TurnSource` method

`src/thread-store.ts` gains:

```ts
export interface OpeningSource {
	/** Turn 0's prompt as stored, `""` included; undefined when no Turn 0 is stored. */
	openingPrompt(conversationId: string): Promise<string | undefined>;
}
```

`MemoryTurnSource` and `PostgresStore` implement it. `Dependencies` gains `opening?: OpeningSource`, wired to the store only on the Store-backed path of `piChart()`.

Why: the no-Store path also runs on a `MemoryTurnSource`, which would answer "no Turn 0" and report `missing` when the right reason is `unconfigured`. An absent dep gives `unconfigured` the same way an absent `recall` dep does. It also leaves the four hand-written `turns: { recentTurns, turnSizes }` doubles in `test/extension.test.ts` untouched.

Alternative: a required `TurnSource.openingPrompt`, plus a flag saying whether a Store is configured. That needs two signals for one fact.

Postgres: `SELECT prompt FROM turns WHERE conversation_id = $1 AND turn_index = 0`. It is a primary-key lookup, so no index or migration is needed.

### 2. Fetched beside the tail, each under `tailDeadlineMs`

`openingFor(conversationId)` returns `Supplied<string | undefined>` and runs in a `Promise.all` with `tailFor()`. It wraps its own `inTime("Thread Store (opening)", deps.config.tailDeadlineMs, …)`:

- not answered in time: `unavailable: "failed"`, reported by `inTime` as a missed deadline;
- thrown: reported as `Opening unavailable, pack assembled without it: …`, then `unavailable: "failed"`;
- `!deps.opening`: `unavailable: "unconfigured"`;
- `openingTokens <= 0`: no query is made, and the assembler reports `disabled`.

Why its own query and not a column on `recentTurns`: the tail query returns the newest N Turns, and Turn 0 is exactly the one it stops returning. Sharing one `inTime` would make an Opening miss cost the tail. The tail keeps its harness fallback, and the Opening never gets one (ADR-0014).

### 3. `AssembleInput.opening` and three new absence causes

```ts
opening?: string;   // Turn 0's stored prompt; undefined = not stored
unavailable?: Partial<Record<PackSource, "unconfigured" | "failed">>;   // gains "opening"
```

`PackSource` gains `"opening"`. `AbsenceCause` gains:

| cause | meaning | `/pack` wording |
| --- | --- | --- |
| `carried` | the Turns carry Turn 0 | `absent: the turns carry it` |
| `empty` | Turn 0's prompt is empty or whitespace | `absent: Turn 0's prompt is empty` |
| `missing` | no Turn 0 is stored | `absent: the first turn is no longer stored` |

Precedence, first match wins: `disabled` → `carried` → `unavailable` (`unconfigured`/`failed`) → `missing` → `empty` → `size`. Budget first matches `absence()` for other parts. `carried` is checked before `unavailable` because it is true whatever the Store did, and it is the normal state for a Conversation's first Turns.

"The Turns carry Turn 0" means the tail actually carried after selection (`inTail`), or the current Turn, has `index === 0`. A Turn without an `index` (reconstructed in tests) counts by its position in `turns`. The fallback tail already gets indices from `positioned()`.

The three causes are opening-specific. `none` ("no candidates") would misreport each of them, and `/pack` must tell them apart (pack-inspection delta).

### 4. Rendering and selection

The Opening is one user message:

```
[the opening of this conversation: the user's prompt at turn 0]
<prompt>
```

Turn 0 uses the recollections' numbering, so when recall also carries that Turn, the model sees the same number in both places.

`openingSelector(prompt)` returns a `Selector`. Within `{count, tokens}` it carries the whole message if it fits. Otherwise it elides the prompt with `elide()` to the allowance minus the header. When the allowance is below `SHORTEST_TOKENS` or `count < 1`, it carries nothing. The same Selector serves the part's own Budget and the Ceiling's re-run, as `selectRecall` does.

`AssemblerConfig.opening: Budget` is `{ count: openingTokens > 0 ? 1 : 0, tokens: openingTokens }`. The count is fixed at one item, so there is no count setting. `Pack.budgets` gains `opening: config.opening.count`.

### 5. Placement and reduction

- `REFERENCE = ["opening", "recalled", "curated", "structure"]`. `compose()` and `carriesBriefing()` follow from that list.
- `REDUCTION_ORDER = ["structure", "curated", "recalled", "opening", "verbatim-tail"]`, plus `opening: { select: selectOpening, budget: config.opening }` in the reducible map. The existing loop then shortens it to the room left and marks it `size` when nothing fits.
- The tail reduces last, from its oldest Turn, so the Ceiling can take Turn 0 from a tail that carried it after the Opening was withheld as `carried`. `reopenAfterCeiling()` then re-selects the Opening under its own Budget and the room the tail left (the framing and marker included), or records it `size`. It never takes room back from the tail, because the Opening gives way first.
- The part is pushed after `recalled` in `assemble()`. Array order matters only to tests that index `pack.parts`, and those use `find`.

### 6. Configuration

- `Config.openingTokens = count(env.PICHART_OPENING_TOKENS, 1_000)`, and the name is added to `SETTINGS`.
- `BUDGET_FIELDS["opening-tokens"] = "openingTokens"`, and `setBudget`'s error message lists it.
- `test/fixtures.ts` `budgets()` defaults `openingTokens` to 0, like every other optional part. Existing assembler tests therefore see no Opening, which is the "unchanged when off" guarantee.

### 7. Accounting, inspection, report

`recordPart` already copies `source`, `turnIndices`, `budget` and `absent` generically, so the Opening records as `{ source: "opening", turnIndices: [0], budget }`. `CallAccounting.budgets.opening?` is optional, so records written before this change still read. `ABSENCE` gains the three wordings. `renderCall` already prints any source padded to 14 characters. Compare and summary group by `source`, so the Opening enters, leaves and averages like any other part. Task 5 verifies this rather than assuming it.

### 8. Benchmark

- `DEFAULT_WORKLOAD[2]` keeps its question and appends a second fact: `Also remember this build number for later: 7341.` The workload stays at 12 turns.
- `PROBE` asks for both: the codeword from the start and the build number given later, as `codeword, build number`, with UNKNOWN for either.
- `Run.probe` becomes `{ answer, recalled, fact? }`. `recalled` keeps its name and meaning (the codeword), so `--report` on saved 2026-10-13 files still prints. `fact` is the build-number check, and the report prints it on its own line only when some run has it.
- Probes are scored only when no `--workload` file was given (`options.probed = !workloadFile`). A workload file that happens to contain `PROBE` records none.

## Testing seams

| Requirement | Seam |
| --- | --- |
| context-assembly: Packs carry the Conversation's Opening (selection, placement, elision, absence causes, stability, accounting part) | `assemble()` via `test/assembler.test.ts`. The target seam: pass `opening` and `unavailable.opening` in `AssembleInput`, and assert on `pack.parts` and the composed Briefing. |
| context-assembly: Assembled parts follow the Turn in progress (order) | `assemble()`, extending the `everything` fixture in `describe("assembled parts follow the turn in progress")` |
| context-assembly: A pack fits a ceiling (Opening's slot, shorten-then-drop) | `assemble()` with `packTokens` set |
| context-assembly: missed deadline, no Store, Store answer reaches the Pack | `register()` via `test/extension.test.ts` `harness`, with an `opening` double: never-resolving, rejecting, absent, answering |
| thread-store: The store answers a Conversation's first prompt | `turnSourceContract()` in `test/turn-source-contract.ts`, run for `memory` and `postgres`. `ContractSubject` widens to `TurnSource & TurnSink & OpeningSource`, and removal is exercised with `rewind`. |
| pack-inspection: The Opening is examined like any other part | `renderCall` / `ABSENCE` via `test/report.test.ts`; compare via `test/inspection.test.ts`; `setBudget` via the existing config tests |
| Benchmark probe | No seam: `scripts/` has no tests. Verified by a `--report` reprint of a saved run and by the full run. |

## Risks / Trade-offs

- [Every Pack past Turn 0's eviction carries up to 1,000 more tokens] → They sit after the marker, so the cached prefix is unchanged. `PICHART_OPENING_TOKENS=0` turns it off.
- [Turn 0's prompt sent twice when recall also selects it] → Accepted, at most 1,000 tokens (ADR-0014).
- [The Opening can sit in the Briefing with system authority on models that support turn-scoped system messages] → It is after the marker, and the framing says everything there is reference data. A test asserts that no Opening text precedes the marker.
- [A Conversation whose Turn 0 is a long pasted log spends the whole Budget on its elided head and tail] → Elision marks what went. The model can ask for the rest through recall.
- [A Store that drops Turn 0 by retention silently loses the goal] → It is reported as `missing` on every Call, so the loss is visible in `/pack`.
- [The probe change makes pi-chart's codeword score incomparable with earlier runs] → The codeword is still scored under the same field. Only the build number is new, and it is reported as a known weakness of recall, not a gate.

## Migration Plan

No schema change. To roll back, set `PICHART_OPENING_TOKENS=0` or `/pack budget opening-tokens 0`, which turns the Opening off without a deploy.
