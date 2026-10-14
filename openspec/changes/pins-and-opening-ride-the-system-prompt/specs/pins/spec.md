## MODIFIED Requirements

### Requirement: A user removes pins by command

The system SHALL let a user remove one Pin by its id, or every Pin at once. A removed Pin SHALL NOT be carried by any Turn that starts afterwards. A Turn already in progress SHALL keep sending the system prompt it started with until it ends, removed Pin included, because changing the system prompt mid-Turn would invalidate the model's thinking and the cache. An id the Conversation does not hold SHALL be refused, naming the ids it does hold, and SHALL remove nothing.

#### Scenario: One pin is removed

- **WHEN** a user runs `/pins rm` with the id of a Pin
- **THEN** that Pin SHALL be removed and every other Pin SHALL remain

#### Scenario: All pins are removed

- **WHEN** a user runs `/pins rm all`
- **THEN** the Conversation SHALL hold no Pins

#### Scenario: A pin removed mid-Turn leaves at the next Turn

- **WHEN** a user removes a Pin while a Turn is in progress
- **THEN** the remaining Calls of that Turn SHALL still carry it, and no Turn that starts afterwards SHALL

#### Scenario: An unknown id is refused

- **WHEN** a user runs `/pins rm` with an id the Conversation does not hold
- **THEN** the request SHALL be refused naming the ids held, and no Pin SHALL be removed

### Requirement: A conversation's pins are always visible

While a Conversation holds Pins and the harness offers a status line, the system SHALL show there that it does, with their count and total estimated size. The status SHALL be correct after every change that can alter the Pins held: starting or resuming a Conversation, forking or branching it, moving within its tree, adding a Pin and removing one. When the most recent Call carried no Pins, the status SHALL say they were not sent: because the Call went out unassembled, because its Turn's system-prompt additions failed or the harness never offered the system prompt, or because the Turn started before any Pin was held. A Conversation holding no Pins SHALL show no Pin status.

#### Scenario: Pins show in the status line

- **WHEN** a Conversation holds two Pins
- **THEN** the status line SHALL show that two Pins are held, with their total size

#### Scenario: The status follows a switch

- **WHEN** the user switches from a Conversation holding Pins to a new one
- **THEN** the Pin status SHALL be removed

#### Scenario: Unsent pins are shown as unsent

- **WHEN** a Call goes out unassembled while the Conversation holds Pins
- **THEN** the status SHALL state that the Pins were not sent, until an assembled Call carries them again

#### Scenario: Pins without a system prompt are shown as unsent

- **WHEN** a Call is assembled in a Turn whose system-prompt additions failed or were never offered a place, while the Conversation holds Pins
- **THEN** the status SHALL state that the Pins were not sent

#### Scenario: Without a status line the pins are still readable

- **WHEN** the harness offers no status line
- **THEN** `/pins` SHALL still report the Conversation's Pins
