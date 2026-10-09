# pins Specification

## Purpose

Lets a user place text of their own into a Conversation so that every Context Pack carries it, whole, until they remove it — and always lets them see that they have.

## Requirements

### Requirement: A user pins text by command

The system SHALL let a user add a Pin to the current Conversation by command, either with the text given inline or, when no text is given, by writing it in the harness's editor. A Pin SHALL be the user's text exactly as written. Only the user SHALL add a Pin: the agent SHALL have no tool that adds, removes or alters one. Each Pin SHALL receive an id that is never reused within the Conversation, so that a removed Pin and a later one are never taken for each other. The commands SHALL NOT take a name the harness already uses for its own command, so that neither shadows the other.

The Conversation's Pins together SHALL be bounded by their Budget, in count and in estimated tokens. A Pin that would take them over either SHALL be refused when it is written, stating the Budget, what the Pins already spend, and by how much the new Pin exceeds it; nothing SHALL be recorded.

#### Scenario: Inline text is pinned

- **WHEN** a user runs `/pins add` followed by text
- **THEN** that text SHALL become a Pin of the current Conversation, and the user SHALL be told its id and size

#### Scenario: A pin is written in the editor

- **WHEN** a user runs `/pins add` with no text and the harness offers an editor
- **THEN** the editor SHALL open, and the text submitted SHALL become a Pin

#### Scenario: Nothing to pin is refused

- **WHEN** the text given or submitted is empty or only whitespace, or the editor is cancelled, or no text is given and the harness offers no editor
- **THEN** no Pin SHALL be recorded, and where nothing was submitted the user SHALL be told how to pin text inline

#### Scenario: A pin over its budget is refused

- **WHEN** a Pin would take the Conversation's Pins over their count or token Budget
- **THEN** it SHALL be refused naming the Budget and the excess, and the Pins SHALL be unchanged

#### Scenario: Ids are not reused

- **WHEN** the newest Pin is removed and another is added
- **THEN** the new Pin SHALL receive an id the removed one never had

### Requirement: A user removes pins by command

The system SHALL let a user remove one Pin by its id, or every Pin at once. A removed Pin SHALL NOT be carried by any Context Pack assembled afterwards. An id the Conversation does not hold SHALL be refused, naming the ids it does hold, and SHALL remove nothing.

#### Scenario: One pin is removed

- **WHEN** a user runs `/pins rm` with the id of a Pin
- **THEN** that Pin SHALL be removed and every other Pin SHALL remain

#### Scenario: All pins are removed

- **WHEN** a user runs `/pins rm all`
- **THEN** the Conversation SHALL hold no Pins

#### Scenario: An unknown id is refused

- **WHEN** a user runs `/pins rm` with an id the Conversation does not hold
- **THEN** the request SHALL be refused naming the ids held, and no Pin SHALL be removed

### Requirement: A user can read the pins back

The system SHALL print, on request, each Pin of the current Conversation in full, with its id and estimated size, and their total against the Pin Budget. A Conversation with no Pins SHALL be reported as having none.

#### Scenario: Pins are listed in full

- **WHEN** a user runs `/pins` in a Conversation holding Pins
- **THEN** every Pin SHALL be printed whole, in the order it was added, with its id and size, followed by the total against the Budget

#### Scenario: No pins says so

- **WHEN** a user runs `/pins` in a Conversation holding none
- **THEN** the system SHALL say the Conversation has no Pins

### Requirement: Pins last as long as the Conversation

A Pin SHALL belong to the Conversation it was added in, and SHALL remain until the user removes it, whatever happens to the Conversation's history: resuming it, moving within its tree, compacting it, or the harness moving it to a new file. A Conversation forked or branched from another SHALL begin with the Pins its parent held at that moment, and from then on the two SHALL hold their Pins independently. A new Conversation, and any Conversation not descended from this one, SHALL hold none of this Conversation's Pins. Pins SHALL be recorded in the Conversation's Journal and need no Store to persist.

#### Scenario: A resumed conversation keeps its pins

- **WHEN** a Conversation holding Pins is closed and resumed
- **THEN** it SHALL hold the same Pins

#### Scenario: Moving back in the tree keeps a later pin

- **WHEN** a Pin is added and the user then moves the Conversation's leaf to an entry written before the Pin was
- **THEN** the Conversation SHALL still hold that Pin

#### Scenario: A fork inherits its parent's pins

- **WHEN** a Conversation holding Pins is forked or branched into a new Conversation
- **THEN** the new Conversation SHALL hold the same Pins, with the same ids

#### Scenario: A fork's pins are its own

- **WHEN** a Pin is removed in a forked Conversation
- **THEN** the Conversation it was forked from SHALL still hold that Pin

#### Scenario: A new conversation starts without pins

- **WHEN** a user starts a new Conversation, or resumes one not descended from a Conversation holding Pins
- **THEN** that Conversation SHALL hold no Pins

#### Scenario: Pins need no thread store

- **WHEN** the Thread Store is not configured or unreachable
- **THEN** Pins SHALL still be added, removed, listed, persisted and carried

### Requirement: A conversation's pins are always visible

While a Conversation holds Pins and the harness offers a status line, the system SHALL show there that it does, with their count and total estimated size. The status SHALL be correct after every change that can alter the Pins held: starting or resuming a Conversation, forking or branching it, moving within its tree, adding a Pin and removing one. When the most recent Call went out unassembled, and so carried no Pins, the status SHALL say they were not sent. A Conversation holding no Pins SHALL show no Pin status.

#### Scenario: Pins show in the status line

- **WHEN** a Conversation holds two Pins
- **THEN** the status line SHALL show that two Pins are held, with their total size

#### Scenario: The status follows a switch

- **WHEN** the user switches from a Conversation holding Pins to a new one
- **THEN** the Pin status SHALL be removed

#### Scenario: Unsent pins are shown as unsent

- **WHEN** a Call goes out unassembled while the Conversation holds Pins
- **THEN** the status SHALL state that the Pins were not sent, until an assembled Call carries them again

#### Scenario: Without a status line the pins are still readable

- **WHEN** the harness offers no status line
- **THEN** `/pins` SHALL still report the Conversation's Pins
