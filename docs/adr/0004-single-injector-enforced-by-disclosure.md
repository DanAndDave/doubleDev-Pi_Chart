# The single-injector invariant is enforced by disclosure, not by filtering

ADR-0003 requires the harness's own memory backend to be off, because two systems injecting recall into one Context Window makes a bad Pack undiagnosable. The `context-assembly` spec turned that into a promise the Assembler cannot keep: "no content originating from the harness's memory backend SHALL appear in any Context Pack". Nothing enforced it, and nothing could.

Every backend injects into the **system prompt**, which is the Floor — the part of a Context Window the Assembler does not supply and cannot reach. The documentation says so for all three (`local` injects "a **Memory Guidance** block", `mnemopi` "refreshes the base prompt", `hindsight` injects "background context"), and a live run confirms it: with `memory.backend: local`, a planted memory summary holding a codeword the model could not guess, the `context` event handed over one message of 184 characters with no trace of it, while the model answered the codeword correctly. The same Conversation with the backend off could not answer at all, and the Floor differed by 319 tokens between the two — `nonMessageTokens` 26,086 against 25,767. The injected block is in the Floor, measured on the side of the window the Assembler never touches.

Two consequences. There is nothing in the message array to strip, so a filter in `assemble()` is not an available option. And the requirement as written was satisfied by construction — a Floor-injected block never "appears in a Context Pack" — while the hazard ADR-0003 names went untouched. It named the wrong noun.

So the invariant is stated over the Context **Window**, and enforced the only way that is available: the backend's state is checked once when a Conversation starts, reported when it is anything but off, and recorded against every Call. A harness that does not answer — no `memory`, no `status`, or a `status` that throws — is `unconfirmed` and never rounded to off: silence is not confirmation.

Refusing to assemble was available and rejected. Returning no Pack hands the Turn to the harness's own accumulating message array, which is the ungoverned Context Window this project exists to replace; it trades a diagnosable window for a worse one, punishes the user for a line in a configuration file, and cannot be undone from inside a Conversation.

## Consequences

- A user can still run two injectors. What changes is that they are told, in terms naming the backend and the setting, and that every Call of that Conversation carries `memory_backend` in its Accounting — so "was this window contaminated" is answerable long after the report has scrolled away.
- Three states, not two. `unconfirmed` is recorded distinctly, so a harness without a status call is never mistaken for a verified-clean one.
- The Pack-level assertion survives as a scenario rather than as the whole invariant: a Pack's messages are exactly its parts' messages concatenated, which is checked at the `assemble()` boundary.
- Nothing is measured about the memory payload itself. Its size is already in `floorTokens`; attributing a slice of the Floor to a component would mean parsing the system prompt, which this project does not do.
