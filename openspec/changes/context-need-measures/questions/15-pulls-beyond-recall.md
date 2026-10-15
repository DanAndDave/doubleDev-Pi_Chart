# Pulls beyond recall

Type: grilling
Status: closed
Blocked by: 01-name-the-measures, 03-measuring-both-arms-alike

## Question

Which tool calls are Pulls, and which Pulls count toward Lapse? Doc and structure Pulls bring content the Conversation never held; plain omp has no analogue for any Pull.

## What's known

- The glossary's **Pull** names three tools, but pi-chart registers six: `recall_across_conversations`, `recall_earlier_turns`, `search_documentation`, `codebase_structure`, `walk_documentation`, `write_documentation` (`src/extension.ts:1249-1353`).
- `recall_earlier_turns` returns only Turns before the tail's start and records their `turnIndices` in the result's details (`src/extension.ts:1603-1613`).
- `recall_across_conversations` records only the conversation ids in its details (`src/extension.ts:1543-1546`); the Turn index appears only in the rendered text, as `conversation <id>, turn <n>` (`src/report.ts:512-513`).
- Ticket 03: one-Arm Measures report "n/a" on the other side and feed no headline.

## Resolution

- **Pull** is any tool call that brings content into a Turn from outside it: `recall_earlier_turns`, `recall_across_conversations`, `search_documentation`, `walk_documentation`, `codebase_structure`. `write_documentation` adds nothing to the window and is not a Pull; its calls get their own pi-chart-only count.
- **Recall Pull** is classified by what the Pull returned, not by the tool: any Pull whose result holds a Turn of the same Conversation that the Call's Context Window did not carry. `recall_earlier_turns` always qualifies; `recall_across_conversations` qualifies when it returns such a Turn.
- Doc, walk and structure Pulls never count toward Lapse: they bring content the Conversation never held. They appear as pi-chart-only rows (count, tokens returned); their price is already in Cost.
- **One exception to ticket 02's "records nothing new":** `recall_across_conversations` adds the Turn identities (conversation id, Turn index) of its results to its tool result details. That is result metadata, not a new Accounting record. Parsing the rendered text was rejected because it breaks when the wording changes.
