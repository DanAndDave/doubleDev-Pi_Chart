## Context

The harness exposes a `context` event that fires before each LLM API call and accepts `{ messages }` as a full replacement of the array sent to the model. A probe run before this change confirmed three things the documentation left open: the replacement reaches the wire (the model answered an injected prompt and ignored the real one), the Journal on disk retained the original user text, and a single 12-token message still cost 30,447 tokens — `input: 9948`, `cacheWrite: 20488`. The last figure is the Floor, and it is roughly an order of magnitude larger than a plausible pack.

The `context` event carries messages only. It does not carry token usage, and it fires before the provider responds. Anything the Assembler wants to know about actual cost has to come from elsewhere in the turn lifecycle.

See `proposal.md` for motivation, the two delta specs for the behaviour contract, and ADR-0001 and ADR-0003 for the decisions this design inherits.

## Goals / Non-Goals

**Goals:**

- A pack-building core that can be exercised without the harness, without a model, and without a network.
- A harness adapter thin enough that almost nothing of consequence lives in it.
- Accounting that distinguishes measured truth from approximation, rather than presenting an estimate as a fact.
- A shape that slice 2 can extend by swapping where Turns come from, not by rewriting the Assembler.

**Non-Goals:**

- Reducing the Floor. It is measured here and left alone; it is what the harness's own tooling runs on.
- Any durable store, embedding, or retrieval.
- Multi-harness portability. One adapter, for the harness we use.

## Decisions

### The Assembler is a pure function, and the adapter is dumb

`assemble(turns, config) -> Pack` takes an ordered list of Turns and returns a pack, with no I/O, no clock, and no harness types in its signature. The adapter's whole job is to convert the harness's message array into Turns, call the Assembler, convert the pack back into messages, and return them.

Alternative considered: implement assembly directly inside the event handler. Rejected because every determinism and composition requirement would then be testable only through a live harness, which is slow, needs a model, and makes a failing test ambiguous between "wrong pack" and "harness behaved unexpectedly".

This is also what makes slice 2 cheap: the Thread Store changes where Turns come from, and the Assembler does not move.

### A Turn is reconstructed from the message array, and it is the unit of the tail

The harness passes a flat message array; the verbatim tail is defined in Turns. A Turn is a user prompt and everything the agent produced in response to it, tool calls and results included, up to the next user prompt. The tail keeps whole Turns: truncating mid-Turn would leave a tool call without its result, which is precisely the state that breaks an agent's ability to act on what it just read.

Consequence: N counts Turns, not messages, so pack size varies with how tool-heavy recent Turns were. That variance is real and worth seeing in the accounting rather than hiding behind a message count.

### The Floor is reported by the harness, not derived

Fixture capture from real sessions showed that assistant messages carry `contextSnapshot: { promptTokens, nonMessageTokens, compactionEpoch }` alongside provider `usage`. `nonMessageTokens` is the Floor, stated directly by the harness — measured at 25,588 across a three-Turn session whose messages were trivially small. Accounting therefore reads both figures from the response rather than deriving either: `Floor = nonMessageTokens`, and the pack's measured size is `promptTokens − nonMessageTokens`.

This supersedes the plan to compute `Floor = reported input total − pack tokens`. Subtraction would have folded every local counting error into the Floor, which is the number every Budget decision depends on. Per-part attribution *inside* the pack still uses a deterministic local count, because nothing reports it, and it is labelled approximate wherever it is surfaced.

Alternative considered: count everything locally with a real tokenizer. Rejected for the same reason — the Floor is assembled by the harness from sources we never see, so a local count of it would be a guess dressed as a measurement.

### Accounting is written as an append-only local record, keyed by Conversation

No Store exists yet, and inventing a schema now would be inventing it twice. Accounting appends to a local file keyed by Conversation and Turn, in the same shape the Thread Store will ingest in slice 2. This keeps the accounting requirements satisfiable now and makes slice 2 an ingest change rather than a redesign.

### Failure returns the input unmodified

The handler returns its replacement only on success. Any error is caught, reported, and the turn proceeds on the harness's own array. A partially assembled pack is worse than no assembly: it silently amputates the conversation. Note that this fails *open*, toward the accumulating window the project exists to prevent, which is the right direction for a failure but means a persistently failing Assembler must be loud.

### The memory backend is asserted, not merely documented

ADR-0003 turns the harness's memory backend off. A configuration note is not a guarantee, so the extension checks the setting at session start and reports loudly when it is on, because the failure mode — a second system injecting recalled content — produces a bad pack with no visible cause.

## Risks / Trade-offs

- **The `context` event is documented but not contractually stable** → the adapter is the only code that touches harness types, so a shape change is confined to it. `before_provider_request` is the documented fallback and the harness is MIT-licensed.
- **Failing open hides a broken Assembler behind a working agent** → a failed assembly is reported every time rather than logged once, and the accounting record shows the turn as unassembled.
- **Turn reconstruction from a flat array may mis-group unusual message sequences** → reconstruction is pure and directly testable against recorded fixtures taken from real Journals; malformed grouping surfaces as a test failure rather than a subtly short pack.
- **Pack-internal attribution is approximate** → it is labelled approximate wherever it is surfaced, and the pack-versus-Floor ratio, which is the decision-relevant figure, uses reported usage on both sides.
- **N is a guess until there is evidence** → it is configurable from the start, and this change exists partly to produce the evidence that sets it.

## Testing seams

One seam per requirement, preferring the highest seam that can actually fail on the behaviour.

| Requirement | Seam |
| --- | --- |
| Assembled packs replace accumulated history | Headless harness run: drive a real session, assert the model's response reflects the pack and not the omitted content. This is the only seam where "the model received it" is observable, and the probe proved it is cheap. |
| Packs carry the prompt and a verbatim tail | `assemble()` function boundary, with Turns built from recorded Journal fixtures. |
| Assembly is deterministic | `assemble()` function boundary: assemble twice, compare. |
| Replacement never alters the durable record | Headless harness run: assert the Journal on disk contains the original prompt after a pack that withheld it. |
| Assembly is the only memory injection | Extension handler boundary, invoked with a synthetic event and a configuration where the backend is enabled; assert the check fires. |
| Assembly failure degrades safely | Extension handler boundary: inject a failing Assembler, assert the handler returns no replacement and reports. |
| Every turn's window is accounted for | Headless harness run, reading the accounting record — reported usage only exists after a real provider response. |
| Accounting attributes pack contents to their source | `assemble()` function boundary: the pack carries its own composition. |
| Accounting is readable after the fact | Accounting-reader boundary, over a written record. |
| Accounting never disturbs the turn | Extension handler boundary: make the writer fail, assert the pack and the turn are unaffected. |

The function boundary is the target for anything expressible there. The headless run is reserved for the three claims that are only true if the harness and the provider agree — replacement reaching the model, the Journal staying intact, and usage being reported — and it is the seam that justified building the probe before writing this design.

## Open Questions

- What N should default to. Deferred deliberately: this change produces the accounting that answers it, and N is configurable, so the answer changes a default rather than the specs, the approach, or the task breakdown.
