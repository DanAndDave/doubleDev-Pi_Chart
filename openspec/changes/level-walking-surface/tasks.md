## 1. Walking

- [ ] 1.1 Offer the agent a tool that reads a Level — its sub-levels and the Concepts directly beneath it, each with its description — and verify the top of a fixture bundle lists what is directly in it
- [ ] 1.2 Verify walking into a named Level returns what is beneath that Level and nothing deeper
- [ ] 1.3 Verify a curated listing is preferred over a synthesised one
- [ ] 1.4 Verify reading a Level does not read the Concepts below it

## 2. Opening

- [ ] 2.1 Open one Concept named in a listing, and verify its content comes back
- [ ] 2.2 Verify opening a Concept the bundle does not hold says so

## 3. Saying what is not there

- [ ] 3.1 Verify a Level the bundle does not have is reported as absent, distinctly from a Level that is empty
- [ ] 3.2 Verify walking with no bundle configured answers rather than raising

## 4. Costing nothing

- [ ] 4.1 Verify a Context Pack is identical whether or not the agent walked during that Turn

## 5. Verification

- [ ] 5.1 In a live session, ask the agent what the bundle holds and confirm it walks rather than guesses
- [ ] 5.2 Run the default, store-backed, model, live, and tool suites and the type checker, and confirm `openspec validate level-walking-surface` passes
