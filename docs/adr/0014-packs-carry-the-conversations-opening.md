# Packs carry the Conversation's Opening

Partly superseded by ADR-0015: the Opening sits in the system prompt from Turn 1, framed as context rather than a new instruction, not after the Briefing's marker once the tail evicts it. Its Budget, its Elision and the rule that it is always the Turn at index 0 stand. The Ceiling no longer reduces it.

The 2026-10-13 benchmark's memory check asked at turn 12 for a codeword given at turn 1. By then turn 1 had left the verbatim tail, so only recall could bring it back, and recall depends on the question sounding like the prompt that held the answer. A Conversation's first prompt usually states its goal and constraints, and every later Turn is read against them. Whether the model sees it should not depend on how relevant it looks to the current query.

**Every Pack carries the Opening: the prompt of the Conversation's first Turn, once the verbatim tail no longer carries that Turn.** It contains the user's prompt only, labelled as turn 0, the index recollections use for that Turn. The reply to that prompt stays reachable through recall. Recall itself does not change.

**It is reference data, not an instruction.** It sits after the Briefing's marker as the first reference part, ahead of recalled Turns. If it sat before the marker, the model would read it as a standing order and redo the first request on every Turn. Standing instructions are what Pins are for.

**It has its own Budget: 1 item and 1,000 tokens (`PICHART_OPENING_TOKENS`; 0 turns it off).** A longer prompt is shortened by Elision, not dropped. Under the ceiling it is reduced after recollections and before the tail: structure → curated → recalled → Opening → tail. Recall might find that Turn again, but nothing else will.

**It is fetched alongside the tail, as its own Store query under the tail's deadline.** If that query misses the deadline, the Opening is absent and reported like any other part that missed its deadline. While the tail still carries the first Turn, or when that Turn's prompt is empty (a slash command, or a Turn that only marks a compaction), the Opening is absent with its reason.

**The Opening is always the Turn at index 0.** If retention has deleted that Turn, the Opening is absent. The oldest remaining Turn never takes its place, because that would quietly change what the term means. Without a Store, the tail comes from the harness's live history, and compaction may already have removed the first prompt from it. In that case the Opening is absent as unavailable, the same way recall is, and it is never rebuilt from the harness's copy.

**Overlaps are allowed.** If recall picks the first Turn as well, its prompt is sent twice, costing at most 1,000 tokens. Making one part's selection depend on another's would interact with the ceiling, which re-runs recall's selection. A Pin with the same text is the user's choice and is left alone.

## Considered options

- **Lower recall's threshold or change what it embeds.** This touches every recollection in order to rescue one Turn, and it still depends on the question sounding like the answer. Changing the embedded text also means a re-embed migration.
- **Put the Opening before the marker.** The model would then read it as a standing instruction and repeat completed work.
- **Carry the first Turn's prompt and its final reply.** This costs more, and the reply can already be retrieved.
- **Drop the Opening when recall also carries the first Turn.** It saves at most 1,000 tokens, but couples two parts' selections across ceiling reduction.

## Consequences

- The turn-1 codeword probe now passes without exercising recall, so it no longer measures recall. Turn 3's prompt now also gives a second fact, and the turn-12 probe asks for both facts. Each is scored separately. The run stays at 12 turns, so its per-turn figures remain comparable with earlier benchmarks. The turn-3 fact still depends on recall and is reported as a known weakness, not a gate.
- Probes run only in the default workload. A `--workload` file is still a plain array of prompts and records no probe.
- A hand-built set for scoring recall is out of scope, because recall does not change here. It belongs to whichever change tunes recall.
- Every Pack past the tail's first Eviction carries up to 1,000 more tokens. They come after the marker, inside the Briefing, so the cached leading prefix is unchanged.
- `/pack` shows an `opening` line like any other part.
- A Conversation forked or branched from another has its own first Turn, and the Opening follows it.
