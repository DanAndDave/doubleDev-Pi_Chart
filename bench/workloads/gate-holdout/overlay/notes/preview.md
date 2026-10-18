# Previews

## Tag preview

`tagPreview(concept)`: the first three tags of rankedTags, joined by `, ` (a comma, a space). When more tags remain, append ` (+<k>)`, where k is how many were left out. A Concept with no tags shows `no tags`.

Example: `core:tail, area:store, lang:ts (+2)`

## Body preview

`bodyPreview(concept)` starts from the Concept's description. When the description is missing or blank, it starts from the text of the first entry of cardSections instead, without that entry's heading line when it has one. Every run of whitespace, newlines included, becomes a single space, and both ends are trimmed. Then:

- 46 characters or fewer: shown whole.
- Longer: keep the first 43 characters, then cut back to the last space within them, dropping that space and everything after it, and append `...`. When those 43 characters hold no space, keep all 43 and append `...`.
- Nothing left to show: `(empty)`.

Example: `A card shows one Concept on a single screen, badges first.` becomes `A card shows one Concept on a single...`
