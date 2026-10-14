## 1. Stored Briefings, pure

- [x] 1.1 In a new `test/briefings.test.ts`, write failing tests for `replayBriefings`: a hash-only entry resolves to a text written earlier in the file; an unresolved hash yields a missing record; two entries for one message, last written wins; a `precedes` entry resolves to the first message child written after it; malformed entries are skipped
- [x] 1.2 Create `src/briefings.ts` with the `BriefingEntry` type, `BRIEFING_ENTRY = "pi-chart.briefing"`, `briefingMessage(text, timestamp)` (the one constructor for the cleared `developer` message), and `replayBriefings`; make 1.1 pass
- [x] 1.3 Write failing tests for `placeBriefings`: each stored Briefing is inserted right after its message; a message missing from the Pack sends nothing; an unresolved text is counted missing with nothing in its place; two calls give identical output; it returns `resent`, `resentBytes`, `missing`
- [x] 1.4 Implement `placeBriefings` in `src/briefings.ts`; make 1.3 pass

## 2. One Briefing message, fenced

- [x] 2.1 In `test/assembler.test.ts`, change the block-shape tests (opening line, "a pin alone still opens the block", "pins close the pack") to expect one Briefing message whose text runs framing, Pins, marker, recalled, curated, structure; no Pins means framing then marker; nothing assembled means no Briefing; watch them fail
- [x] 2.2 In `src/assembler.ts`, make `compose()` render all parts into one message with the fixed marker after the Pins; keep `PackPart` approximations per part; make 2.1 pass
- [x] 2.3 Update every other test that indexes `Pack.messages` per part (about 28 in `test/assembler.test.ts`, 44 in `test/extension.test.ts`) to read the Briefing text instead; delete tests that only pinned the old message split

## 3. Sent, stored and re-sent by the extension

- [x] 3.1 Add `model?: { compat?: { supportsMidConversationSystem?: boolean; supportsTurnScopedSystem?: boolean } }` to `HandlerContext` in `src/harness.ts`
- [x] 3.2 In `test/extension.test.ts`, write failing tests with a capable model: the Briefing goes out as `developer` with the clear payload and is the last message; one `pi-chart.briefing` entry is written per Call (`precedes` on a first Call, `follows` on a later one); a second Turn re-sends the first Turn's Briefings byte for byte after their messages, and only the current one is uncleared at the end
- [x] 3.3 Also failing: an incapable model gets one `user` Briefing, no entry, nothing re-sent, and switching back re-sends the stored ones; `/tree` off a message stops its Briefing; a fork and `/btw` promotion carry only on-path Briefings with their text inline; an evicted message's Briefing is not sent
- [x] 3.4 In `src/extension.ts`'s `context` handler, decide the mode from `ctx.model.compat`, write the entry with `pi.appendEntry`, replay the whole Journal, and place Briefings with `placeBriefings`; make 3.2 pass
- [x] 3.5 Extend the fork / `/btw` carry-over beside the Pin carry-over to write on-path Briefings into the new Journal; make 3.3 pass
- [x] 3.6 Pin the flush-order guard with a captured Journal from `evidence/entry-ext.ts` and with one in the reverse order (prompt before entry): both resolve to the prompt

## 4. Accounting and inspection

- [x] 4.1 In `test/postgres-store.test.ts`, write failing tests: a Call's `briefing` figures round-trip; a row from before the migration reads back with them absent; pack size is the same with and without re-sent Briefings
- [x] 4.2 Add the `briefing` field to `recordPack`, `MemoryAccounting`, and a new Postgres migration with the four nullable columns; make 4.1 pass
- [x] 4.3 In `test/report.test.ts`, write failing tests: `/pack` prints the way sent, the re-sent count and bytes, and missing; a fallback Call says it was replaced; an older record has no Briefing line; the summary counts missing across the Conversation
- [x] 4.4 Implement the lines in `src/report.ts`; make 4.3 pass

## 5. Docs and acceptance

- [x] 5.1 Amend ADR-0011's write-timing consequence: entries are written in the hook, `precedes` on a first Call, so none is lost on a crash; note that a first-Call entry is an ancestor of its prompt
- [x] 5.2 Fix `CONTEXT.md` **Briefing** ("Pins last" becomes framing, Pins, marker, retrieved; one message; turn-scoped where supported) and README's pack-order paragraph
- [x] 5.3 Run `bun test` and typecheck; all green
- [x] 5.4 Proxied run with `thinking-binding-controls-2026-08-01`: three `omp -p -c` Turns with tool calls on `anthropic/claude-opus-5-5`; save the log to `evidence/` and a summary beside it. Pass: zero `prefix_binding_mismatch` (was 53)
- [x] 5.5 Run `scripts/bench-tokens.ts`; write a dated benchmark document beside the 2026-10-13 one. Pass: prefix held for turns 1–7 no worse than the 2026-10-13 figure
