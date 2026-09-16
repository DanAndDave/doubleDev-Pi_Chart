# Triage Labels

The skills speak in terms of five canonical triage roles. OpenSpec has no label system, so this repo records the role as a `Triage:` line near the top of a change's `proposal.md`:

```markdown
# Proposal: Add dark mode

Triage: ready-for-agent
```

`openspec validate` and `openspec status` ignore that line, so it is safe to add and to rewrite in place.

| Label in mattpocock/skills | Value in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this change |
| `needs-info`               | `needs-info`         | Waiting on the reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

Rules:

- A change with no `Triage:` line counts as `needs-triage`.
- Moving a change to `wontfix` means archiving it with `openspec archive <change-id> --skip-specs`, with the reason written into `proposal.md` first.
- `ready-for-agent` requires that `openspec validate <change-id>` passes, so an AFK agent has deltas and scenarios to work from.

Edit the middle column if you later adopt a different vocabulary.
