## MODIFIED Requirements

### Requirement: The symbols in play are found by name

The Graph Store SHALL find the symbols a prompt refers to by matching the identifiers in it against the names in the graph, without embeddings: a symbol's name is exact, and a structural question has one correct answer.

An identifier is written as code when the text itself marks it as code: a compound name (with an internal capital or an underscore), a leading `.`, a following `(`, or a capital on a name that matches something other than a member. Any other identifier is a plain word. A plain word SHALL count as naming a symbol only when nothing in the text considered is written as code, since a prompt is written in prose and prose contains words that happen to be the names of functions, types and methods alike. Among plain words, one that matches only members' names SHALL count only when no other plain word names a symbol, since ordinary verbs like "read" and "list" are far likelier prose than a reference to a method. A plain word SHALL NOT reach a symbol defined in a test or script file, since a Codebase's tests and scripts reuse the ordinary words of its domain for helpers and fixtures. A test or script file is one with a directory named `test`, `tests`, `__tests__` or `scripts` in its path, or whose name matches `*.test.*`, `*.spec.*`, `*_test.*` or `test_*`. Writing the name as code, or naming the file's path, still reaches it. A plain word naming any other file is unaffected: it still reaches that file's symbols as "The symbols in play are those the Turn is working with" describes.

#### Scenario: A symbol named in the prompt

- **WHEN** a prompt names a symbol the graph knows
- **THEN** that symbol SHALL be among those found

#### Scenario: A prompt about nothing in the Codebase

- **WHEN** a prompt names nothing in the graph
- **THEN** no symbols SHALL be found

#### Scenario: A symbol written in a different style

- **WHEN** a prompt names a symbol using different capitalisation or punctuation than the graph records
- **THEN** the symbol SHALL still be found

#### Scenario: A prose word that happens to name a method

- **WHEN** a prompt names a symbol unambiguously and also contains an ordinary word matching a member's name
- **THEN** the unambiguous symbol SHALL be found and the ordinary word SHALL be disregarded

#### Scenario: A prose word that happens to name a function

- **WHEN** a prompt writes one symbol as code and also contains a plain word matching a function's or a type's name
- **THEN** the symbol written as code SHALL be found and the plain word SHALL be disregarded

#### Scenario: Plain words alone still find symbols

- **WHEN** nothing in the text considered is written as code, and a plain word in it matches a symbol the graph knows
- **THEN** that symbol SHALL be found

#### Scenario: A plain word naming a method gives way to one naming a function

- **WHEN** nothing in the text considered is written as code, and it contains one plain word matching only a member's name and another matching a function's or a type's name
- **THEN** the function or type SHALL be found and the member SHALL NOT

#### Scenario: Two symbols, differently written

- **WHEN** a prompt writes one symbol as a compound and another as a call
- **THEN** both SHALL be found

#### Scenario: A plain word naming only a test helper

- **WHEN** nothing in the text considered is written as code, and a plain word in it matches only a symbol defined in a test or script file
- **THEN** no symbol SHALL be found for it

#### Scenario: A test helper written as code

- **WHEN** a prompt writes as code the name of a symbol defined in a test file
- **THEN** that symbol SHALL be found

#### Scenario: A plain word naming a test helper still sets aside a method

- **WHEN** nothing in the text considered is written as code, and it contains one plain word matching only a member's name and another matching a function defined only in a test file
- **THEN** neither the member nor the test file's function SHALL be found

### Requirement: The symbols in play are those the Turn is working with

The Graph Store SHALL take the symbols in play from the whole current Turn — the prompt, the agent's own text, the arguments of the tools it called, and their results — and not from the prompt's prose alone, so that a Call made deep in a tool loop derives structure from what the Turn is working with rather than from a sentence written many steps earlier. A tool's own name SHALL NOT count as naming a symbol: it names the harness's action, not anything in the Codebase.

A file the Turn names SHALL resolve to the symbols that file defines, so that naming a path is a way of asking about its contents. A path naming nothing the graph knows SHALL yield no symbols rather than a guess.

Symbols SHALL be preferred in this order: those the prompt writes as code; then those of a file whose path the prompt names; then those the rest of the Turn writes as code, or, when nothing in the Turn is written as code, those its plain words name, the prompt's first; then those reached only through a file the rest of the Turn names, or through a plain word naming a file. A plain word naming a file SHALL NOT reach a test or script file, as "The symbols in play are found by name" defines them; a path naming one still does. The text considered SHALL be bounded per message so that a single large tool result cannot displace what the Turn is about. The rule for plain words SHALL apply to the whole of this text, so that a plain word counts only when nothing in the Turn is written as code.

#### Scenario: A tool-loop call whose prompt names nothing

- **WHEN** a Turn's prompt names no symbol but the Turn has read files the graph knows
- **THEN** the symbols those files define SHALL be among those found

#### Scenario: A path in play

- **WHEN** a Turn names a path to a file the graph knows
- **THEN** the symbols that file defines SHALL be found

#### Scenario: A path that matches nothing

- **WHEN** a Turn names a path no symbol in the graph belongs to
- **THEN** no symbols SHALL be found for it

#### Scenario: What the prompt names comes first

- **WHEN** a Turn names one symbol outright and works with a file defining many others
- **THEN** the symbol named outright SHALL be preferred over those reached only through the file

#### Scenario: A file the prompt names comes before the rest of the Turn

- **WHEN** a prompt names the path of a file the graph knows, and a later message of the Turn writes as code a symbol defined elsewhere
- **THEN** the symbols of the file the prompt names SHALL be preferred over that symbol

#### Scenario: A tool's name names nothing

- **WHEN** a Turn calls a tool whose name matches a symbol the graph knows, and neither the prompt, nor the call's arguments, nor its result names that symbol
- **THEN** that symbol SHALL NOT be found

#### Scenario: A tool's arguments still count

- **WHEN** a Turn calls a tool with a path to a file the graph knows
- **THEN** the symbols that file defines SHALL be among those found

#### Scenario: A large tool result cannot take over the turn

- **WHEN** a Turn carries a tool result far larger than the rest of the Turn
- **THEN** the symbols found SHALL still include those the prompt and the tool arguments name

#### Scenario: Prose words are still disregarded

- **WHEN** a Turn's wider text contains plain words matching symbols' names, alongside something written as code
- **THEN** the symbol written as code SHALL be found and the plain words SHALL be disregarded

#### Scenario: A plain word naming a file passes over its tests

- **WHEN** a Turn contains a bare word equal to the name of both a source file and a test file
- **THEN** the source file's symbols SHALL be found and the test file's SHALL NOT

#### Scenario: A path to a test file still counts

- **WHEN** a Turn names the path of a test file the graph knows
- **THEN** the symbols that file defines SHALL be found
