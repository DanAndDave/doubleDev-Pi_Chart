## 1. Measure before choosing

- [x] 1.1 Estimate every Turn in this machine's Journals both ways — content only and whole serialized message — and report the ratio of each to the harness's reported pack size for the Calls that recorded one, and record the figures
- [x] 1.2 Choose the default Pack ceiling and the default per-part token Budgets from those figures, and record why each number is what it is, including the headroom left for the estimate's residual error
- [x] 1.3 Choose the share of the ceiling at which a Pack is reported as approaching it, and record what that share does on the audited Conversation

## 2. The estimate

- [x] 2.1 Estimate over the whole serialized message rather than its content alone, and verify a tool result carrying `details` is counted above what its `content` alone would give
- [x] 2.2 Verify the estimate is unchanged by message order and identical across repeated calls on the same messages
- [x] 2.3 Record the assembly-time estimate alongside the harness's reported pack size for a Call, and verify both are readable afterwards and distinguishable

## 3. Token Budgets per part

- [x] 3.1 Add a token Budget beside each part's count Budget in configuration, with the measured defaults, and verify an unset value falls back to that default and an unusable value does not crash
- [x] 3.2 Trim each part to whichever Budget binds first, and verify a part within its count Budget but over its token Budget carries only what fits, strongest first
- [x] 3.3 Verify a part within its token Budget but over its count Budget still carries only the count allowed
- [x] 3.4 Verify exhausting one part's token Budget leaves every other part bounded only by its own
- [x] 3.5 Extend the in-session Budget command to the token Budgets and the ceiling, and verify an invalid value is refused with a reason

## 4. Shortening

- [x] 4.1 Shorten an oversized tool result head-and-tail with a marker naming the elided size, and verify the head and tail survive and the marker states what was removed
- [x] 4.2 Shorten an oversized recollection the same way, and verify the recollection is carried shortened rather than dropped or carried whole
- [x] 4.3 Verify a user prompt and assistant text are never shortened
- [x] 4.4 Verify content within its Budget is carried unaltered and unmarked

## 5. The pack ceiling

- [x] 5.1 Add the Pack ceiling to configuration and reduce an oversized Pack to fit it inside `assemble()`, and verify the returned Pack is within the ceiling
- [x] 5.2 Reduce in the specified order — structure, then curated knowledge, then the weakest recollections, then the oldest Turns of the tail — and verify each is exhausted before the next is touched
- [x] 5.3 Verify the tail is reduced from its oldest Turn and the most recent Turns remain
- [x] 5.4 Verify reducing the same oversized selection twice produces identical Packs
- [x] 5.5 Carry the current Turn even when it alone exceeds the ceiling, eliding its payloads oldest first, and verify the Turn survives and the condition is reported. Elision and its order are proven on synthetic Turns and the overrun report at the extension boundary; the largest Turn in the Journal fixtures holds only messages below the shortest length worth carrying, so against it the test proves the other half of the requirement — the Turn is carried whole and the Pack goes out over its ceiling rather than losing the prompt
- [x] 5.6 Verify a Pack already within the ceiling is byte-identical to the Pack assembled without one

## 6. Accounting for what was excluded

- [x] 6.1 Record the reason a part carried less than its candidates offered — relevance, count, size, or ceiling — as distinct reasons, and verify each is readable per part
- [x] 6.2 Record what a part would have carried without the ceiling, and verify a ceiling-reduced part reports both figures
- [x] 6.3 Record that a part carried shortened content, and verify the flag survives a read-back from the store
- [x] 6.4 Verify Accounting written before these reasons existed still reads, with the new detail absent rather than failing
- [x] 6.5 Render the new reasons in the pack inspector, and verify a size-reduced part reads differently from a count-trimmed one

## 7. Reporting a pack near its ceiling

- [x] 7.1 Report once when a Call's Pack crosses the configured share of the ceiling, naming the Pack size and the ceiling, and verify a Pack below the share reports nothing
- [x] 7.2 Verify the report neither alters the Pack nor fails the Turn when reporting itself fails

## 8. Verification

- [x] 8.1 Assemble the audited Journal's last Turn with the new defaults and confirm the Pack is within the ceiling where it previously reached 983,339 approximate tokens — 45,819 against a 110,000 ceiling. Read from the Journal rather than a scratch Thread Store: the store on this machine refuses every connection (see the pool leak recorded in the audit's Risks, owned by `store-hygiene`), and the Journal is the record the store derives from
- [x] 8.2 Run the `pack` command over a Call that read three 40 KB files in one Turn, and confirm the tail is reduced with the reason named and the Turn unaffected — all nine messages carried, prompt intact, `verbatim-tail ~24572 tokens (1 of 8, content shortened)` against a 25,000 token Budget
- [x] 8.3 Re-run the audit's governed-versus-ungoverned comparison with token Budgets in place, and record the new reduction figure against the recorded 8.6% — 97.8% (2,080,285 → 45,819), recorded in `design.md`
- [x] 8.4 Run the default and store-backed suites and the type checker, and confirm `openspec validate token-budgets` passes — 362 pass / 0 fail by default, **435 pass / 0 fail store-backed**, `tsc` clean, change valid. The store-backed run used a throwaway PostgreSQL 18.6 with pgvector on a spare port, because this machine's own store is saturated by the pool leak; that is what closed task 6.3. The live suite (`PICHART_LIVE=1`) was not run: it spawns the harness against a real provider and exercises three `context-assembly` claims — that a Pack reaches the model, that the Journal keeps what the model never saw, and that window sizes are reported — none of whose contracts this change alters
