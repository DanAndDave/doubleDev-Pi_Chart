## 1. Reading a graph

- [x] 1.1 Read graphify's output into connections, keeping only what a parser established, and verify against a fixture holding an inferred edge, a documentation node, and an unknown relation
- [x] 1.2 Verify an extraction whose connections are all inferred yields nothing
- [x] 1.3 Report a graph missing what the adapter requires by naming the missing field, and verify the message says which
- [x] 1.4 Verify an unparseable extraction is reported rather than partially interpreted

## 2. Finding the symbols in play

- [x] 2.1 Match identifiers in a prompt against the graph's names, ignoring case and punctuation, and verify a symbol written differently is still found
- [x] 2.2 Verify an identifier that matches nothing falls back to its parts, and one that matches is not split
- [x] 2.3 Verify a prompt naming nothing in the Codebase finds no symbols

## 3. The neighbourhood

- [x] 3.1 Collect a symbol's direct connections in both directions, each naming the file and position of the other end, and verify both directions appear
- [x] 3.2 Verify a symbol with no connections yields nothing rather than an empty shell

## 4. Obtaining graphify

- [x] 4.1 Run an extraction through graphify when a Codebase has none, and verify the command and its code-only flag
- [x] 4.2 Install graphify at a pinned version when the machine lacks it, and verify installation precedes extraction
- [x] 4.3 Verify a Codebase that already has a graph is read rather than re-extracted from nothing
- [x] 4.4 Refresh an existing graph rather than rebuilding it, and verify the refresh command is used
- [x] 4.5 Report a failure to install or run, and verify nothing else in the Turn is affected

## 5. Into the pack

- [x] 5.1 Carry structure as its own pack part under its own Budget, attributed by symbol, and verify it is distinguishable from the other parts
- [x] 5.2 Verify exhausting the structure Budget leaves the tail, recalled Turns, and Concepts untouched
- [x] 5.3 Verify a structure Budget of zero yields no structure and no other change
- [x] 5.4 Verify accounting attributes the structure part separately and names the symbols it carried

## 6. Wiring

- [x] 6.1 Refresh the Codebase's graph on session start, away from the request path, and verify a session does not wait for it
- [x] 6.2 Draw structure into the pack during assembly, and verify a Graph Store failure costs the structure and not the Turn

## 7. Verification

- [x] 7.1 Against the real graphify, extract this repository and verify a known caller relationship is present and an inferred edge is not
- [x] 7.2 Ask a live agent in a fresh Codebase which functions call a given symbol, and confirm it answers without reading a file or grepping
- [x] 7.3 Inspect that Call and confirm the structure part is present, attributed, and within its Budget
- [x] 7.4 Run the default, store-backed, model, and live suites, and the type checker, and confirm `openspec validate graph-store` passes
