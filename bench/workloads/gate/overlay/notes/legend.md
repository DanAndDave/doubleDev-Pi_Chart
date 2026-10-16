# Table legend

`renderTable` returns the table as an array of rows, one string per row.

- The first row is the header: `bucket | turns | weighted`.
- Then one row per histogram entry, in histogram order: `<label> | <count> | <weighted total>`, where the weighted total is the sum of the weighted sizes of that bucket's Turns.
- Columns are separated by ` | ` (space, bar, space), with no padding or alignment.

Row labels:

| Bucket | Label |
| --- | --- |
| `tiny` | crumbs |
| `small` | bites |
| `medium` | meals |
| `large` | feasts |
| `huge` | banquets |
