## 1. Walking

- [x] 1.1 Offer the agent a tool that reads a Level — its sub-levels and the Concepts directly beneath it, each with its description — and verify the top of a fixture bundle lists what is directly in it
- [x] 1.2 Verify walking into a named Level returns what is beneath that Level and nothing deeper
- [x] 1.3 Verify a curated listing is preferred over a synthesised one
- [x] 1.4 Verify reading a Level does not read the Concepts below it

## 2. Opening

- [x] 2.1 Open one Concept named in a listing, and verify its content comes back
- [x] 2.2 Verify opening a Concept the bundle does not hold says so

## 3. Saying what is not there

- [x] 3.1 Verify a Level the bundle does not have is reported as absent, distinctly from a Level that is empty
- [x] 3.2 Verify walking with no bundle configured answers rather than raising

## 4. Costing nothing

- [x] 4.1 Verify a Context Pack is identical whether or not the agent walked during that Turn

## 5. Verification

- [x] 5.1 In a live session, ask the agent what the bundle holds and confirm it walks rather than guesses
- [x] 5.2 Run the default, store-backed, model, live, and tool suites and the type checker, and confirm `openspec validate level-walking-surface` passes
