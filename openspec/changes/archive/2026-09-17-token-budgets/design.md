## Context

Twelve slices built a Pack whose composition is deliberate and whose size is not. `assemble()` is pure, deterministic, and measured: it records what every part contributed and the harness's own figures reconcile against it afterwards. What it has never had is a number it must respect.

`AssemblerConfig` is four integers (`src/assembler.ts:6-24`), each applied with `slice()`. `approximateTokens` exists and is honest about being approximate, but it is consumed only by Accounting and the report — it has never fed a decision (`src/assembler.ts:290-296`, `src/accounting.ts:109,182`). The only size-shaped limit in the repository is `MAX_EDGES = 12` (`src/symbols.ts:20`), which bounds one part.

So the machinery this slice needs is all present — parts, per-part Budgets, per-part estimates, a deterministic order, an inspector that renders it — and what is missing is one dimension on the Budget and one pass at the end of assembly.

The measurement that justifies it is in `docs/audits/2026-09-16-functionality-audit.md`: a real Turn assembles to 983,339 approximate tokens, and dropping half a Conversation by Turn count recovered 8.6% of its bytes. See `proposal.md` for motivation and the two delta specs for the contract.

## Goals / Non-Goals

**Goals:**

- A Pack whose size is bounded by configuration rather than discovered by a provider.
- Reduction by a fixed rule, so an oversized Pack is still a deterministic Pack.
- Content shortened visibly, so the agent knows to ask for the rest.
- Defaults chosen from measurement against real Journals, not from taste.

**Non-Goals:**

- A real tokenizer. The estimate stays a deterministic function of the message; see the decision below.
- Summarizing anything. Shortening is elision with a marker, never paraphrase — ADR-0003's reason for a verbatim tail is that summarizing a recent tool result breaks the agent's ability to act on what it just read.
- Changing what is retrieved, how it ranks, or the order parts appear in. Reduction removes; it does not reorder.
- Making the Store fetch less. `recentTurns` still returns whole Turns by count; only the Assembler trims by size.

## Decisions

### Counts stay; tokens are added alongside them

A count Budget is not wrong, it is insufficient. "Eight Turns" is meaningful to a person, cheap to reason about, and already tuned by evidence. The failure is that it is the *only* dimension. So each part carries both, and is trimmed to whichever binds first.

The alternative — replacing counts with tokens — loses a property worth keeping: `PICHART_TAIL_TURNS=0` is how a user says "only the current Turn", and there is no token value that expresses it.

### Enforcement lives in `assemble()`, after the count slice

`assemble()` is already the only place that sees every part at once, and it is pure. Putting the ceiling anywhere else — in the `context` handler, or per-Store — would mean either a Store deciding what another Store may have, or size enforcement outside the function the determinism guarantee is written about.

Order within the function: select by count as today, estimate, then reduce. Reducing before selection would mean trimming candidates that were never going to be carried.

### The trim order is reconstructibility, not importance

Structure first, then curated knowledge, then the weakest recollections, then the oldest Turns of the tail:

- **Structure** is the cheapest to recover — the agent can grep for a caller, and the Graph Store will offer it again next Call.
- **Curated knowledge** is machine-wide and permanent; the same Concept is retrievable next Call and reachable on demand through `walk_documentation`, which costs no Budget.
- **Recollections** are re-retrievable within the Conversation, and the weakest match is by definition the one the ranking was least sure about.
- **The verbatim tail** is irreplaceable working state: the file the agent just read, the error it just saw. Dropping it is dropping what the current Turn is reasoning about.
- **The current Turn** is never dropped. It is the prompt being answered.

This ordering is the reverse of the order the parts appear in a Pack, which is a coincidence worth stating so nobody reads it as a rule: the Pack's order encodes "background first, exchange last" (`src/assembler.ts:118-119,137-138,153-154`), while the trim order encodes "cheapest to recover first".

### The current Turn is elided rather than dropped

A current Turn that alone exceeds the ceiling is not hypothetical: the largest real Turn measured is 526,302 approximate tokens, and by the nature of a tool loop the Turn in progress grows within a single Turn. Dropping it is not an option — it is the prompt. So its tool results are elided, in place, oldest first, until the Pack fits, and the condition is reported.

This is the one case where the Assembler shortens content the model produced moments ago, so it is the case that most needs the marker.

### Shortening is head-and-tail with a marker, applied only to tool results and recollections

The end of a tool result is where the answer often is — the error line, the total, the last hunk — so head-only truncation is the wrong half. A shortened result keeps its head and its tail with a marker between them naming the elided size.

Only tool results and recollections are shortened. User prompts and assistant text are short relative to tool output, and they are the reasoning the Pack exists to carry; a shortened instruction is a corrupted instruction.

### The estimate covers the whole message and stays deterministic

Today the estimate sums `JSON.stringify(message.content)` alone. Against the harness's own reported figures it runs 1.35–1.49× low, consistently, because `details`, `toolName`, `toolCallId` and the role are all sent and none are counted.

It becomes an estimate over the whole serialized message. It stays `length / 4` rather than a real tokenizer: a tokenizer means a dependency, a model-specific answer, and a per-Call cost on the path the model waits for, in exchange for accuracy that a ceiling with headroom does not need. Both figures — estimate and harness-reported — are already stored per Call, so the residual error stays visible and the divisor can be re-derived from evidence later rather than argued about now.

Because the estimate is the thing the ceiling is applied to, its direction of error matters: it must not under-count. Whole-message estimation removes the known under-count, and the default ceiling carries headroom for what remains.

### Defaults are measured, and the reference for "too big" is the ceiling

Task 1 derived them from this machine's 219 Journals rather than asserting them. Calibration first, over 27 Calls in 9 linear Journals — the other 210 Journals are resumed or forked sessions whose reported window carries content the file does not, so they cannot calibrate an estimator and are excluded rather than averaged in:

| Estimator | reported / estimate, p10 | median | p90 | max |
| --- | --- | --- | --- | --- |
| Content only (today) | 1.283 | 1.350 | 1.557 | 2.801 |
| Whole message (this slice) | 1.113 | 1.151 | 1.447 | 2.717 |

Whole-message estimation cuts the systematic bias from 1.35× to 1.15×, and it still under-counts on 93% of Calls, so the headroom factor is the p90, rounded up: **1.5**.

The ceiling then follows from a window the operator is likely to have and a Floor this project has measured: `(200,000 − 28,000) / 1.5` → **`PICHART_PACK_TOKENS` = 110,000** estimated tokens. Per-part Budgets, in estimated tokens: **tail 25,000, recall 8,000, docs 5,000, graph 3,000** — 41,000 together, which leaves the current Turn 69,000 before ceiling reduction touches it. That allowance covers 97.4% of the 381 real Turns measured here (p95 is 14,785 and p98 is 76,132), so reduction of the current Turn stays the rare case it should be.

**The tail Budget retains the most recent Turn even when that Turn alone exceeds it.** Measured while choosing the number: on the audited Conversation the newest completed Turn is 74,216 estimated tokens against a 25,000 tail Budget, so a drop-only rule would empty the tail on exactly the Conversation where working state matters most. The delta already answers this — a tool result too large for its Budget is carried shortened — so the fill rule is: take the most recent Turns that fit, and if none fits, keep the newest with its tool results elided. That is what makes "the most recent Turns SHALL remain" true rather than vacuous. With it, that Conversation's Pack at its last Turn is 34,495 estimated tokens where it previously reached 983,339.

The share at which a Pack is reported as approaching the ceiling is **0.75**, which fires on 5 of 162 real Turns here (3.1%) — often enough to be a signal, rarely enough to stay readable. The audited Conversation does not cross it under these Budgets, which is the point: the warning is for a Pack creeping up, not for the failure this slice already prevents.

The share-crossing report is measured against the configured ceiling, not against the model's window, because the harness reports the size of each window it sent (`promptTokens`, `nonMessageTokens`) and never the model's maximum. A limit the system cannot know is a limit it must not pretend to warn about; the ceiling is the number the operator actually set.

### Payload is shortenable; reasoning is not

The first draft of this design said "only tool results and recollections are shortened", on the reasoning that assistant content is what the pack exists to carry. Implementation disproved the premise: on the audited Conversation the newest completed Turn is 74,216 estimated tokens of which **84% is assistant content**, and nearly all of that is the file contents passed as `write` arguments. A rule sparing every assistant message leaves the tail Budget unenforceable on exactly the Turns that need it.

So the line is drawn at payload rather than at role. A tool result's text, a recollection's transcript, and the **arguments of an assistant's tool calls** may all be shortened; an assistant's text blocks and a user's prompt may not. A tool call keeps its name and id either way, so the model can still see what it asked for. Applying it took the audited tail from 63,262 to 53,899 estimated tokens, and the review fix below took it to 36,324.

### A Budget can be smaller than what a part must carry, and then it says so

Even with payload shortening, that Turn does not reach 25,000: it holds 176 messages, and a head-and-tail worth reading has a floor (`SHORTEST_TOKENS`, 200 tokens), so 176 messages cannot cost less than ~35,000 however much is elided. The Budget is below the content's irreducible floor.

Three ways out, and only one is honest. Dropping messages would break the verbatim tail's contract. Shrinking the floor to fit would leave elisions too small to read. So the part carries what it must and **reports the Budget it exceeded** beside what it spent — the same resolution the ceiling already has for the current Turn. A Budget that cannot bind is still worth recording, because a user seeing `36,324 of 25,000 tokens, irreducible` learns something true, while a part that quietly overran teaches nothing.

### The harness's `details` are dropped, so they are not charged for

Found by this change's own code review, after the decisions above. Shortening deletes a tool result's `details` — they can rival the content they summarise, so a shortened message keeping them would not be shorter — but the first implementation still counted them as overhead when sizing the text's allowance, and never mentioned them in the marker.

Both halves were wrong. Charging the text for bytes being deleted starved it: measured, a 30,000-character `details` drove an otherwise 1,810-token text down to the 231-token floor against a 2,000-token Budget, so the part spent 13% of what it was allowed. And a marker counting only elided text under-reported what the shortening removed, against the delta's requirement that shortening "SHALL NOT be silent" and "SHALL say what was removed". Now the allowance is computed on the message without its `details`, the dropped `details` are added to the elided count, and the marker names them.

Measured end to end on the audited Conversation with the shipped defaults: **2,080,285 estimated tokens ungoverned, 45,819 governed** — a 97.8% reduction, within the 110,000 ceiling, against the 8.6% the count Budget alone achieved. The tail carries 36,324 of its irreducible Turn and says so.

## Risks / Trade-offs

- **A Conversation doing heavy file work will carry fewer verbatim Turns than today** → that is the intended behaviour change, and it is the one a user will notice first. `/pack` names what was dropped and why, and the count Budget remains available for a user who wants the old behaviour by raising the ceiling.
- **Elision can remove the one line that mattered** → head-and-tail retention covers the two places answers cluster, the marker states the size removed, and `recall_across_conversations` and the Journal both still hold the whole thing. This is strictly better than the present alternative, which is the provider refusing the Call.
- **The estimate is still an estimate, and now decisions depend on it** → it is deterministic, it is recorded beside the harness's own figure for every Call, and the ceiling carries headroom. The failure mode is carrying slightly less than configured, not overflowing.
- **Reduction is a second pass over every part's messages** → parts are already estimated once during selection; reduction re-estimates only the parts it touches, and only when the ceiling binds.
- **Fetching eight whole Turns to then drop five is wasted I/O** → real, and deliberately not fixed here: `recentTurns` is the Thread Store's contract and pushing size into SQL would put the trim rule in two places. Revisit only if the fetch is ever measured as a problem.
- **A ceiling set too low silently starves recall** → the ceiling reduces structure and curated knowledge before recollections, and every reduction is recorded with its reason, so a starved Pack is diagnosable rather than mysterious. `pack-why` then makes it legible.

## Testing seams

| Requirement | Seam |
| --- | --- |
| A size Budget binds before a count Budget, and vice versa | `assemble()` boundary, synthetic Turns of known size. |
| A part's size Budget is independent of the others | `assemble()` boundary: exhaust one part's token Budget, assert the others intact. |
| An oversized pack is reduced before it is sent | `assemble()` boundary. |
| Reduction follows the specified order | `assemble()` boundary: a Pack with all four reducible parts, assert what leaves first. |
| The tail is reduced from its oldest Turn | `assemble()` boundary. |
| Reduction is deterministic | `assemble()` boundary: assemble the same oversized selection twice, compare. |
| The current Turn survives a ceiling it cannot fit | `assemble()` boundary, using the largest real Turn from a Journal fixture. |
| A ceiling that binds nothing changes nothing | `assemble()` boundary: assert the Pack equals the unceilinged Pack. |
| Shortened content is marked and states what was removed | `assemble()` boundary. |
| Content that fits is untouched | `assemble()` boundary. |
| Exclusion for size is distinguishable from exclusion for count | Accounting boundary via `recordPart`, then the inspection API. |
| Reduction to fit the ceiling is recorded as its own reason | Accounting boundary, then `/pack` rendering. |
| The estimate covers the whole message | `approximateTokens` boundary. |
| Both figures are retained for a Call | Accounting boundary; store-backed for the read-back. |
| A pack approaching its ceiling is reported | Extension boundary with a stub reporter. |

`assemble()` is the target seam: it is the highest seam that sees a whole Pack, it is pure, and it needs no container, no model, and no harness. Only the recorded-reason and read-back rows need the store, and only the share-report row needs the extension.

## Open Questions

None blocking. Two recorded for later evidence:

- Whether the estimate's divisor should be re-derived per provider once estimate-versus-reported pairs accumulate across more Conversations. Deliberately not decided now; the data to decide it is what this slice starts collecting.
- Whether a future slice should let a Store bound its own fetch by size rather than count, once the wasted-fetch cost is measured rather than assumed.
