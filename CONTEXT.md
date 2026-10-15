# Pi Chart

A context manager for coding agents. Four durable stores hold what the agent knows; an assembler rebuilds the agent's context window from them on every turn, so nothing accumulates that the next turn does not need.

## Language

### The window and what fills it

**Context Window**:
The messages one Call sends to the model, whichever harness assembled them: under pi-chart a Context Pack, under plain omp the accumulated history since the last compaction plus its summary.
_Avoid_: context, context memory, memory

**Context Pack**:
The bundle the assembler produces for one Call: pi-chart's additions to the system prompt (every Pin, the Opening and a fixed eviction notice), the verbatim tail, and the current Turn. The unit that fills a Context Window, rebuilt each Call rather than grown. Recall, curated knowledge and structure enter it only when the model pulls them with a tool, and then as ordinary Turn content.
_Avoid_: payload, bundle, prompt context

**Assembler**:
The component that selects what enters a Context Pack, under a fixed budget per store.
_Avoid_: retriever, orchestrator, router

**Budget**:
The share of a Context Pack a single store, or the Conversation's Pins together, may occupy. Set per store, independently, in two denominations at once — a count of items and a size in estimated tokens — and a store is held to whichever binds first. A Budget a store's irreducible content cannot fit is reported as exceeded rather than quietly broken.
_Avoid_: limit, quota, cap

**Ceiling**:
The whole Context Pack's size limit, independent of any one store's Budget. When the parts exceed it, the oldest tail Turns go first; then the newest Turn of the verbatim tail and the current Turn are shortened, never dropped. A Pin or the Opening is never dropped or shortened for it.
_Avoid_: max tokens, window size, hard limit

**Elision**:
What replaces the middle of a payload too large to carry whole: the head and the tail survive with a marker naming what went. Applied to tool results, recollections, the Opening, and the arguments of tool calls; to the prompt and final reply of a verbatim-tail Turn only once nothing else in it can give way; never to the current Turn's prompt or to the agent's own reasoning within the current Turn. Always marked, so shortened content is never mistaken for short content.
_Avoid_: truncation, summary, compaction

**Verbatim tail**:
The most recent completed Turns, carried as the messages they were rather than as recollections. Its newest Turn is never dropped: when it does not fit, its oldest tool-call groups go first, behind a marker in its prompt, down to the prompt and the final reply. It gives up older Turns only by Eviction, so between Evictions it carries less than its Budget allows.
_Avoid_: recent history, sliding window, last N turns

**Eviction**:
The verbatim tail giving up its oldest Turns in one step, down to its low-water mark — a share of its Budget — once a new Turn would carry it past that Budget. Between Evictions each new Turn is added behind a start that does not move. Turns the tail has evicted are what recall searches.
_Avoid_: sliding, trimming, rolling window

**Opening**:
The prompt of a Conversation's first Turn, carried in the system prompt of every Context Pack from the first Turn on, framed as context and not a new instruction. Held to its own Budget and shortened by Elision rather than dropped for it.
_Avoid_: goal, anchor, first message, first prompt

**Eviction notice**:
The fixed last line of pi-chart's system-prompt additions, saying older Turns may have left the window and naming `recall_earlier_turns`. Carried on every Turn, before and after the first Eviction, byte for byte the same in every Conversation, so the system prompt does not change when the tail first evicts.
_Avoid_: recall hint, eviction marker

**Floor**:
The part of a Context Window the Assembler cannot reach: the harness's system prompt, tool schemas, skills, and rules. pi-chart's own additions to the system prompt belong to the Context Pack, not the Floor. Measured, budgeted around, and deliberately left intact.
_Avoid_: overhead, preamble, base context

**Pin**:
Text the user writes into a Conversation that every Context Pack carries in the system prompt, whole and unreduced, until the user removes it. Recorded in the Journal and inherited by Conversations forked or branched from it; never retrieved, ranked, or shortened.
_Avoid_: sticky, note, memory, pinned context

**Journal**:
The harness's append-only on-disk record of a Conversation. The source of record the Thread Store derives from, and untouched by anything the Assembler does.
_Avoid_: transcript, log, session file

### The stores

**Store**:
A durable home for knowledge that outlives a Context Window. There are exactly four, each with one job and one substrate.
_Avoid_: memory, memory layer, backend

**Doc Store**:
Long-lived curated knowledge, held as an OKF bundle. Machine-wide: one corpus serving every Codebase.
_Avoid_: knowledge base, docs, long-term memory

**Spec Store**:
The OpenSpec directory inside a Codebase, recording intended behaviour. The only store this project does not own: it verifies the directory is initialized as expected and initializes it when it is not.
_Avoid_: specs, requirements store

**Thread Store**:
The record of what happened: every Turn's prompt, response, tool call, and artifact, in one Postgres database across all Conversations.
_Avoid_: history, conversation memory, episodic memory

**Graph Store**:
The programmatic structure of a Codebase — which code calls, imports, and inherits from which — produced by graphify and held inside that Codebase. Carries no documentation links.
_Avoid_: code graph, knowledge graph, index

### Units

**Codebase**:
A repository a coding agent is working in. The Spec Store and Graph Store live inside one; the Doc Store and Thread Store live outside every one.
_Avoid_: project, repo, workspace

**Conversation**:
One continuous line of work with the agent. The default retrieval scope of the Thread Store: reaching outside the current Conversation is an explicit query, never a default.
_Avoid_: session, thread, chat

**Turn**:
One prompt and the agent's complete response to it, including the tool calls made along the way. The unit the Thread Store records and the Assembler serves.
_Avoid_: message, exchange, interaction

**Call**:
One request to the model. A Turn is one or more Calls: a tool-using Turn makes a further Call for every tool result it acts on. Each Call gets its own Context Pack.
_Avoid_: request, completion, round-trip

**Accounting**:
The record of what each Call's Context Window contained, split between the Context Pack and the Floor.
_Avoid_: metrics, telemetry, stats, log

**Concept**:
One unit of knowledge in the Doc Store: a single markdown file with frontmatter, per OKF. Its identifier is its path within the bundle.
_Avoid_: document, note, entry

**Level**:
One directory of the Doc Store, listing the Concepts and sub-Levels directly beneath it. The unit of progressive disclosure: read a Level, decide what to open.
_Avoid_: folder, directory, section, index

### Measuring

**Measure**:
A judgement of whether a Call's Context Window held what its next action needed, made from Conversations already recorded. Sits beside Accounting, which records what the window held.
_Avoid_: metric, stat, eval

**Utilisation**:
The share of a Call's Context Window, by tokens, that its next action Used. Cheap and correlational.
_Avoid_: relevance, hit rate, coverage

**Used**:
The Utilisation verdict on a part: the next action refers to it, by path, by a copied span, or by shared rare identifiers. Never interchanged with Needed.
_Avoid_: relevant, consulted, read

**Ablation**:
Re-sending a Call with one part of its Context Window removed, to see whether the next action changes. Causal, and a lower bound on need when parts are redundant.
_Avoid_: leave-one-out, knockout, removal test

**Needed**:
The Ablation verdict on a part: the next action changes without it. Never interchanged with Used.
_Avoid_: necessary, required, load-bearing

**Lapse**:
A Call whose next action needed content its Context Window did not carry. Seen only through a recall Pull of an evicted Turn, a Re-fetch of a result that had left the window, a Revisit that fetched its file after the earlier read had left the window, or a failed Probe: a wrong Score with an evicted Position and no Source. All but the last are recovered Lapses, each counted apart.
_Avoid_: miss, gap, shortfall

**Re-fetch**:
A tool call whose result is identical to one an earlier Turn of the same Conversation already received. A Lapse only when that earlier result had left the window; one made while it is still held is model redundancy.
_Avoid_: re-read, redundant call, repeat

**Revisit**:
A Graded Task that needs again a Workload file an earlier step sent the agent to. Scored by whether a tool call of the step named the file, whether the window still held the earlier read when it did, and the step's Pass or Fail, so a direct answer and a fetch are judged alike. Excluded when the file was edited by then.
_Avoid_: re-read point, return, callback

**Pull**:
A tool call that brings content into a Turn from outside it: `recall_earlier_turns`, `recall_across_conversations`, `search_documentation`, `walk_documentation` or `codebase_structure`. Writing to the bundle is not a Pull. A recall Pull is one whose result holds a Turn of the same Conversation that the Context Window did not carry, whichever tool returned it.
_Avoid_: fetch, retrieval, lookup

**Distance**:
The number of Turns from the one where content entered a Conversation to the one that needed it: a Plant's Turn to its Probe's, an earlier result's to its Re-fetch's. Lapses and Retention are counted in bands of it.
_Avoid_: age, gap, lag

**Plant**:
A fact stated in an early Turn, in a prompt or in a file a tool reads, so a later Probe can ask for it. A literal Plant is a value to repeat, a superseded Plant replaces an earlier value, and a constraint Plant is a value a later tool call must carry.
_Avoid_: needle, codeword, planted fact

**Probe**:
A prompt that asks for one or more Plants, scored separately for each. It may forbid tools.
_Avoid_: question, check, test prompt

**Score**:
One Plant judged right or wrong at one Probe Turn. The verdict Retention is counted from, never a Measure itself.
_Avoid_: verdict, answer, grade

**Retention**:
The share of complete Runs whose Score for a Plant at a Probe was right.
_Avoid_: recall rate, memory score, accuracy

**Position**:
Where a Plant sat in the Context Window of its Probe's first Call: the Opening, a Pin, the verbatim tail, a compaction summary, or evicted. Says what the window carried, not what the answer drew on.
_Avoid_: location, placement, slot

**Source**:
The first thing that held a Plant's value for a Score: a part of the Probe's first Context Window, a Pull result, another tool result of the Probe Turn, or none. It can differ from Position: a value repeated in a later Turn has an evicted Position and a tail Source.
_Avoid_: origin, provenance, evidence

**Leak**:
A right Score with no Source: the value came from nothing the Run gave the model.
_Avoid_: hallucination, lucky guess, contamination

**Stale**:
A wrong Score of a superseded Plant whose answer gave the earlier value.
_Avoid_: outdated, old value

**Breach**:
A Score whose Probe forbade tools and whose Turn called one anyway. It still counts.
_Avoid_: violation, cheat

**Unplanted**:
A Score whose Plant no prompt or tool result stated before its Probe. Neither a Lapse nor unknown.
_Avoid_: missing Plant, unstated

**Graded Task**:
One step of a Workload: its prompts plus a check, run after the last of them, that decides whether the step is a Pass or a Fail.
_Avoid_: solved task, benchmark task, success

**Cost per Pass**:
An Arm's total spend over its Graded Tasks divided by the number that passed.
_Avoid_: cost per solved task, success rate

**Arm**:
One configuration under comparison, such as pi-chart or plain omp.
_Avoid_: variant, condition, side

**Workload**:
The fixed sequence of prompts an Arm is given.
_Avoid_: script, scenario, prompt set

**Run**:
One Conversation of one Arm over one Workload.
_Avoid_: trial, session, attempt

**Gate**:
The check a change to pi-chart passes before it is archived: Runs of the change paired with Runs of the commit before it, ending in pass, fail or inconclusive.
_Avoid_: regression test, CI, baseline run
