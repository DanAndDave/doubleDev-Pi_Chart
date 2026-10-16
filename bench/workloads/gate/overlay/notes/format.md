# Summary line layout

`summaryLine(sizes, budget)` returns a single line of fields joined by ` · ` (a space, a middle dot U+00B7, a space). The fields, in order:

1. `turns=<n>`: how many sizes there are.
2. `total=<n>`: the sum of the sizes, unweighted.
3. `used=<p>%`: the total as a percentage of `budget`, rounded down to a whole number. It may exceed 100.
4. The footer fields from notes/buckets.md, each as its own field.

Numbers are plain integers: no separators, no `k` suffix.

Example: `turns=3 · total=9400 · used=47% · peak=large · over=0`
