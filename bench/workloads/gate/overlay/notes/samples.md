# Sample histogram

How the histogram of a Conversation's Turn sizes is laid out.

- One entry per bucket, `{ bucket, count }`, from the largest bucket to the smallest: `huge`, `large`, `medium`, `small`, `tiny`.
- A bucket no Turn falls in still gets an entry, with count 0, except `huge`, which is left out when it is empty.

Sample, for sizes `[120, 90, 2400, 400, 8000]`:

```
[
  { bucket: "large", count: 1 },
  { bucket: "medium", count: 1 },
  { bucket: "small", count: 1 },
  { bucket: "tiny", count: 2 },
]
```
