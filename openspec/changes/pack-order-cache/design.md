## Context

The audit's prompt-cache finding is the queue's only **[INFERENCE]**, and it stays marked: volatile per-Call retrieval sits ahead of the stable verbatim tail (`src/assembler.ts:202-267` before `:169`), caching is prefix-based, and recall changes every Call by construction (`docs/audits/2026-09-16-functionality-audit.md:164`).

Nothing reproduced it because nothing reads the figure that would. Each Call's Journal entry carries `usage.input`, `cacheRead` and `cacheWrite`; `src/messages.ts:36` types `usage` as little more than `totalTokens`, and Accounting keeps the reported window sizes without what they cost (`src/accounting.ts:235-241`). See `proposal.md` for motivation; the last decision says why there is no delta spec.

## Goals / Non-Goals

**Goals:**

- What a Pack costs, recorded per Call beside what it contained.
- A baseline separating "the order defeats the cache" from "the Floor caches".
- A rule fixed before the outcome, and a negative result recorded.

**Non-Goals:**

- Reordering anything: a follow-up change, conditional on the result.
- Cost in currency; prices drift and are derivable from tokens.
- Cache lifetime and breakpoints — unreachable through `context`.
- Budgets and the ceiling; `token-budgets` owns them.

## Decisions

### The rate that matters is the cached share of the Pack, not of the input

The audit's 91–93% is `cacheRead` against total input, and total input is Floor-dominated: the Floor is 25,588 of a 29,328-token window in the captured Journal (`test/fixtures/journal-tool-session.jsonl:6`), or 87%. A world where the Floor caches perfectly and the Pack body never does also reports about 90%, so the headline figure agrees with the inference it was quoted against and decides nothing either way.

The Floor is the head of the prefix — system prompt, tool schemas, skills and rules precede the messages — so cached Pack tokens are `max(0, cacheRead − floorTokens)` over `packTokens`, both already recorded (`src/accounting.ts:238-240`). On that Call, `cacheRead` of 20,488 falls below the Floor's 25,588: none of the Pack was cached, where the naive rate reads 69.9%. An order of magnitude turns on the derivation, so it is stated before measuring, and it rests on an identity — `input + cacheRead + cacheWrite` equals `promptTokens` (4 + 20,488 + 8,836 = 29,328) — that task 1 verifies across every Journal.

### The figures are recorded where the snapshot already is

`usage` and `contextSnapshot` sit on the same branch entry — the assistant message the Call produced — on all five Calls of the captured Journal (`test/fixtures/journal-tool-session.jsonl:6,10,13,16,19`). `measurementsOf` already walks that entry and numbers it to its Call address (`src/extension.ts:899-917`); `reconcile` writes on the background path (`src/extension.ts:823-833`), so recording cannot delay a Call.

So it is one widened row on an existing walk: three nullable integers on `call_accounting` beside `pack_tokens` and `floor_tokens`, through the migration list the store keeps (`src/postgres-store.ts:103-114`). Reversible on ADR-0002's terms — the Journal is the record, the store derived — so dropping the columns loses only what re-ingest rebuilds. A reader in the `context` handler would be too early: a Call's cost does not exist until it has answered. Three figures rather than the whole object, because `totalTokens` is redundant, `cost` is provider pricing under a table describing Context Windows, and JSONB would keep fields nobody validated.

### The baseline covers governed Calls only, and is collected after `token-budgets`

An ungoverned Conversation was sent the harness's own accumulate-forward array, which caches well by construction, and the audit's rate is not attributed either way — so a retrospective over the 219 Journals would measure the wrong system. A governed Call is exactly one with recorded Accounting at that address, so the baseline keeps only Calls present in both. That join supplies a variable free: `RecordedPart.turnIndices`, `conceptIds` and `symbols` (`src/accounting.ts:57-62`) give each leading part's identity per Call, so "did the head change" needs no new instrumentation.

`token-budgets` changes what a stable tail is. Bound by size as well as count, the tail's contents move when a Turn grows, not only when one drops out, and elision markers change bytes inside a Turn that never left. A tail can slide for reasons unrelated to Turn count, so measuring first would describe a tail that stops existing. Hence `Blocked by: token-budgets`, and hence three relationships rather than one rate: hit rate against Call position within a Turn, against whether the leading parts changed, and against tail-slide frequency.

Cache lifetime is the third confound, separated rather than modelled: the usage names its own (`cttl.ephemeral1h`, `test/fixtures/journal-tool-session.jsonl:6`) and Journal entries carry timestamps, so wider-spaced pairs are excluded rather than averaged in.

### The decision rule is fixed before the number is seen

Over Call pairs consecutive within one Turn, governed, and inside the cache lifetime:

- **Reorder justified** when all three hold: on pairs where the head changed and the tail did not, the median cached Pack share is below 0.25, so the body is being re-written; the `cacheWrite` tokens on those pairs are at least 10% of total input across the baseline, so the amount is material; and the tail slides on fewer Calls than the head changes, so a stable prefix is left to protect.
- **Inference refused** when the median cached Pack share on those pairs is above 0.75. The body survives a changed head, and the order stays.
- **Inconclusive** between the two, or when fewer than 200 qualifying pairs across at least 10 Conversations survive the filters. Inconclusive is not a reorder.

Every outcome lands in `docs/adr/0004-*`, negative and inconclusive included. An unrecorded measurement leaves the next reader to re-run it, which is how an inference survives being disproved.

### The current order encodes a claim, and only a number may overrule it

The code states the order three times (`src/assembler.ts:202-203,229-230,249-250`): retrieval is background for the exchange that follows, and structure is what the Codebase is, so it precedes what was said about it. A reorder puts recalled Turns, Concepts and structure between the tail and the prompt — exchange, then background, then the question — and no Journal figure reports what that does to an answer. ADR-0001 names prompt-cache cost as a reason the stateless-per-Turn design was rejected (`docs/adr/0001-omp-extension-not-own-loop.md:7`), so cost is admissible evidence, not sufficient evidence. Hence a reorder is its own change: it owes a quality argument too.

### No requirement changes until a reorder lands

No capability states a composition order: `openspec/specs/context-assembly/spec.md:27,102,160,189` name the parts, their distinctness and their Budgets, never their sequence. Copying a diagnostic figure the Journal already holds into Accounting changes nothing promised to a user, so this slice declares `skip_specs` and writes no `specs/` directory. A `context-assembly` requirement fixing the order is owed by the reorder, with the result behind it.

## Risks / Trade-offs

- **The baseline may return inconclusive and nothing ships** → legitimate, and cheap: three columns and a script. The alternative is reordering on an unreproduced inference.
- **The 10% bar is itself a guess** → made before the number, and task 1 reports its figures against it, so a later reader sees how close the call was.
- **Governed Calls may be too few to reach 200 pairs** → the rule returns inconclusive and the ADR records the sample size, not a rate from twelve pairs.

## Testing seams

| Requirement | Seam |
| --- | --- |
| The reported cache figures are read from a Call's branch entry | `measurementsOf` boundary, over the captured Journal fixture. |
| The figures reconcile with the reported window size | Same boundary: `input + cacheRead + cacheWrite` against `promptTokens`, on the fixture's five Calls. |
| Cache figures are recorded against the Call that incurred them | Accounting boundary via `recordMeasurements`; store-backed for the migration and read-back. |
| A Call whose usage is absent records no invented figure | Accounting boundary: a branch entry with a snapshot and no usage. |
| The cached share of a Pack is derived against the Floor | Inspection boundary, pure, over recorded Accounting. |
| The baseline reports hit rate against position, head change and tail slide | Script over real Journals joined to Accounting — not a permanent test. |

`measurementsOf` is the target seam: the highest seam that sees a branch entry, pure, needing no container and no model. Only the recording and read-back rows need `CM_DATABASE_URL`; nothing needs `CM_EMBED=1`, `CM_LIVE=1`, `CM_GRAPHIFY=1` or `CM_OPENSPEC=1`, so the default suite stays container-free, model-free and network-free. A measurement slice earns instrumentation tests and no behavioural tests, because no behaviour changes. The baseline is a script beside `scripts/measure-doc-threshold.ts`, the way the audit's figures were derived: re-runnable, not asserted.

## Open Questions

Both genuinely blocked:

- **Whether to reorder.** Blocked on the baseline, and answered by the rule above rather than by judgement after the fact. It ships as a follow-up change with a `context-assembly` delta, or not at all.
- **Whether cache accounting is permanent.** Serving only this decision makes it an instrument, which leaves with the ADR; proving to be something a user tunes Budgets by makes it part of `/pack`, and `pack-inspection` owes a requirement.
