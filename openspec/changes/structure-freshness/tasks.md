## 1. Measure before choosing

- [ ] 1.1 Time `graphify extract --code-only` on this repository unchanged, after a one-file edit, and after a new file, and record each figure against the archived "21 files cached/unchanged" claim
- [ ] 1.2 Measure the size of a Call's whole-Turn candidate text across this machine's Journals, and choose the per-message bound from those figures, recording what it costs on the largest Turn
- [ ] 1.3 Count, over this repository's own graph, how many over-sized symbols currently spend the twelve-edge cap on `contains` and `method` connections, and record the figure the new ordering is judged against

## 2. Freshness across a Conversation

- [ ] 2.1 Refresh the graph at `agent_end` as well as `session_start`, in the background, and verify a Turn's Calls are not delayed by it
- [ ] 2.2 Verify a Conversation that edits a file offers structure for the edited file on a later Turn, and the pre-edit structure before it
- [ ] 2.3 Verify against the real tool that a refresh over an unchanged tree re-extracts nothing, and one after a single edit costs about that edit
- [ ] 2.4 Verify a refresh that cannot run is reported, leaves the previous graph readable, and does not fail the Turn

## 3. Structure that says how old it is

- [ ] 3.1 Determine a neighbourhood's freshness from the symbol's own file against the extraction, and verify an edited file's neighbourhood is reported as older while an untouched file's is not
- [ ] 3.2 Verify a symbol whose file cannot be examined is reported as older rather than current
- [ ] 3.3 Mark older structure in the message the Pack carries, beside the symbol it describes, and verify the mark names the reason
- [ ] 3.4 Verify one Pack carrying an edited and an untouched file marks only the edited one
- [ ] 3.5 Verify structure is carried marked rather than withheld when every symbol in play is older than the Codebase
- [ ] 3.6 Verify fresh structure is byte-identical to what the Pack carried before this change

## 4. The symbols the Turn is working with

- [ ] 4.1 Draw candidates from the current Turn's messages — prompt, assistant text, tool names, arguments, results — and verify a tool-loop Call whose prompt names nothing yields structure for the files the Turn read
- [ ] 4.2 Bound each message's contribution to the measured head, and verify one outsized tool result does not displace the symbols the prompt and tool arguments name
- [ ] 4.3 Order candidates prompt-named first, then named elsewhere in the Turn, then reached only through a file, and verify a directly named symbol outranks a file's other symbols
- [ ] 4.4 Verify the rule disregarding an ordinary word matching only a member's name still holds over the wider text
- [ ] 4.5 Verify a Turn naming nothing the graph knows still yields no symbols

## 5. Paths as symbols

- [ ] 5.1 Index symbols by the file the graph already carries, and verify a path in play resolves to the symbols that file defines
- [ ] 5.2 Verify a repository-relative, a dot-relative, and an absolute form of the same path all resolve to the same symbols
- [ ] 5.3 Verify a bare token matching a file's name resolves through that file, so `assembler` reaches `assemble`
- [ ] 5.4 Verify a path no symbol belongs to yields nothing rather than a partial-token match

## 6. Relation-ordered truncation

- [ ] 6.1 Rank connections by relation before the existing direction alternation, and verify a hub symbol's callers and importers survive while its members are the ones left out
- [ ] 6.2 Verify the twelve-edge cap and the inbound/outbound alternation are unchanged, and both directions still appear in a truncated neighbourhood
- [ ] 6.3 Verify truncating the same over-sized neighbourhood twice keeps the same connections in the same order
- [ ] 6.4 Verify a neighbourhood within the cap carries every connection, and the count of those left out is unchanged where truncation happens
- [ ] 6.5 Re-run task 1.3's count against the new ordering and record the improvement

## 7. Indexes built once per extraction

- [ ] 7.1 Build the name, file, and incident-edge indexes beside the cached parse, and verify a second Call over an unchanged extraction rebuilds none of them
- [ ] 7.2 Verify a changed extraction invalidates the indexes with the parse, so structure comes from the new graph
- [ ] 7.3 Verify symbol selection and neighbourhood construction remain pure functions of the prepared graph and the Turn

## 8. Wiring that does not require Postgres

- [ ] 8.1 Register from one `Dependencies` literal with only Thread-Store-backed members conditional, and verify a declined Thread Store still registers the Graph Store
- [ ] 8.2 Verify a session with no database assembles a Pack carrying structure, and its other parts are unchanged
- [ ] 8.3 Report once when a structure Budget is configured and no graph can be reached, naming why, and verify a Codebase with a graph reports nothing
- [ ] 8.4 Report structure in the install check from the Store that exists rather than from configuration alone, and verify it reads unavailable with no Store, declined when extraction is off, and on otherwise

## 9. Verification

- [ ] 9.1 Run a live session that edits a file and then asks about a symbol in it, and confirm the Pack carries the edited file's structure with no older-than-Codebase mark
- [ ] 9.2 Run a live session whose Turn reads several files without naming a symbol, and confirm `/pack` shows structure for those files
- [ ] 9.3 Run a session with `CM_DATABASE_URL=""` and confirm `/context-manager` reports the Graph Store honestly and `/pack` shows the structure part
- [ ] 9.4 Run the default and tool-gated suites (`CM_GRAPHIFY=1`) and the type checker, and confirm `openspec validate structure-freshness` passes
