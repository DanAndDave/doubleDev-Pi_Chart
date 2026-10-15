# Name the measures

Type: grilling
Status: closed
Blocked by: —

## Question

What are the domain terms for the new measures, and how do they relate to Accounting? The following things need names:

- Part of a Call's window that the next action did not depend on.
- Something the agent needed that was not in the window. Evidence of this is a re-fetch or a recall pull.
- The re-fetch itself: re-reading a file or re-running a command whose result an earlier Turn already had.
- A recall pull.
- A planted fact.
- The task-level outcome.
- The word for the whole family, since "metrics" is an _Avoid_ word under **Accounting** in `CONTEXT.md`.

## What's known

- **Accounting** in `CONTEXT.md` is "the record of what each Call's Context Window contained". It records what the window held. These measures judge whether what it held was needed, so they may sit beside Accounting rather than inside it.
- In scope: tail utilisation, ablation, re-fetch rate, recall pulls, planted-fact retention, and task outcome with cost per solved task.

## Resolution

Terms are in `CONTEXT.md` under `### Measuring`. "Shortfall" was ruled out: it already names a part carrying less than its Budget (pack-accounting, pack-inspection and thread-store specs). "Probe" keeps its ADR-0014 meaning.

- **Family**: **Measure**. It sits beside Accounting: Accounting records what the window held, and a Measure judges whether that was needed. Accounting's entry is unchanged.
- **Unused window part**: two verdicts, never interchanged. **Used** comes from **Utilisation** (cheap, correlational: the next action refers to the part). **Needed** comes from **Ablation** (causal: the next action changes without the part). The leftover is their complement and gets no term.
- **Needed but absent**: **Lapse**. It is seen only through a recall Pull of an evicted Turn, a Re-fetch of a result that had left the window, or a failed Probe. A Pull or Re-fetch that brings the content back is a *recovered* Lapse.
- **Re-fetch**: defined by the result, not the call. It is a tool call whose result is identical to one an earlier Turn of the same Conversation received. Re-reading after an edit never counts. A Re-fetch made while the earlier result is still in the window is counted but is not a Lapse, so plain omp's redundant re-reads are not scored as context failures. Both Arms can compute it from Journals alone.
- **Recall pull**: **Pull** is a call to any of `recall_earlier_turns`, `search_documentation` or `codebase_structure`, and a recall Pull is the first alone. Whether doc and structure Pulls count toward Lapse stays in the fog ("Tool pulls beyond recall").
- **Planted fact**: **Plant**, **Probe** and **Retention** (the share of Plants their Probes answered correctly). "Recall rate" is avoided because recall means the Thread Store search.
- **Task outcome**: a **Graded Task** ends in a **Pass** or a Fail. **Cost per Pass** is an Arm's total spend over its Graded Tasks divided by the passes.
- **Benchmark nouns**: **Arm**, **Workload** and **Run** (one Conversation of one Arm over one Workload) are also in the glossary.
