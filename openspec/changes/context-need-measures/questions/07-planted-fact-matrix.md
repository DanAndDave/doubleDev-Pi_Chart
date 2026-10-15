# Planted-fact matrix

Type: grilling
Status: closed
Blocked by: 14-memory-benchmark-fact-planting

## Question

What is the matrix of Plants that measures Retention? Settle the following:

- **Distances.** How many Turns separate a plant from its probe.
- **Fact types.** For example: a literal token, a decision with its reason, a constraint that must change later behaviour, or a fact later superseded.
- **Placement.** In the prompt, in a tool result, or in the agent's own reply.
- **Distractors.**
- **Probe style.** Asked directly, or needed silently to complete a later task.
- **Attribution.** How each answer is traced to its source: the Opening, the tail, a recall Pull, or a guess.

## What's known

- The current probe (`scripts/bench-tokens.ts:50-52`) plants two facts:
  - a codeword in Turn 0, which the Opening carries;
  - a build number in turn 3, which only recall can bring back.
  It asks for both at turn 40 with tools forbidden, and scores each by substring match.
- On 2026-10-14, recall missed the turn-3 fact 0 out of 3 times, at distances 0.537–0.547 against a 0.52 cutoff. That was the push-recall design; ADR-0015 since made recall a tool with no cutoff.

## Resolution

- **Carrier:** Plants ride the Gate Workload, so they cost no extra Runs.
- **Distances:** three bands set around eviction: still in the tail (≤ 5 Turns), just evicted (8–12 Turns), deep (≥ 25 Turns). Each Probe is also tagged with where its Plant sat when the Probe ran: Opening, Pin, tail or evicted. Ground Truth First found eviction, not distance, drives loss (ticket 14).
- **Fact types:** a literal token; a value later superseded, its old value serving as the near-miss distractor; a constraint the agent must follow later, probed silently and checked by a deterministic rule. "A decision with its reason" is dropped: it would need a judge.
- **Placement:** half in prompts, half in tool results.
- **Probes:** direct Probes run with tools allowed, so they measure the window plus recall. One tools-forbidden Probe at the end measures the window alone.
- **Scoring:** deterministic matching only, no judge. Plant values are fictional, so they cannot be guessed.
- **Attribution:** offline, from the window rebuilt per Call (ticket 02). Each answered Plant gets a source (in the window: Opening, Pin or tail; a recall Pull whose result contains the value; a Re-fetch of the file holding it; none) and a result (right or wrong). Right with no source is flagged as a leak and investigated; fictional values make guessing impossible, so no no-fact control Runs. Wrong despite a source is reported apart from Lapses. Evicted and not brought back feeds the Lapse count.
