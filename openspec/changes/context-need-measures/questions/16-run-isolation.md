# Run isolation

Type: grilling
Status: closed
Blocked by: 06-task-suite-source

## Question

What state does a Run share with the machine it runs on and with other Runs, and what must be isolated so that the Gate and the comparison measure the Workload alone?

## What's known

- `scripts/bench-tokens.ts` spawns `omp` with the caller's environment (`:282`), so every pi-chart Run uses the user's Thread Store and documentation bundle.
- `recall_across_conversations` searches "every recorded conversation" (`src/extension.ts:1252`): the user's history, earlier Runs, and sibling Runs running in parallel, including their answers to the same Probes.
- `write_documentation` writes to `PICHART_DOC_BUNDLE`, default `~/.pi-chart/bundle` (`src/config.ts:372`); a Run can write into the user's bundle, and a later Run can read it back through `search_documentation` or `walk_documentation`.
- The workspace copy excludes `graphify-out/` (`scripts/bench-tokens.ts:251-252`) and `PICHART_GRAPH` is unset, so `codebase_structure` answers "no graph" in every Run (`src/extension.ts:1718`).
- Accounting is written to the Thread Store (`deps.accounting.recordPack`, `src/extension.ts:789`), and ticket 02's measures script reads it after the Run.

## Resolution

- **Per-Run Thread Store.** Each pi-chart Run gets its own Thread Store database, created when the Run starts and dropped only after the measures script has read the Run's Accounting from it.
- **Per-Run bundle.** The Workload's bundle is copied into the Run's temporary directory and `PICHART_DOC_BUNDLE` points at the copy, so `write_documentation` cannot reach the user's bundle or another Run.
- Within a Run, `recall_across_conversations` finds only that Run's own Conversation. The comparison report states that this removes any benefit from earlier Conversations.
- **The Workload freezes both curated inputs.** `bench/workloads/<name>/` gains `bundle/` (a small hand-picked set of Concepts, possibly empty) and `graphify-out/` (extracted once against the pinned commit at freeze time), with `PICHART_GRAPH` pointed at it. Changing either is a new Workload version under ticket 06's rule.
