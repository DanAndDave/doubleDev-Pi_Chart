# Proposal: Make Levels reachable from a session

Triage: ready-for-agent

## Why

`CONTEXT.md` defines a Level as "the unit of progressive disclosure: read a Level, decide what to open". `DocStore.list()` implements exactly that and is genuinely lazy, but nothing in a session can reach it: the only production construction of a `DocStore` calls `ensureIdentities()` and `concepts()`, and no command or tool exposes a listing.

So the vocabulary promises an agent something it cannot do. Either the capability becomes reachable or the word stops claiming it.

## What to build

An agent can walk a bundle by Level — read a listing, decide what to open — rather than receiving only what retrieval chose for it. Retrieval answers "what is relevant to this prompt"; walking answers "what is there", which is a different question and the one a Level exists for.

## Acceptance criteria

- [ ] An agent can list a Level and see what it contains without loading every Concept
- [ ] An agent can open one named Concept from a listing
- [ ] Walking costs no Context Pack Budget: it is a tool the agent chooses to call
- [ ] A bundle with no listings behaves as an empty walk, not an error

## Non-goals

Changing Concept retrieval, its threshold, or the Doc Store Budget.
