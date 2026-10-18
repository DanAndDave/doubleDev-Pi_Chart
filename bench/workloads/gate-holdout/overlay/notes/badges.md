# Card badges

A card shows at most two badges: the status badge, then the trust badge. A badge that is empty is not shown.

## Status badge

A Concept is stale when parseConcept marks it `stale`.

| Status | Fresh | Stale |
| --- | --- | --- |
| `draft` | `SKETCH` | `SKETCH-OLD` |
| `stable` | (empty string) | `OLD` |
| `deprecated` | `SUNSET` | `SUNSET` |

## Trust badge

| Trust | Badge |
| --- | --- |
| `unverified` | `unchecked` |
| `machine-confirmed` | `bot-seen` |
| `human-reviewed` | `peer-read` |

## Footer marks

The card footer ends with two marks, in this order:

- `seal=<letter>`: `A` for a human-reviewed Concept that is not stale, `B` for a machine-confirmed Concept that is not stale, `C` for any other.
- `cites=<n>`: how many of the Concept's sources name a `resource`.
