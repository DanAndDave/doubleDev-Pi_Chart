# The Assembler is deterministic, and mnemopi is switched off

A Context Pack is built by fixed rules under a per-store Budget: the last N Turns verbatim, plus retrieved content from each Store. No model plans retrieval. Two packs built from the same state are identical and diffable, so a bad answer has one possible cause instead of two. A model-planned tail is the intended destination, added only once the deterministic core is proven.

For the same reason, omp's own memory backend is disabled (`memory.backend: off`). Two systems injecting memory into one Context Window makes a bad pack undiagnosable, and the setting is one key to reverse.

## Consequences

- Recent Turns stay verbatim. Summarizing a recent tool result breaks the agent's ability to act on what it just read; N is the first tuning knob.
- Budgets are per Store and independent, so the Doc Store and Thread Store can be tuned against each other with evidence from recorded token accounting.
