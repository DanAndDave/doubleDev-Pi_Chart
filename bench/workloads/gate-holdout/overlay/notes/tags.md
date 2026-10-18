# Tag weights and order

A tag's weight comes from its prefix: the part of the tag before its first `:`. Prefixes match exactly, so `Core:x` has no known prefix.

| Prefix | Weight |
| --- | --- |
| `core` | 7 |
| `area` | 4 |
| `lang` | 2 |
| any other, or a tag with no `:` | 1 |

Ranked tags are ordered heaviest first. Tags of equal weight are ordered by the plain `<` comparison of the tag strings (code-unit order, so `Zulu` comes before `beta`). A tag the Concept lists more than once appears once.
