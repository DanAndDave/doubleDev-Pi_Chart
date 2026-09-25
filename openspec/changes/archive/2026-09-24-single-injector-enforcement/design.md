## Context

`context-assembly` carries a `SHALL` with no code behind it: "no content originating from the harness's memory backend SHALL appear in any Context Pack". `session_start` asks the harness, remembers the answer and reports (`src/extension.ts:263-287`); the `context` handler then assembles identically whether `memoryOff` is `true`, `false` or `undefined` (`:290-348`). ADR-0003 is the reason the invariant exists — two systems injecting into one Context Window makes a bad Pack undiagnosable.

`proposal.md` set out four options and recommended stripping memory-originated messages inside `assemble()`, on the open question of whether such messages are identifiable. **That question is now answered, and the answer removes the option.** Every backend injects into the system prompt, not the message array:

- `local` — "injected into the system prompt as a **Memory Guidance** block", bounded by `memories.summaryInjectionTokenLimit`, "Shared approximate token cap for the summary and captured lessons injected into the system prompt" (`omp://memory.md`).
- `mnemopi` — "Recalls relevant memories into a `<memories>` block for the first model turn of a session and **refreshes the base prompt**" (`omp://mnemosyne-memory-backend.md`); `memory_edit` "does not rewrite already injected `<memories>` context".
- `hindsight` — "Recall is injected as background context, not instructions", through the same shared backend interface, whose payload `/memory view` prints as "the current backend injection payload" (`omp://memory.md`).

The system prompt is the Floor, and `CONTEXT.md` defines the Floor as the part of a Context Window the Assembler cannot reach. So there is nothing in the message array to strip, and no filter in `assemble()` can touch the contamination.

That also makes the requirement's present wording unfalsifiable in the wrong direction: a Floor-injected `<memories>` block never "appears in a Context Pack", so the sentence is satisfied by construction while the hazard ADR-0003 names — two injectors in one Context **Window** — is untouched. The requirement is about the wrong noun.

## Goals / Non-Goals

**Goals:**

- A requirement that names the hazard that exists: the Window, not the Pack.
- Detection that cannot be mistaken for confirmation, including when the harness stays silent.
- A Conversation run with two injectors identifiable afterwards, not merely suspected.

**Non-Goals:**

- Filtering memory content out of a Pack. There is nothing there to filter.
- Refusing to assemble. See the decision below.
- Reading, parsing or measuring the harness's memory content. Its size already shows up in `floorTokens`, which is recorded per Call (`src/accounting.ts:235-241`); this slice adds the state, not the payload.
- Disabling the backend on the user's behalf. `memory.backend` is the user's configuration file.

## Decisions

### The requirement names the Context Window, and enforcement is detection

Two of the proposal's four options are now unavailable and one is wrong:

- **Strip in `assemble()`** — impossible. The content is in the Floor. The evidence is above.
- **Refuse to assemble when the backend is active** — available, and rejected. Returning `undefined` hands the Turn to the harness's own accumulating array (`src/extension.ts:349-359`), which is the unbounded Context Window this project exists to replace. Trading a diagnosable Window for an ungoverned one makes the failure worse, and it punishes the user for a setting in a file rather than fixing it. It is also unrecoverable from inside a Conversation.
- **Keep it advisory** — the current behaviour, and insufficient on its own: one stderr line at `session_start` is missable and leaves nothing behind.
- **Rewrite the requirement to match what is enforceable, and make the detection durable** — chosen. The spec names the Window, the check stays at `session_start`, the report names the backend and the setting that disables it, and the state is recorded per Call so the Conversation's Accounting answers "was this window contaminated" long after the line scrolled away.

This is a deliberate spec edit, not drift: the old sentence is kept as its own scenario, because "no memory content in a Pack" remains true and worth asserting — it is simply not the whole invariant.

### Unknown is its own state, and is never rounded to off

`memoryOff` is already tri-state (`src/extension.ts:267-269`): `true`, `false`, or `undefined` when the harness does not answer. The existing code reports the silent case explicitly, and that judgement holds — an invariant that cannot be checked is not a confirmed one.

So the recorded state is three-valued too. Rounding unknown to off would make a harness without the status call indistinguishable from a verified-clean one; rounding it to active would make every such harness report contamination it may not have.

### The state rides the existing Accounting write, not a new path

`recordPack` already runs through `inBackground` off the request path (`src/extension.ts:343-346`), and `call_accounting` already takes per-Call fields through the migration list (`src/postgres-store.ts:103-114`). One nullable column, written with the row that is already being written, costs nothing on the path the model waits for and is reversible on ADR-0002's terms — drop the database, re-ingest, lose only the state of Calls already gone.

The alternative — a separate table, or a session-level record — loses the join that makes the question answerable: "which Calls were exposed" is a per-Call question because a Conversation can start with the backend active and be fixed mid-flight.

### The report is emitted once per Conversation, not once per Call

The check happens at `session_start` and the answer does not change within a Conversation unless the user edits configuration mid-flight, which does not re-fire the event. Reporting per Call would emit one line per model request and train the user to ignore it; the existing single report is the right cadence, and the Accounting record is what makes it durable.

`/pi-chart` already prints the same condition as a failed check (`src/install.ts:91-101`) and stays as the on-demand view.

### Nothing is measured about the memory payload itself

A tempting extra is to report how many tokens the backend's block costs. `floorTokens` already carries it — the Floor is measured per Call and reported (`src/accounting.ts:235-241`) — and attributing a slice of the Floor to a component the Assembler cannot see would require parsing the system prompt, which this project does not do and should not start doing.

## Risks / Trade-offs

- **The spec promises less than it did** → it promises something true and checkable instead of something unfalsifiable. The Pack-level assertion survives as a scenario; the Window-level hazard becomes stated rather than implied.
- **A user can still run two injectors** → and will now see a report naming the backend and the remedy, and leave a per-Call record behind — which is what survives the line scrolling away. Prevention was never available to the Assembler; this slice makes the failure diagnosable, which is exactly what ADR-0003 asks for.
- **One more nullable column** → dropped and rebuilt with the rest of the derived store; absent on older rows, which the delta requires to keep reading.
- **The evidence is documentation, not a live experiment** → the three quotations agree across three backends, and `/memory view`'s own description ("the current backend injection payload") corroborates them. Task 1 confirms it live against one backend before the requirement is rewritten, so the spec edit rests on a measurement rather than on a doc read.

## Testing seams

| Requirement | Seam |
| --- | --- |
| No competing injection | `assemble()` boundary: a Pack's messages come only from the parts the Assembler composed. |
| An active backend is reported | Extension boundary with a stub `ctx.memory.status` and a stub reporter. |
| A backend that cannot be interrogated is unconfirmed | Extension boundary, `status` absent and `status` throwing. |
| A contaminated conversation is diagnosable afterwards | Accounting boundary via `recordPack`, then the inspection API; store-backed (`PICHART_DATABASE_URL`) for the read-back. |
| An active backend does not cost the turn | Extension boundary: assert a Pack is still returned and the Turn completes. |
| A confirmed-off backend is silent | Extension boundary: assert no report and the recorded state. |
| The state is retained for every call | Accounting boundary; store-backed for the read-back. |
| Unconfirmed is distinguishable from off | Accounting boundary. |
| Exposed calls can be listed for a conversation | Store boundary (`PICHART_DATABASE_URL`) over a Conversation whose state changes between Calls. |
| Records written before this detail existed remain readable | Store boundary: read a row written without the column. |

The extension boundary is the target seam — it is where the harness's answer arrives and where the report and the record are decided, and a stubbed `ctx.memory` needs no container, model, or network. Only the read-back rows need the store-backed suite; task 1's live confirmation needs `PICHART_LIVE=1` and a deliberately misconfigured harness.

## Open Questions

None. Task 1 confirms the Floor-injection finding live before the requirement is rewritten; if a backend is found that injects into the message array instead, the stripping option returns and this design is wrong — which is why the confirmation is task 1 and not task 9.
