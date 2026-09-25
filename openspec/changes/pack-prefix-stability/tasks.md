## 1. Decide what may lead

- [ ] 1.1 Establish, for each part the Assembler composes, whether its messages can be carried byte-identical to what the harness supplied, and record which of them ever can
- [ ] 1.2 Decide what happens when the Thread Store's copy of a Turn disagrees with the harness's — prefer the supplied message, prefer the Store's, or carry the Store's after the run — and record why, since this is the case that decides whether a prefix exists at all
- [ ] 1.3 Decide whether elision may apply to a message inside the leading run, given that a shortened message is not the harness's message

## 2. Ordering the pack

- [ ] 2.1 Lead a Pack with the longest run of supplied messages the Assembler carries unaltered, and verify the assembled parts follow it in their existing order
- [ ] 2.2 Verify a message the Assembler alters is carried after the run rather than breaking it
- [ ] 2.3 Verify a Pack whose supplied messages are all altered still carries every part, with its Budgets and accounting unchanged
- [ ] 2.4 Verify the Turn in progress is still last
- [ ] 2.5 Verify two Packs assembled from the same inputs are still identical, and that the ceiling's reduction order is unchanged

## 3. Proving it at the cache

- [ ] 3.1 Collect a governed window under the new order with `scripts/measure-pack-cache.ts`, and verify the median cached Pack share rises from the 0.0% ADR-0005 recorded
- [ ] 3.2 Report what the change costs per Call against the baseline's 13,934 tokens at the provider's multipliers, and record the figure whichever way it goes
- [ ] 3.3 Verify a Conversation whose tail comes from the Thread Store rather than the harness is measured separately, since it is the case that may have no prefix to protect

## 4. The argument the figures do not make

- [ ] 4.1 Record what moving retrieval after the exchange does to an answer, from live Conversations judged on their answers rather than on their token counts
- [ ] 4.2 Record the decision either way as an ADR, including the outcome where the cost is won and the quality is not
