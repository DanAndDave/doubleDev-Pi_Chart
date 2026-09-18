## Context

`src/assembler.ts` is 942 lines and holds three concerns that arrived together in `token-budgets`: which candidates a Pack selects, how an oversized payload is elided, and how a Pack is brought under its Ceiling. The elision family alone — `ELISION` (:632), `SHORTEST_TOKENS` (:640), `SHORTEST_HALF_CHARACTERS` (:648), `shorten` (:679), `shortenText` (:691), `shortenPayloads` (:747), `payloadCost` (:786), `elide` (:796), `shortenTurn` (:818) — is ~200 lines about the innards of one `HarnessMessage`.

See `proposal.md` for what the code review found and why none of it is a defect. This design is about how to move the shapes without moving a single byte of any Pack.

## Goals / Non-Goals

**Goals:**

- A Budget that is one value in the code because it is one concept in `CONTEXT.md`.
- One selection rule, called from both the per-part pass and the Ceiling pass.
- Elision behind its own module, under the name the domain gives it.
- Every Pack byte-identical to what `token-budgets` produces, proven rather than asserted.

**Non-Goals:**

- Any behaviour change, including a better one. A finding that cannot be taken without changing a Pack is dropped, not negotiated.
- Touching what is selected, shortened, ranked, or reported.
- Renaming settings or Accounting fields. `CM_TAIL_TOKENS`, `tokenBudget`, `withoutCeiling` and the rest are a published surface; this is internal shape only.

## Decisions

### A `Budget` value type, and the settings stay flat

```ts
interface Budget {
	count: number;
	tokens: number;
}
```

`AssemblerConfig` carries four of them — `tail`, `recall`, `docs`, `graph` — plus `packTokens`, which is a Ceiling and not a Budget: it has no count dimension, and `CONTEXT.md` names it separately for that reason.

**`Config` keeps its flat fields.** It is the environment's shape (`CM_TAIL_TURNS`, `CM_TAIL_TOKENS`), `setBudget`'s nine names index it, and `test/fixtures.ts:settings()` writes through it key by key. Nesting it would ripple into `install.ts`'s checks and the README for no gain. The conversion lives in one place: `extension.ts`'s `deps.config` → `AssemblerConfig` literal, which is exactly the nine-line restatement the review flagged, and which becomes four `Budget` literals.

`PackPart`, `RecordedPart` and `PartView` follow `AssemblerConfig`: one `budget?: Budget` where they carry `budget`/`tokenBudget` today. **This changes recorded Accounting JSONB**, so the reader must accept both shapes — see Migration.

### One `select`, two callers

```ts
type Selector = (room: Budget) => Selected;
```

`assemble()` builds one selector per part and calls it twice: first with the part's own Budget, then — only if the Ceiling binds — with `{ count: <as before>, tokens: room }`. That deletes the four refit closures at :299-320 and the parallel `fit(...)` calls at :196-246, and makes `fitTail`'s count Budget arrive the same way every other part's does, which is what lets `fitTail` compute its own `excludedByCount` instead of `assemble()` patching it from outside.

`Selected` replaces both `Fitted<T>` and `Refit`'s return: `{ carried, messages, tokens, excludedByCount, excludedBySize, shortened, turnIndices?, conceptIds?, symbols? }`. `kept` disappears from the interface — every consumer only ever wanted the identities, which is why each refit closure spread `Fitted` and discarded `kept`.

### `src/elision.ts`, exporting the domain's verb

Moves `ELISION`, both floors, `shorten`, `shortenText`, `shortenPayloads`, `payloadCost`, `elide`, `shortenTurn`. Exports two functions: `elide(message, allowance): Shortened` and `elideTurn(messages, allowance): ShortenedMessages`. The internal five stay private.

Named for the concept `CONTEXT.md` defines rather than for the mechanic, which also removes `assembler.ts`'s imports of `ContentBlock` and `ToolCallBlock` — the tell that this code belonged to `messages.ts`'s neighbourhood and not to selection.

The alternative, leaving it in place behind a comment, loses because the module boundary is what stops the next payload rule being written inside the Ceiling reducer.

### `renderCall`'s reason table moves with nothing else

`src/report.ts`'s `REASONS` table already landed during the review fixes and is the shape the finding asked for. It stays; this change does not touch `report.ts` except where a field rename forces it.

## Risks / Trade-offs

- **A silent behaviour change is the whole risk** → the guard is byte equality, not the suite passing. Task 1 captures Packs from real Journals before any edit and compares after every step; a diff stops the change.
- **Accounting shape change breaks reading older rows** → the reader accepts both, and a store-backed test reads a row written in the old shape. Rows already written stay readable forever; nothing is migrated in place.
- **A wide diff across seven files reviews poorly** → each decision lands as its own commit, in the order above, with the byte-equality check green between them.
- **`Selected` becoming a grab-bag of optional identity fields** → it is the same set `PackPart` already carries, and the three are mutually exclusive in practice. If a fourth part type ever needs a fourth identity, that is the moment to reach for a discriminated union, not now.

## Migration Plan

1. Capture the baseline: assemble Packs from every Journal on the machine at the shipped defaults, serialise, store under `/tmp`.
2. Land the decisions in order — `Budget`, then `select`, then `elision.ts` — checking byte equality after each.
3. Accounting: `recordPart` writes `budget: Budget`; `inspectCall`/`viewPart` read either shape, preferring the new. No `UPDATE`, no migration number — the column is JSONB and the old rows are valid history.
4. Rollback is `git revert` per commit; nothing is written to the store that the old code cannot read.

## Testing seams

| Requirement | Seam |
| --- | --- |
| Every Pack stays byte-identical | `assemble()` boundary over real Journal fixtures: serialise the Pack before and after, compare. This is the change's only real test, and it is a throwaway script, not a permanent one — its value expires when the change lands. |
| Budgets bind as before, in both denominations | The existing `assemble()` tests, unchanged. If one needs editing to pass, the refactor changed behaviour and is wrong. |
| Elision behaves as before | The existing shortening tests, moved to `test/elision.test.ts` with their assertions untouched. |
| Accounting reads both shapes | Store boundary (`CM_DATABASE_URL`): write a row in the old shape by hand, read it through `readAccounting`, assert the view. |
| The inspector renders unchanged | The existing `report.test.ts`, unchanged. |

The existing suite is the seam: a refactor that needs new behavioural tests is not a refactor. The only new test is the old-shape Accounting row, because that is the one genuinely new behaviour — tolerating a shape the code no longer writes.

## Open Questions

None. One deliberate non-decision recorded: whether `Config` should eventually nest its Budgets too. That is a question about the environment surface and the README, and it is answerable on its own once this lands.
