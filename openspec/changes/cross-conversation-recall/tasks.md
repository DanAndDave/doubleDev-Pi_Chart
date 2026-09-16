## 1. Measure across conversations

- [x] 1.1 Ingest several real Conversations, and report the distances from a query to its genuine match elsewhere and to the nearest coincidental match, and record the figures
- [x] 1.2 Decide the threshold the wider search ships with from those figures, and record why it differs from or matches the within-Conversation value

## 2. Attribution

- [x] 2.1 Record the Codebase a Conversation belongs to when its Journal is ingested, and verify it round-trips through a real store
- [x] 2.2 Verify Turns stored before the Codebase was recorded read back with it absent rather than failing

## 3. The wider search

- [x] 3.1 Implement searching every Conversation, ordered by similarity and subject to the relevance threshold, and verify a Turn from another Conversation is found
- [x] 3.2 Verify the current Conversation's matching Turns are returned alongside those from elsewhere
- [x] 3.3 Verify nothing is returned when nothing anywhere meets the threshold
- [x] 3.4 Verify the result count is bounded and ordered most similar first
- [x] 3.5 Return each result with its Conversation and, where recorded, its Codebase, and verify both

## 4. Exposing it

- [x] 4.1 Register the search as a tool the agent can call, returning results with their origin, and verify it against recorded Conversations
- [x] 4.2 Verify a search failure is reported as the tool's result and the Turn continues
- [x] 4.3 Verify a Context Pack assembled with the tool available is identical to one assembled without it

## 5. Scoping holds

- [x] 5.1 Verify a Context Pack never carries a Turn from another Conversation, even when that Turn is the best match for the prompt
- [x] 5.2 Verify the verbatim tail is still drawn from the current Conversation alone

## 6. Verification

- [x] 6.1 Run a real session that asks about something decided in a different Conversation, and confirm the agent finds it by searching rather than by assembly
- [x] 6.2 Run the default, store-backed, model, and live suites, and the type checker, and confirm `openspec validate cross-conversation-recall` passes
