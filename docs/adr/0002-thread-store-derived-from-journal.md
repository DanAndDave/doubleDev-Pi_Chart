# The Thread Store is a derived index, not the record

omp already persists every Turn to an append-only JSONL journal with stable entry ids, branch structure, and content-addressed blobs. The Thread Store ingests that journal into Postgres with pgvector for retrieval; it never becomes the authority. Any Thread Store database can be dropped and rebuilt from the journals on disk.

## Consequences

- Schema changes are cheap early on, when they are most likely: drop, migrate, re-ingest.
- A failed or lagging ingest costs retrieval quality, never data.
- Retrieval scope defaults to the current Conversation. Reaching across Conversations is an explicit query, never an implicit widening.
- Postgres runs from a Compose file this project manages, but the storage interface stays narrow enough that the test suite does not need a container.
