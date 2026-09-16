## 1. The pack remembers what it carried

- [x] 1.1 Give each pack part the identity of what it contributed, the Budget that bounded it, and how many candidates it had, and verify a recalled part names the Turns it carried
- [x] 1.2 Verify a part trimmed to its Budget records both the Budget and the larger candidate count
- [x] 1.3 Verify a part under its Budget records a spend below it

## 2. Recording the detail

- [x] 2.1 Confirm whether the per-part detail needs a schema change at all, and verify recorded Calls are undisturbed either way
- [x] 2.2 Persist the detail with each Call's accounting, and verify it round-trips through a real store
- [x] 2.3 Verify a Call recorded before this detail existed still reads back, with the detail absent

## 3. Inspection

- [x] 3.1 Implement examining one Call: its parts, their sizes, their Budgets, and the Floor beside them, and verify against recorded accounting
- [x] 3.2 Verify the Floor's share of the window is reported, and that an unmeasured Call reports no invented figures
- [x] 3.3 Implement comparing two Calls' packs as entering, leaving, and unchanged content, and verify against two recorded Calls
- [x] 3.4 Verify comparing a Call with itself reports no difference
- [x] 3.5 Implement summarising a Conversation, and verify it reports the Floor's share across its measured Calls
- [x] 3.6 Verify an empty Conversation summarises to nothing rather than failing
- [x] 3.7 Verify inspection leaves the accounting it read unchanged

## 4. Live budgets

- [x] 4.1 Allow a Budget to be changed for the running session, applying from the next Call, and verify the next pack is assembled under it
- [x] 4.2 Refuse a Budget that is not a count, leaving the previous one in force, and verify the refusal
- [x] 4.3 Record the Budget in force with each Call, and verify a pack can still be explained after a mid-session change

## 5. Surfacing it

- [x] 5.1 Register a slash command exposing inspection of the current Call, comparison with the previous one, and the Conversation summary, and verify it renders against recorded accounting
- [x] 5.2 Expose setting a Budget through the same command, and verify an invalid value is reported rather than applied

## 6. Verification

- [x] 6.1 Run a real multi-Turn session with recall active, inspect a pack, and confirm the recalled Turns named are the ones the store returned
- [x] 6.2 Report the measured pack-versus-Floor ratio and recall Budget utilisation from that session, and record whether Turn-granularity recall looks too coarse
- [x] 6.3 Run the default, store-backed, model, and live suites, and the type checker, and confirm `openspec validate pack-inspector` passes
