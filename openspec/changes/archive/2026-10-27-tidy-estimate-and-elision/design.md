## Context

`estimate-counts-what-is-sent` (archived 2026-10-27) extended the estimate's denylists and re-measured the Ceiling's headroom from 1.5 to 1.85. Its review raised three findings that are shape, not behaviour. This change resolves them and nothing else.

What each finding looks like today:

- `src/tokens.ts`: `serialized` (lines 70-79) and `withoutUnsent` (lines 104-110) each build a fresh record from `Object.entries` minus a denylist. `serialized` also skips `undefined` values and maps `content` through `sentContent`.
- The calibration figures, by place:

| Place | Bias (1.57× / 1.84× / 1.85) | ~28,000 Floor | ~583,000 | ~93,000 |
| --- | --- | --- | --- | --- |
| `approximateTokens` doc, `src/tokens.ts` | yes | | | |
| `tailTokens` doc, `src/config.ts` | yes | yes | | |
| `DEFAULT_PACK_TOKENS` doc, `src/config.ts` | 1.85 | yes | yes | yes |
| `PICHART_PACK_TOKENS` row, `README.md` | 1.85 | yes | yes | yes |

- `src/elision.ts`: `elide` destructures `{ floor = 1 }` from an `Elision` options object. Three callers pass `{ floor: … }` (`shortenText`, `elideArguments`, `elideLine`); `src/assembler.ts` (twice) and `src/embed-text.ts` pass nothing. No test or script calls `elide` directly.

## Goals / Non-Goals

**Goals:**

- One copy-without-keys loop in `src/tokens.ts`.
- One place in the code that states the Ceiling's derivation and its figures.
- `elide`'s optional floor as a plain parameter.

**Non-Goals:**

- Any change to an estimate, an elision's output, a default or a Budget.
- Any change to the denylists or the calibration itself.
- README sections other than the `PICHART_PACK_TOKENS` row.

## Decisions

### One helper, with a value mapping

The helper is `copyWithout(source, unsent, sent)`: it walks `Object.entries(source)` in order, skips a key the denylist marks and a value that is `undefined`, and stores `sent(key, value)` for the rest; `sent` defaults to the identity. `approximateTokens` calls it with `UNSENT` and a mapping that sends `content` through `sentContent`. A block calls it with `UNSENT_IN_BLOCK` alone. `serialized` and `withoutUnsent` were each left a one-line wrapper around the helper, so they are inlined into their single callers rather than kept as names.

Skipping `undefined` in the block copy is not a change in output: `JSON.stringify` drops an `undefined` property either way, and the block copy only ever feeds the message's `JSON.stringify`. Key order follows the source in both, as before, so the estimate stays independent of insertion history.

Considered: a helper without the mapping, with the caller rewriting `content` afterwards. Rejected, because reassigning a key that the copy already holds keeps its position but costs a second write per message inside the shrinking loops, and a key the source had as `undefined` would need its own guard.

### The derivation lives on `DEFAULT_PACK_TOKENS`

The figures exist to justify that default, so its doc keeps them: the median and p90 bias over 624 vanilla Calls, the 1.85 headroom, the ~28,000 Floor, `300,000 × 1.85 + 28,000 ≈ 583,000` and `(200,000 − 28,000) / 1.85 ≈ 93,000`. The median and the Call count move there from the other two comments, so nothing measured is lost.

- The `approximateTokens` doc keeps the qualitative fact, that the estimate under-counts the reported window, and names `DEFAULT_PACK_TOKENS` for the figures.
- The `tailTokens` doc keeps "derived from measurement, not taste" and names `DEFAULT_PACK_TOKENS` for the derivation, which it already did.

### The README keeps what an operator acts on

An operator reading the settings table needs two numbers: what window the default presumes (~583,000) and what to set on a 200,000-token window (~93,000). Both stay. The inputs to the formula, the 1.85× bias and the ~28,000 Floor, are for whoever re-derives the default, so the row names `DEFAULT_PACK_TOKENS` in `src/config.ts` for them instead. The row already cites code by symbol elsewhere (`ensureIdentities`, `readBundle`), and a symbol survives an edit where a line number would not.

So after the change, `grep -rn '1\.85\|583,000\|93,000' src README.md` finds the `DEFAULT_PACK_TOKENS` doc, the README row's ~583,000 and ~93,000, and the unrelated `1.85×` interval in the README's plain-omp comparison table.

### `floor` is positional

`elide(text, characters, floor = 1)`. An options object earns its keep when it has several fields or when positional arguments would be ambiguous. One optional number after two required ones is neither. The `floor` field's doc moves into the function's prose doc, the convention every other function in `src/` follows.

## Risks / Trade-offs

- **A pointer can go stale too.** If `DEFAULT_PACK_TOKENS` is renamed, the comments naming it are wrong. That fails visibly in a grep, which a disagreeing copy of the figures does not.
- **The README row is less self-contained.** A reader who wants to know where ~583,000 comes from has to open `src/config.ts`. The figures they act on are still in the row.

## Testing seams

No behaviour changes, so there is no red step: the existing tests at the existing seams are the characterization, green before and green after, with no edits beyond call shape.

- The copy helper is tested through `approximateTokens` in `describe("the token estimate")` of `test/assembler.test.ts`, which pins unsent message fields, unsent block fields, key-order independence and the whole-message count.
- The `elide` signature is tested through `assemble` in `test/elision.test.ts` and through `test/recollection.test.ts`, which reach all three floor-passing callers. `bun run typecheck` proves every caller moved, since an object passed where a number is expected does not compile.
- The comment and README edits have no seam; they are checked by the grep above.
