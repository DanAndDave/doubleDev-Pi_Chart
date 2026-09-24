# Proposal: Enforce Single-Injector Assembly

Triage: ready-for-agent

## Why

The `context-assembly` spec promises that "no content originating from the harness's memory backend SHALL appear in any Context Pack" (`openspec/specs/context-assembly/spec.md:84-91`). Nothing in `src/` makes that true. `session_start` asks the harness, remembers the answer and reports it (`src/extension.ts:263-287`); the `context` handler then assembles identically whether `memoryOff` is `true`, `false` or `undefined` (`:224-274`). `/context-manager` prints it as a failed check (`src/install.ts:91-101`), still advisory — the first `partial` row of the audit's Spec conformance table.

So a user who ignores one stderr line runs a whole Conversation with two injectors. ADR-0003 is why the invariant exists: two systems injecting into one Context Window makes a bad Pack undiagnosable, and the setting is one key to reverse (`docs/adr/0003-deterministic-assembler.md:5`). Accounting attributes nothing to the contamination, so the diagnosis is gone afterwards too.

One unknown shapes every option: the harness may not answer `ctx.memory?.status?.()`, in which case the invariant cannot be confirmed either way, and the code already treats that as unknown rather than confirmed-off (`:197-213`). Refusing to assemble on unknown would break every harness without the status call.

## What Changes

The open question this ticket was parked on is now answered, and the answer removes the option it recommended. **Every memory backend injects into the system prompt, not the message array** — `local` "injected into the system prompt as a **Memory Guidance** block" and capped by `memories.summaryInjectionTokenLimit`, `mnemopi` "recalls relevant memories into a `<memories>` block … and **refreshes the base prompt**", `hindsight` "injected as background context" through the same backend payload `/memory view` prints (`omp://memory.md`, `omp://mnemosyne-memory-backend.md`). The system prompt is the Floor, which `CONTEXT.md` defines as the part of a Context Window the Assembler cannot reach.

Two consequences. Stripping is impossible: there is nothing in the message array to strip. And the requirement as written is satisfied by construction while the hazard is untouched — a Floor-injected block never "appears in a Context Pack", but ADR-0003's actual concern is two injectors in one Context **Window**. The requirement names the wrong noun.

So, of the four options originally set out:

- **Strip memory-originated messages** in `assemble()` — **unavailable**. Evidence above. This was the recommendation; it is withdrawn.
- **Refuse to assemble** when the backend is active — available and **rejected**: returning `undefined` hands the Turn to the harness's accumulating array (`src/extension.ts:349-359`), trading a diagnosable Context Window for the ungoverned one this project exists to replace, unrecoverably from inside a Conversation.
- **Keep it advisory** — the current behaviour; one missable stderr line that leaves nothing behind.
- **Rewrite the requirement to what is enforceable, and make the detection durable** — **chosen**. The invariant is named over the Context Window, the check stays at Conversation start, the report names the backend and the setting that disables it, and the state is recorded per Call so a contaminated Conversation is identifiable long after the line scrolled past. The Pack-level assertion survives as its own scenario, because it is still true.

Unknown stays its own state under all of it: a harness that does not answer is reported as unconfirmed and never rounded to off.

**Not in scope:** everything else in the audit. Nothing here changes retrieval, Budgets, or any Store.

## Capabilities

### Modified Capabilities

- `context-assembly`: "Assembly is the only memory injection" is rewritten to name the Context Window rather than the Context Pack, and to state that the invariant is enforced by detection and disclosure because the injection lands in the Floor. The existing "No competing injection" scenario is kept — it remains true — and joined by scenarios for an active backend, an unconfirmable one, a per-Call record, and a Turn that completes anyway.
- `pack-accounting`: each Call records whether the backend was off, active, or unconfirmed, so a Conversation's exposed Calls are identifiable afterwards.

## Impact

- **Schema:** one nullable per-Call field for the backend state, through the existing migration list. Derived and rebuildable on ADR-0002's terms; absent on older rows, which the delta requires to keep reading.
- **Configuration:** none. `memory.backend` stays the user's file, and nothing here writes it.
- **Assembly:** unchanged. No filter pass, no refusal, nothing added to the path the model waits for; the state rides the Accounting write that already happens off it.
- **Unknown harness:** `undefined` stays its own recorded state, reported as unconfirmed and never rounded to off — so a harness without the status call is distinguishable from a verified-clean one.
- **Evidence, not preference:** the design's central claim is a documentation finding across three backends, and task 1 confirms it live against one before the requirement is rewritten. A backend found injecting into the message array would restore the stripping option and invalidate this plan — which is why that check is task 1.
- **Completes:** the last specified drift in `context-assembly`. Nothing in the queue waits on it, and it needs nothing from `token-budgets`.
