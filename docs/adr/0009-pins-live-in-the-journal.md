# Pins live in the Journal, not in a Store

A Pin must last for the whole Conversation — across resume, `/tree`, and into every fork or branch — and vanish from new or unrelated Conversations. The Conversation id pi-chart keys the Thread Store by is the harness session id, which the harness replaces on fork, on branching into a new file, and when it moves a contested session to a sibling file; the only link back is `parentSession`, which the harness documents as opaque metadata. So Pins are written to the Journal as pi-chart custom entries, reconstructed by replaying every entry in the file rather than the active branch, and re-written into the new file when the Conversation forks or branches.

## Considered Options

- **A Postgres table keyed by Conversation id**, copied to the child on fork by resolving `parentSession`. Rejected: it leans on an untyped lineage field, and Pins would stop working whenever the Thread Store is not set up — a Pin is the user's own words, not derived knowledge, and should not depend on a retrieval index.

## Consequences

- No fifth Store and no migration: the Journal stays the record (ADR-0002), and a Pin needs no database to be carried.
- Replaying the whole file, not the parent chain, is deliberate: a Pin set after the point `/tree` navigates back to still holds, because the user pinned it for the Conversation, not for a branch of it.
- A Pin is only ever sent by the Assembler. When a Call goes out unassembled — assembly failed and the harness's own history was sent — its Pins are still recorded and shown as not sent, and the next assembled Pack carries them again.
