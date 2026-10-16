# Rounding

## Weighted sizes

Round each weighted size to the nearest multiple of 10. A value exactly halfway between two multiples (one ending in 5) rounds up: 365 becomes 370, 2252.5 becomes 2250.

## Display

How a number is shown in a rendered table:

- Below 1000: the whole number as is, for example `740`.
- 1000 or more: in thousands, with exactly one decimal and a `k` suffix. Halves round up. For example 1234 is `1.2k`, 1250 is `1.3k`, 12000 is `12.0k`.
