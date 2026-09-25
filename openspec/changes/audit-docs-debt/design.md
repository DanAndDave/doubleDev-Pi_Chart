## Context

The functionality audit's last four items are documentation: a variable documented and unread, a variable read and undocumented, a write into the user's own files that nothing warns about, and one understatement restated three times. `proposal.md` has the detail; this file exists because every other change in the tree carries one, and because two decisions here are worth stating before the edits rather than after.

## Goals / Non-Goals

**Goals:**

- Every claim in `README.md` true of the code as it stands today, not as the audit found it.
- The reconciliation done in both directions, so the settings table is complete rather than two items less wrong.

**Non-Goals:**

- Any change under `src/`. A claim only code can make true is documented as today's behaviour.
- Rewriting the README's shape, tone or ordering. This is a correction, not an edit pass.

## Decisions

### Documentation describes today, and names the change that alters it

The audit was written before `store-hygiene`, `recall-fidelity`, `doc-authoring` and `pack-order-cache` shipped, and three of its four items moved underneath it: `CM_PG_PORT` became readable, vector provenance arrived for Turns, and `ensureIdentities` acquired a sibling that writes far more deliberately. So each item is checked against the code at the moment of writing rather than against the audit's description of it, and where behaviour differs by branch — a declined Thread Store against an unreachable one — the README says which is which instead of collapsing them.

### The README cites symbols, never line numbers

A first draft cited `file:line` for each corrected claim. Line numbers in a user-facing document are stale the next time anyone touches the file, and this change exists because documentation drifted from code once already. Symbols — `loadConfig`, `ensureIdentities`, `embedPending` — survive an edit and are greppable.

### A code gap found while correcting a sentence is recorded, not fixed

Writing the `CM_EMBED_MODEL` row turned up that Concept-section vectors carry no model provenance, so a same-width model swap leaves curated knowledge ranking one model's query against another's vectors — the failure `recall-fidelity` removed for Turns. The row states that as today's behaviour, and the finding goes to the audit for whoever plans next. Fixing it here would be a schema change inside a change that promised to touch no code.

## Risks / Trade-offs

- **An honest README is longer and less inviting** → declining the Thread Store now reads as declining three capabilities, and the Doc Store admits it writes to disk. Both were true and silent before.
- **No test can hold these claims true** → they are prose about behaviour, and the only guard is a reader checking each against the code. That is what this change is, and what the next audit is for.

## Testing seams

None. Nothing under `src/` or `test/` changes, so there is nothing to assert that would not be a test of the English. The verification is task 6: the diff's shape, and every corrected claim re-read against the code that makes it true.

## Open Questions

None.
