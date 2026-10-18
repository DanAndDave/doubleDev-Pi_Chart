# Card layout

## Header line

`headerLine(concept)`: the Concept's title, or its id when it has no title, then each badge from badgesOf wrapped in square brackets. Parts are separated by one space.

Example: `Tail eviction [SKETCH] [bot-seen]`

## Card

`renderCard(concept)` returns the card as an array of lines, in this order:

1. The top rule: `=` repeated 40 times.
2. The header line.
3. `> ` followed by the body preview.
4. `tags: ` followed by the tag preview.
5. One line per label of numberedHeadings, each indented by three spaces. A Concept with no sections gets the single line `   (no sections)` instead.
6. The bottom rule: `-` repeated 40 times.

No line is padded, wrapped or cut.
