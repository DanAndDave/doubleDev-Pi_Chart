## 1. Store foundation

- [ ] 1.1 Add a Compose file running Postgres with pgvector and document the Docker prerequisite, and verify the database accepts a connection
- [x] 1.2 Add the Postgres client dependency and a connection helper driven by configuration, and verify it connects to the Compose database and fails with a clear message when it cannot
- [ ] 1.3 Implement forward-only migrations creating the schema and enabling the pgvector extension, and verify against an empty database that the schema is created and reported ready
- [ ] 1.4 Verify re-running migrations against an already-migrated database leaves existing content intact

## 2. Ingest

- [x] 2.1 Implement locating and reading a Conversation's Journal from disk, and verify against recorded fixtures that entries parse into addressed Turns
- [x] 2.2 Implement ingest of prompts, responses, tool calls, tool results, and artifacts addressed by Conversation, Turn, and Call, and verify each is retrievable through the store's query interface
- [x] 2.3 Preserve a failed tool result as a failure rather than dropping the call, and verify with the failed-tool fixture
- [x] 2.4 Make ingest idempotent by address, and verify that ingesting the same Journal twice leaves one record per address
- [x] 2.5 Verify that ingesting a Conversation that has grown since the last ingest adds only what is new

## 3. Turn source

- [x] 3.1 Define the `TurnSource` interface the Assembler reads its tail through, with an in-memory implementation for the default suite, and verify the Assembler is unchanged by this slice
- [ ] 3.2 Implement the Postgres `TurnSource` returning the most recent N completed Turns, and verify Turns come back in Turn order with their messages in order
- [ ] 3.3 Verify retrieval never returns a Turn belonging to another Conversation
- [x] 3.4 Wire the extension's tail to the `TurnSource`, keeping the current Turn from the incoming array, and verify a pack still assembles correctly end to end

## 4. Durability

- [ ] 4.1 Verify that emptying the store and re-ingesting the Journal produces an identical Context Pack
- [ ] 4.2 Verify at the headless harness seam that the verbatim tail survives the harness's conversation being cleared
- [x] 4.3 Fall back to the harness's message array when the store is unreachable, reporting the failure, and verify the Turn completes with a rejecting `TurnSource`
- [x] 4.4 Record the tail's provenance in accounting so a fallback is visible afterwards, and verify a store-less Call is marked

## 5. Accounting moves into the store

- [x] 5.1 Store accounting in the Thread Store alongside the Turns it describes, and verify a whole Conversation reads back in Turn order
- [x] 5.2 Verify accounting written by one process is readable by a later one
- [x] 5.3 Delete the interim local JSONL accounting writer and its reader, and verify no code path still writes it

## 6. Verification

- [ ] 6.1 Run a real multi-Turn session, clear the conversation mid-way, and confirm the agent still recalls a Turn from before the clear
- [ ] 6.2 Run the full suite with no container and confirm it passes, then run the store-backed suite against the Compose database and confirm it passes
- [x] 6.3 Run the type checker and confirm `openspec validate thread-store-ingest` passes
