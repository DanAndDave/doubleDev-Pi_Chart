## Context

See proposal.md (Why) for the incident, and ADR-0012 for the rule. Current code:

- `fitTail` (`src/assembler.ts`) keeps whole Turns newest-first under the tail token Budget. When none fits, it carries the newest through `elideTurn` (`src/elision.ts`), which shortens payloads oldest-first. Each one keeps at least `SHORTEST_TOKENS` (200), and the function never removes a message. `fitTail` returns nothing when its budget is 0. That is how a tail token Budget of zero disables the tail, but the same check also fires when the ceiling leaves zero room.
- `reduceToCeiling` re-runs the tail's selector under the room left. When the result exceeds the room (`usable` false), the part is set to nothing and marked `absent: "size"`. Only after that is the current Turn elided, by `elideTurn`.
- Turns are split at `role === "user"` (`src/turns.ts`), so a Turn has exactly one user message: its prompt, at index 0. `paired()` has already withheld unanswered calls before `fitTail` runs.
- Test fixtures and older Journals can carry a `toolResult` with no assistant call before it (`bulky()` in `test/assembler.test.ts`).
- `approximateTokens` is the serialised length over four. It is additive over messages, up to rounding.

## Goals / Non-Goals

**Goals:**
- One function owns "the newest tail Turn shrunk to a room". `fitTail` calls it for the tail Budget, and the ceiling calls it through the same selector.
- Accounting, `/pack` and the overrun announcement can tell dropped messages from shortened content.

**Non-Goals:**
- The current Turn's rule. `elideTurn` stays what the ceiling applies to it.
- Older tail Turns: they are still kept whole or evicted whole. Eviction policy belongs to `tail-evicts-to-low-water`.
- Recollection rendering, and recall changes.

## Decisions

### A Turn's shape: prompt, groups, final reply

`shrinkTurn(messages, allowance)` lives in `src/elision.ts` beside `elideTurn` and splits a Turn into three pieces:

- **Prompt**: index 0.
- **Final reply**: the last message, if it is an assistant message carrying no tool call. Otherwise there is none, and the smallest form is the prompt with its marker.
- **Groups**: everything in between, in order. A group is an assistant message plus the `toolResult` messages answering its calls, matched by `toolCallId`. An assistant message with no calls (interim prose, thinking only) is a group of one. So is a `toolResult` with no matching call. Every message between the prompt and the final reply belongs to exactly one group, so dropping groups can never orphan a call or a result.

Alternative: group by position (an assistant message and the run of results after it). Rejected: matching by id is what makes "every carried call has its result" true by construction, whatever order the results were recorded in.

### Fit search: fewest groups dropped, by binary search

`form(k)` is the Turn with the oldest *k* groups dropped and the marker on the prompt. The result is the smallest *k* for which `elideTurn(form(k), allowance)` fits. Payloads are still elided first, and groups are dropped only when elision alone cannot reach the allowance. That is the order the spec states.

Fit is monotone in *k*: dropping a group never adds tokens, though the marker grows by a few characters when a new tool name appears. So a binary search over `[0, groups]` finds the same *k* as a linear scan, in O(n log n) instead of O(n²). On 431 messages a linear scan is about 431 full elision passes. The search is a pure function of the messages and the allowance, so ADR-0003's determinism guarantee holds.

The marker can make a probe a few tokens heavier than a linear model predicts. The search therefore checks each probe's real size rather than trusting an estimate, the same discipline `shortenText` follows.

`k = 0` means `form(0)` is the Turn unchanged, with no marker. A Turn that fits whole, or fits by eliding alone, therefore comes back exactly as `elideTurn` would return it today.

### Below the smallest form

When `form(all)` with payloads elided still exceeds the allowance:

1. The final reply's text is elided head-and-tail with `elide()`. The floor is `SHORTEST_HALF_CHARACTERS`, the same marker shape as for a tool result.
2. The prompt's text is elided the same way, and the drop marker is appended after elision so it always survives.
3. What is left is irreducible. It is returned over the allowance, and the part is reported as "over its N-token budget, irreducible", as today.

`elideMessage` keeps its rule that a user prompt and assistant prose are never shortened. Both cases are new, separate steps inside `shrinkTurn`, so the current Turn's rule is unaffected.

### The marker

It is appended to the prompt's text, after a blank line. A string `content` gets the text concatenated. A block `content` gets it appended to the last text block, or a new text block is added if there is none. Shape:

`[pi-chart did not carry 412 earlier messages of this Turn: read ×140, bash ×52, edit ×13; ~460k tokens]`

- The `pi-chart` prefix matches every other pi-chart marker. ADR-0012's example omits it, and that example is illustrative.
- Tools are listed in order of first use among the dropped groups. A dropped call with no `name` counts as `unknown`.
- Messages with no tool call count toward the message total but not toward any tool.
- Tokens are the estimate of the dropped messages before elision. They are written exact below 1,000, and as `~Nk` (rounded) from 1,000 up.

Alternatives (a separate user message, or text in an assistant message) were rejected in ADR-0012.

The shrunk prompt is a new object `{ ...prompt, content }`. It keeps `timestamp`, so a stored Briefing that follows the prompt still resolves to it. Re-sending a cleared Briefing after a changed message costs nothing and saves nothing. Briefings that follow dropped messages are not sent, by the existing rule "A Briefing leaves with its message".

### `fitTail` and the zero Budget

`fitTail` calls `shrinkTurn` wherever it calls `elideTurn` today, and reports `droppedMessages`.

The check that a tail token Budget of 0 disables the tail moves out of `fitTail` to where the configured Budget is first applied in `assemble`. That way a ceiling that leaves 0 room still gets the smallest form, while a configured 0 still carries nothing. `reduceToCeiling` already skips parts that carried nothing, so a disabled tail is never re-selected.

### Ceiling: the tail is never unusable once it carried

In `reduceToCeiling`, the verbatim tail's re-selection is accepted whenever it carried at least one Turn, even when it exceeds the room. Its size then counts toward the total the same way Pins do. Every other part keeps the `usable` rule.

The final current-Turn step already computes `others` from the actual parts, so it elides the current Turn around the tail without changes. A Pack still over the ceiling is an overrun, which `Pack.approximateTokens > ceiling` already reports.

Alternative: give the tail a reserved minimum before reduction. Rejected: the minimum depends on the Turn's smallest form, which is known only after shrinking, and a reservation would take room from the current Turn even when nothing binds.

### Accounting and `/pack`

`droppedMessages?: number` is added beside `shortened` on `PackPart`, `Selected` / `Fitted`, `RecordedPart` (`src/accounting.ts`) and `PartView` (`src/inspection.ts`). It is set only when greater than zero.

- Parts are stored as JSONB, so older rows read back without the field and no migration is needed.
- `REASONS` in `src/report.ts` gains `${n} messages dropped`, ordered directly before `content shortened`.
- `reduceToCeiling` copies the field from the re-selection, as it does for `shortened`.
- The overrun announcement in `src/extension.ts` currently says only the current Turn could not be reduced. It changes to name the current Turn and the newest tail Turn as the parts that are never dropped. `test/extension.test.ts` matches only "exceeds its ceiling", so it is unaffected.

## Risks / Trade-offs

- [The marker changes whenever *k* changes, missing the cache from the prompt on] → Accepted in ADR-0012. While the Ceiling doesn't bind, *k* depends only on the Turn and the tail Budget, both fixed for a completed Turn. It changes only when the current Turn grows into the Ceiling.
- [Binary search assumes monotone fit; a growing marker could break it at a boundary] → Each probe is measured, not predicted. A non-monotone point can only make the search pick a *k* one group larger than the minimum, which still fits. Never one that doesn't fit.
- [A Turn whose last message is a tool result has no final reply, so the smallest form is the prompt alone] → The agent loses the end of that Turn's work. This happens only for an interrupted Turn, and the marker still names what ran.
- [`tail-evicts-to-low-water` also edits `tailSelector`] → No ordering dependency. Whichever lands second rebases. This change touches only the newest-Turn fallback and the zero-Budget check.

## Testing seams

| Requirement | Seam |
| --- | --- |
| The newest tail Turn shrinks by its oldest actions (every scenario) | `assemble()` in `test/assembler.test.ts`, asserting on the tail part's messages, `approximateTokens`, `droppedMessages` and `shortened`. Turns are built with a helper that produces an assistant tool call plus its result per group. |
| Packs carry … verbatim tail; Budgets bound each part (changed irreducible scenario) | `assemble()`. The existing test "an irreducible tail turn is carried and its budget reported as exceeded" uses orphan results that can now be dropped. It is rewritten so the irreducible content is a prompt and a final reply that together exceed the Budget. |
| A pack fits a ceiling (newest tail Turn survives; cannot shrink enough) | `assemble()` with `packTokens` set below the current Turn plus the tail's smallest form. Asserts the tail is carried, `absent` is undefined, and the Pack is over the ceiling. |
| Content too large … elided visibly (dropped messages say so) | `assemble()`: the marker text on the tail Turn's prompt. |
| Accounting records dropped messages | Covered through `/pack`: the report test feeds a recorded part with `droppedMessages`. A record → read round-trip would test only a copy. |
| `/pack` reports dropped messages; old records report none | `test/report.test.ts`, the existing part-rendering seam. |

The incident gets a regression test at the `assemble()` seam: one completed Turn of 200 call/result groups, a tail token Budget of 5,000, and a current Turn. Before the fix the tail exceeds the Budget by tens of thousands of tokens; after it, the tail fits and still carries the final reply and the newest groups.
