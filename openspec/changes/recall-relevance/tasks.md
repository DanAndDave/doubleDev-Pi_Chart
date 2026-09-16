## 1. Measure before choosing

- [ ] 1.1 Embed a recorded session with the real model and report the actual distances from a prompt to the relevant Turn and to the irrelevant ones, and record the figures
- [ ] 1.2 Choose the default threshold from those figures with a margin, and record why that value rather than a neighbouring one

## 2. The floor in retrieval

- [ ] 2.1 Apply the threshold in the retrieval query so rejected Turns are never returned, and verify against a real store that a Turn below it is absent even when nothing ranks above it
- [ ] 2.2 Verify a Conversation where nothing meets the minimum returns no Turns rather than its least-irrelevant ones
- [ ] 2.3 Verify a permissive threshold returns the same Turns in the same order as no threshold at all
- [ ] 2.4 Return the count of Turns rejected as too distant alongside the results, and verify it against a known corpus
- [ ] 2.5 Make the threshold configurable, and verify an unset or unusable value falls back to the measured default

## 3. Reporting it

- [ ] 3.1 Carry the rejection count onto the recalled pack part, distinct from the Budget's own exclusions, and verify a part that found little is not reported as trimmed
- [ ] 3.2 Report irrelevance in the inspector, and verify a part that carried less than its Budget for want of relevance says so
- [ ] 3.3 Verify a Call where everything was rejected records the rejection count with no recalled part
- [ ] 3.4 Render the distinction in the pack report, and verify the rendered text distinguishes trimmed from irrelevant

## 4. Verification

- [ ] 4.1 Re-run the session that exposed the defect and confirm the retries question now recalls the retries decision without the river and the colour
- [ ] 4.2 Confirm with the real model that the default threshold keeps a genuine paraphrase while rejecting an unrelated Turn
- [ ] 4.3 Run the default, store-backed, model, and live suites, and the type checker, and confirm `openspec validate recall-relevance` passes
