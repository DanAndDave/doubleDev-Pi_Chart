## ADDED Requirements

### Requirement: The last call's pack is shown on the status line

Where the harness offers a status line, the system SHALL show there a pack gauge for the most recent Call of the current Conversation: the Pack's estimated size, the ceiling in force, the size as a share of the ceiling, and a bar drawn from that share. The size SHALL be the same estimate `/pack` reports for that Call.

The gauge SHALL carry at most one state mark, chosen in this order: over the ceiling, where the Pack went out larger than the ceiling; reduced, with the size before reduction, where the ceiling reduced the Pack and it then fitted; near the ceiling, where the Pack exceeded the configured share of the ceiling. A Pack that fitted without reduction and stayed within the share SHALL carry no mark. Where no ceiling is in force, the gauge SHALL show the size alone.

The gauge SHALL be correct after every change that can alter which Call it describes. Every assembled Call SHALL update it. A Call that went out unassembled SHALL replace it with a gauge saying the pack was not assembled, so it never describes a Pack that did not go out. Switching or branching the session SHALL clear it until the next Call of the Conversation is assembled. Showing the gauge SHALL NOT alter the Pack, delay the Call, or fail the Turn.

#### Scenario: A pack that fits shows its size against the ceiling

- **WHEN** a Call's Pack fits its ceiling without reduction and stays within the configured share
- **THEN** the gauge SHALL show the Pack size, the ceiling and the share, with no state mark

#### Scenario: A reduced pack says what it was reduced from

- **WHEN** the ceiling reduced a Call's Pack and it then fitted
- **THEN** the gauge SHALL mark it reduced and give its size before reduction

#### Scenario: Over the ceiling outranks every other mark

- **WHEN** a Call's Pack was reduced and still went out over the ceiling
- **THEN** the gauge SHALL mark it over the ceiling and carry no other mark

#### Scenario: The gauge follows each call

- **WHEN** one Call's Pack goes out over the ceiling and the next Call's Pack fits within the share
- **THEN** after the second Call the gauge SHALL show the second Pack with no state mark

#### Scenario: An unassembled call does not leave a stale gauge

- **WHEN** a Call goes out unassembled after an earlier Call was assembled
- **THEN** the gauge SHALL say the pack was not assembled, not show the earlier Pack

#### Scenario: A switch clears the gauge

- **WHEN** the session switches to another Conversation
- **THEN** no gauge SHALL be shown until that Conversation's next Call is assembled

#### Scenario: Without a status line the pack is still readable

- **WHEN** the harness offers no status line
- **THEN** `/pack` SHALL still report the last Call's pack, and the Turn SHALL complete normally

### Requirement: The last call's parts can be shown beside the editor

`/pack show` SHALL open a widget beside the editor that itemises the most recent Call's Context Pack. It SHALL hold a line with the Pack's size, the ceiling and the same state mark as the pack gauge, and then one line per part in the order `/pack` lists them. Each part line SHALL give the part's source, a bar for its size against the larger of the ceiling and the Pack size, its estimated size, whether it was sent in the system prompt, and why it carried less than it could have, in the same words `/pack` uses for that Call. A part that contributed nothing SHALL show the reason, as `/pack` does.

While open, the widget SHALL be refreshed on every Call and follow the gauge's rules: it says the pack was not assembled after an unassembled Call, and says no Call has been assembled yet in a Conversation that has none. `/pack hide` SHALL remove it. The widget SHALL be closed when a session starts and SHALL stay closed until `/pack show`. Whether it is open SHALL be held in memory only, never persisted. Showing it SHALL NOT alter the Pack, delay the Call, or fail the Turn.

#### Scenario: The widget is closed by default

- **WHEN** a session starts and Calls are assembled without `/pack show`
- **THEN** no widget SHALL be shown

#### Scenario: The parts of the last call are itemised

- **WHEN** `/pack show` is run after a Call whose pack carried Pins, the Opening, a verbatim tail reduced by the ceiling and a current Turn
- **THEN** the widget SHALL list each of those parts with its size and bar
- **AND** the Pins and the Opening SHALL be marked as sent in the system prompt
- **AND** the tail's line SHALL say how many Turns the pack ceiling took, in the words `/pack` uses

#### Scenario: The widget follows each call

- **WHEN** the widget is open and a further Call is assembled
- **THEN** the widget SHALL show that Call's pack

#### Scenario: Hiding removes the widget

- **WHEN** `/pack hide` is run while the widget is open
- **THEN** the widget SHALL be removed and SHALL NOT reappear on later Calls until `/pack show`

#### Scenario: Showing before any call says so

- **WHEN** `/pack show` is run in a Conversation with no assembled Call
- **THEN** the widget SHALL say no Call has been assembled yet

#### Scenario: A harness without widgets says so

- **WHEN** `/pack show` is run where the harness offers no widget
- **THEN** the command SHALL answer that this harness cannot show it and name `/pack` as the way to read the pack
