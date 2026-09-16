## 1. Verifying the shape

- [ ] 1.1 Report whether a Codebase's OpenSpec tree is as expected, naming each absent part, and verify against a conforming tree
- [ ] 1.2 Verify a Codebase with no OpenSpec directory is reported as absent, distinctly from an incomplete one
- [ ] 1.3 Verify each separately missing part is named: the specs directory, the changes directory, the archive, and the configuration
- [ ] 1.4 Verify something expected to be a directory but found as a file is reported, not counted as present
- [ ] 1.5 Verify the Codebase is byte-for-byte unchanged by verification, in every one of those states

## 2. Diagnosing content

- [ ] 2.1 Ask OpenSpec to validate the Codebase's specs and changes, and surface its own message rather than a paraphrase
- [ ] 2.2 Verify a change OpenSpec rejects is named in the diagnosis along with its reason
- [ ] 2.3 Verify conforming content reports nothing wrong
- [ ] 2.4 Verify an unavailable OpenSpec is reported as unknown, never as conformance

## 3. Initializing

- [ ] 3.1 Initialize a Codebase through OpenSpec's own command, and verify a bare Codebase afterwards verifies as conforming
- [ ] 3.2 Verify a partial tree has its absent parts created
- [ ] 3.3 Verify existing specs, changes, and configuration are unchanged by initialization
- [ ] 3.4 Verify a failure to initialize is reported with the reason

## 4. Wiring

- [ ] 4.1 Verify the Codebase on session start, away from the request path, reporting only when something is wrong
- [ ] 4.2 Offer initialization as an explicit request, and verify a session never initializes a Codebase by itself
- [ ] 4.3 Verify the Spec Store can be switched off entirely
- [ ] 4.4 Verify a Context Pack is identical whether or not the Codebase has an OpenSpec tree

## 5. Verification

- [ ] 5.1 Against the real OpenSpec CLI, initialize a bare directory and confirm the result verifies as conforming
- [ ] 5.2 Against the real CLI, confirm a malformed change is diagnosed with OpenSpec's own words, and a valid one is not
- [ ] 5.3 In a live session, confirm a non-conforming Codebase is reported and an explicit request initializes it
- [ ] 5.4 Run the default, store-backed, model, live, and tool suites, and the type checker, and confirm `openspec validate spec-store-verify` passes
