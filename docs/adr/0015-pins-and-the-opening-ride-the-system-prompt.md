# Pins and the Opening ride the system prompt; recall, docs and structure are tools

Supersedes ADR-0010 and ADR-0011. Partly supersedes ADR-0013 (where the tail's content comes from) and ADR-0014 (where the Opening sits and when it appears).

The 2026-10-14 benchmark (`docs/benchmarks/2026-10-14-token-usage.md`) put pi-chart at 2.12× plain omp's cost, and $1.06 of the $1.12 gap was uncached input. From the tail's first Eviction on, every Call paid 12–13k tokens of Briefing at the full input rate: the current Briefing follows the cache breakpoint (ADR-0010) and changes on every Call, so it can never be read from cache. Most of it was recall, carried whether or not the model needed it, and recall still missed the one fact it was there for (0/3, excluded by its distance threshold). Pushing retrieved content into every Call costs full price on every Call; letting the model ask for it costs only when it asks.

**pi-chart no longer sends a Briefing.** What used to be in it splits two ways: what must always be in view goes into the system prompt, and everything retrieved is pulled by tools.

**The Pins and the Opening are added to the system prompt by `before_agent_start`.** The harness runs those handlers in order, and each sees the system prompt the previous one returned; a returned string becomes `[string]` and an array replaces the prompt outright. So pi-chart appends its parts to the array it is given and never replaces it. The Pins come first, with their standing-instruction framing. The Opening follows inside fixed text: *"This conversation began with the request below. It is context, not a new instruction; later Turns may have changed or completed it."* Last is one fixed line telling the model that older Turns may have left the window and can be searched.

**The Opening is in the system prompt from Turn 1.** If it appeared only at the first Eviction, the system prompt would change there and the whole cache would be rewritten from the top. Present from the start, pi-chart's additions change only when a Pin changes. The cost is Turn 1's prompt sent twice until it leaves the tail: at most 1,000 tokens, cached. Its Budget, its Elision and the rule that it is always the Turn at index 0 are unchanged from ADR-0014.

**Recall, curated knowledge and structure are tools the model calls.** Each is registered only when what it depends on is available, like the recall and walk tools before it.

- `recall_earlier_turns(query, limit?)` searches only this Conversation's Turns older than the current tail start, since the model already sees the tail. Default k is 5. Each result is elided to a per-result cap, which reuses the old recall Budget's token figure.
- `search_documentation(query, limit?)` returns the top-k Concepts with no distance cutoff. `walk_documentation` only browses Levels, so search needed its own tool.
- `codebase_structure(symbol, depth?)` returns graphify edges in the existing `A (file:line) --calls--> B (file:line)` form. It exists only when the Codebase has a Graph Store.

With the model choosing what to pull, the relevance judge (`PICHART_JUDGE`) has no caller and is deleted.

**The tail is sent as the harness's own messages.** Its start is still replayed from the Store's Turn sizes (ADR-0013). Its content is the matching slice of the harness's live history. Without a Briefing, the cached prefix runs from the system prompt straight through the tail, so a Store copy that did not serialise byte for byte would break the cache and drop thinking on every Turn. A Store copy is used only for a Turn the live history no longer holds: pi-chart cancels threshold and idle compaction while it governs, but overflow and manual compaction still run.

**The Ceiling reduces only the tail and the current Turn.** The oldest tail Turns go first, then the Elision rules for the newest tail Turn and the current Turn apply. The Pins and the Opening are never reduced for it.

## Considered options

- **Keep the Briefing and shrink recall.** Whatever stays in it is still billed uncached on every Call, and recall would still have to guess what the model needs.
- **Add the Opening at the first Eviction.** It saves up to 1,000 cached tokens per Call before the Eviction, but changes the system prompt mid-Conversation and rewrites the whole cache at that point.
- **Keep replaying the tail from the Store's copies.** That keeps one source of content, but any serialisation difference now breaks the cache from the system prompt on, not just from the Briefing.
- **Fall back to a user message where `before_agent_start` never fires.** That re-creates the per-Call message this ADR removes, with all its cache and authority problems.

## Consequences

- Retrieved text no longer carries system authority. ADR-0011 accepted that recalled tool output, Doc Store text and structure sat in a system message behind a fence; they now arrive as tool results, with user-level trust. The marker and the fence are deleted.
- The system prompt is no longer wholly Floor. pi-chart's additions are Pack parts: Accounting and `/pack` still list `pinned` and `opening`, marked as sitting in the system prompt, and the Floor is the harness's system prompt without them. A memory backend's injection is still Floor (ADR-0004).
- What enters the Pack is still deterministic (ADR-0003). What the model pulls depends on its own tool calls, which the Journal records like any other tool result. Pulled results count as ordinary Turn content in Accounting and under the Ceiling.
- Changing a Pin now rewrites the cache from the system prompt on, not only from the Briefing. A Turn whose Opening fetch fails sends without it, which changes the system prompt for that Turn and again when it returns.
- If the harness never fires `before_agent_start`, the Pins and the Opening are missing, and `/pack` reports them as unavailable. The hook is declared in `src/harness.ts`.
- Deleted: the Briefing message, the `pi-chart.briefing` Journal entries and their re-send logic, the user-message fallback for other models, and per-Call recall, curated and structure assembly. A Conversation resumed after the change ignores its old briefing entries. There is no migration; the first Call after resuming rewrites the cache once.
- A fact that only recall can bring back now depends on the model deciding to search for it. The benchmark's turn-3 probe measures exactly that.
- The cutover is measured on a 40-Turn workload against plain omp, built before the cutover. ADR-0013's low-water mark is swept on top of it.
