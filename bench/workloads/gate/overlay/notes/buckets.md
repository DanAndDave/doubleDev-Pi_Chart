# Turn-size buckets

A Turn's size is its estimated tokens. Every size falls in exactly one bucket. Lower bounds are inclusive, upper bounds exclusive.

| Bucket | From | Below |
| --- | --- | --- |
| `tiny` | 0 | 350 |
| `small` | 350 | 1800 |
| `medium` | 1800 | 7000 |
| `large` | 7000 | 24000 |
| `huge` | 24000 | (no bound) |

## Summary footer

The summary line ends with two footer fields, in this order:

- `peak=<bucket>`: the largest bucket that holds at least one Turn, or `peak=none` when there are no Turns.
- `over=<n>`: how many Turns are larger than 9000 tokens (strictly larger).
