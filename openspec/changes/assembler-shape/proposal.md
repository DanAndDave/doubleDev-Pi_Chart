# Proposal: The Assembler's Shape After Token Budgets

Triage: needs-triage

## Why

`token-budgets` doubled `src/assembler.ts` — 687 added lines — and its code review raised three structural findings that are real, cost nothing in behaviour, and were deliberately not fixed at review close because each is a restructuring and the change under review was already proven. They are recorded here so they are owned rather than remembered.

None is a defect. Every one is a shape that will cost the next person more than it cost this one: the fifth Budget, the fifth part, or the first edit to Elision.

## What Changes

- **One Budget type instead of a pair of fields.** `CONTEXT.md` already defines a Budget as one concept in two denominations, and the code splits it into loose pairs in five places: `AssemblerConfig` (`recallTurns` + `recallTokens`, four times over), `fit(candidates, countBudget, tokenBudget, …)`, and `budget`/`tokenBudget` on `PackPart`, `RecordedPart` and `PartView`. Adding one Budget today touches `config.ts` four times, `assembler.ts`, `extension.ts`'s nine-line restatement, `README.md` and `test/fixtures.ts`. A `Budget { count: number; tokens: number }` collapses the pair and the fan-out.
- **One selection rule instead of two call sites.** `assemble()` selects each part, then `reduceToCeiling`'s `refit` map restates the identical `fit(...)` call with `room` in place of the token Budget — four times, plus `fitTail`. A fifth part means writing its selection twice. One `select(source, room)` serving both passes removes the copy.
- **Elision in its own module.** `shorten`, `shortenText`, `shortenPayloads`, `shortenTurn`, `elide`, `payloadCost`, `ELISION`, `SHORTEST_TOKENS` and `SHORTEST_HALF_CHARACTERS` are about the innards of one `HarnessMessage` — `content` blocks, `details`, `ToolCallBlock.arguments` — not about which candidates a Pack selects. That is why `assembler.ts` now imports `ContentBlock` and `ToolCallBlock` at all. `CONTEXT.md` names the concept **Elision** and only the three-line `elide` uses the word; an `elision.ts` exporting `elide(message, allowance)` would put the domain term on the seam. Selection plus Ceiling reduction is cohesive; Elision is the passenger.
- **`fitTail` owning both of its Budgets.** `fit()` computes `excludedByCount` itself while `fitTail` hardcodes it to zero and `assemble()` patches it from outside — and the Ceiling's refit closure does not patch it at all, so `Fitted<T>` means two different things depending on which producer filled it.
- **`Refit` and `Fitted<T>` reconciled.** `Refit` returns `Fitted<T>` minus `kept` plus four `PackPart` fields, so every refit closure spreads one shape into the other and discards `kept`. One shape, or an explicit `Partial<PackPart>`, leaves one thing to reason about.

**Not in scope:** any change to what a Pack *selects*. Every Pack this produces must be byte-identical to the Pack `token-budgets` produces, and a baseline over every Journal on the machine is the evidence — except where reconciling the two elision families changes the marker itself, which `design.md` records and bounds. No new settings and no spec deltas.

## Capabilities

### Modified Capabilities

- None. Every item is a restructuring behind unchanged behaviour, so this change declares `skip_specs: true` per `docs/agents/issue-tracker.md:48` rather than inventing a requirement. `context-assembly` and `pack-accounting` keep the contracts `token-budgets` gave them.

## Impact

- **Behaviour:** none intended, and the 362-test suite plus `assemble()`'s determinism tests are the guard. A finding that cannot be made without changing a Pack is out of scope and should be dropped rather than negotiated.
- **Surface:** `AssemblerConfig`, `Config`, `RecordedPart` and `PartView` all change shape if the Budget type lands, which touches the Accounting written by `token-budgets` — so this must not land while `recall-fidelity` or `store-hygiene` are mid-flight against the same files.
- **Sequencing:** no blockers, but lowest priority in the queue. It buys nothing a user can see; it buys the next Budget and the next part being cheap.
- **Origin:** the Standards axis of `token-budgets`' code review. The two defects that axis and the Spec axis found — `details` dropped without being counted or named, and `/pack` rendering no reason for a part with no count Budget — were fixed in `token-budgets` itself and are not repeated here.
