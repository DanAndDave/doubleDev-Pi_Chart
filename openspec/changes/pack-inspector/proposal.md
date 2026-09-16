# Proposal: Pack inspector and Budget tuning

Triage: ready-for-agent
Blocked by: thread-store-recall

## Why

Every Budget in this project is currently a guess. The verbatim tail is eight Turns because eight seemed reasonable; recall is four because four seemed reasonable; the Floor was measured once, by hand, in a throwaway probe. Recall now puts content into packs that nobody has looked at, and the open question from `thread-store-recall` — whether embedding whole Turns is too coarse — cannot be answered by reading code.

This slice makes a Context Pack something you can look at. Not a new Store: an instrument for the ones that exist.

## What Changes

- Show the pack a Call was built from, itemised by part, each against its Budget, with the Floor beside it so the ratio is visible rather than inferred.
- Show what a part actually contributed — which Turns were recalled, which were carried verbatim — so an unhelpful recollection is identifiable rather than merely suspected.
- Diff two packs: what entered, what left, what moved.
- Change a Budget and see the effect on the next Call without restarting the session.
- Summarise a whole Conversation's accounting, which is where the pack-versus-Floor question finally gets a number from real use.

**Not in scope:** changing any Budget's default. This slice produces the evidence; acting on it is a later decision, made with the evidence in hand.

## Capabilities

### New Capabilities

- `pack-inspection`: Examining what a Context Window was made of — per part, against Budget, beside the Floor — and comparing one Call's pack with another's.

### Modified Capabilities

- `pack-accounting`: accounting gains the detail an inspector needs. Today a Call records which parts contributed and how much, but not *what* they contributed, so a recalled Turn cannot be identified after the fact. The attribution requirement is restated to carry the identity of what each part contributed.

## Impact

- **Changed:** what accounting records per part — the Turns a part contributed, not only its size. One forward migration; existing rows stay readable with the detail absent.
- **New:** a way to read it back. A slash command in the harness is the natural surface, since the inspector's whole point is looking at the session you are in.
- **Revised slicing:** this was originally blocked by `graph-store` and `doc-store-recall`, on the assumption that an inspector must show all four Stores. That was wrong: an inspector shows the parts a pack has. Parts added by later slices appear automatically because the inspector reads the pack rather than enumerating Stores — and building it now is what tells us whether recall is working before more Stores are built on top of it.
- **Blocks:** nothing. It unblocks judgement.
