## 1. Reading calls out of the Journal

- [x] 1.1 Give each of a Turn's messages the Call that produced it, ending a Call at the message that carries its snapshot, and verify a tool loop yields rising Call numbers
- [x] 1.2 Verify a Turn with no recorded snapshot yields Call 0 throughout

## 2. Storing them

- [x] 2.1 Add the forward migration for a message's Call, defaulting to the Turn's first, and verify it applies to the existing database
- [x] 2.2 Store each message's Call on ingest, and verify a multi-Call Turn reads back with the Calls it had
- [x] 2.3 Verify re-ingesting the same Journal leaves one row per message with unchanged Calls
- [x] 2.4 Verify a row written before Calls were recorded reads as the Turn's first Call

## 3. Making it visible

- [x] 3.1 Report how many Calls a found Turn took, and verify a Turn answered in several says so
- [x] 3.2 Verify a Turn answered in one Call is not described as having taken several

## 4. Verification

- [x] 4.1 Ingest a real captured Journal and confirm the Calls recorded match the snapshots in it
- [x] 4.2 Run the default and store-backed suites and the type checker, and confirm `openspec validate ingest-call-boundaries` passes
