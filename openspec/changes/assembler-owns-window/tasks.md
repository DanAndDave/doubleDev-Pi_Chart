## 1. Project foundation

- [ ] 1.1 Create the Bun TypeScript package — manifest, TypeScript configuration, source and test layout — and verify `bun test` runs an empty suite and the type checker reports no errors
- [ ] 1.2 Capture Journal fixtures from real recorded sessions covering a plain exchange, a tool-heavy Turn, and a Turn whose tool call errored, and verify each fixture parses into the expected number of Turns
- [ ] 1.3 Add the headless harness test helper that runs a scripted session against the extension and returns both the model's output and the Journal written to disk, and verify it by asserting a known prompt round-trips with the extension inert

## 2. Turn reconstruction

- [ ] 2.1 Implement reconstruction of Turns from a flat message array, grouping each user prompt with the agent output, tool calls, and tool results that follow it, and verify against all fixtures from 1.2
- [ ] 2.2 Handle the boundary cases the fixtures expose — a Turn still in progress, a tool call whose result is missing, consecutive user prompts — and verify each is grouped without dropping or duplicating content

## 3. The Assembler

- [ ] 3.1 Implement `assemble(turns, config) -> Pack` returning the prompt plus the last N Turns verbatim, with no I/O and no clock, and verify the tail contains whole Turns with tool calls and results intact
- [ ] 3.2 Make N configurable and verify that changing it changes the number of Turns in the tail
- [ ] 3.3 Verify determinism: assembling twice from identical inputs and configuration produces identical packs, including ordering
- [ ] 3.4 Have the pack carry its own composition, attributing content to the part that contributed it, and verify the attribution sums to the pack's contents

## 4. Harness adapter

- [ ] 4.1 Implement the extension entry point registering a `context` handler that reconstructs Turns, calls the Assembler, and returns the pack as the replacement message array, and verify a headless run answers from the pack rather than from omitted earlier content
- [ ] 4.2 Verify the durable record is untouched: after a run whose pack withheld the user's prompt, the Journal on disk still contains the original prompt and the real response
- [ ] 4.3 Catch assembly failures, report them, and return no replacement, and verify with an injected failing Assembler that the Turn completes on the harness's own array
- [ ] 4.4 Check the harness memory backend at session start and report loudly when it is enabled, and verify the check fires against a synthetic event carrying an enabled configuration
- [ ] 4.5 Document loading the extension and the required `memory.backend: off` setting, and verify by following the instructions from a clean checkout into a headless run

## 5. Accounting

- [ ] 5.1 Record each assembled pack with its Conversation and Turn identity in an append-only local record, shaped for ingest by the Thread Store, and verify a completed session produces one record per Turn in Turn order
- [ ] 5.2 Read the harness-reported `promptTokens` and `nonMessageTokens` from each response and record the Floor and the measured pack size from them, and verify against a headless run that the recorded Floor is non-zero for a trivially small pack
- [ ] 5.3 Label locally counted pack-internal attribution as approximate wherever it is surfaced, and verify reported usage — not the local count — is the basis of the pack-versus-Floor figures
- [ ] 5.4 Implement reading accounting back for a whole Conversation in Turn order, and verify against a recorded session
- [ ] 5.5 Make accounting failures non-fatal, and verify with a failing writer that the pack is unchanged and the Turn completes

## 6. Verification

- [ ] 6.1 Run a real multi-Turn session through the TUI and confirm the window does not grow with Turn count while the transcript continues to show the full conversation
- [ ] 6.2 Report the measured pack-versus-Floor ratio from that session, so the deferred question of whether the Floor is worth addressing has evidence behind it
- [ ] 6.3 Run the full test suite and the type checker once, and confirm `openspec validate assembler-owns-window` passes
