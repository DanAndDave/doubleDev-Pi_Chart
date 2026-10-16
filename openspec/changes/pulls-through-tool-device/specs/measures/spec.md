## ADDED Requirements

### Requirement: A call through the tool device is a call to the tool it ran

omp's tool device runs a tool when the agent writes that tool's arguments to `xd://<tool>`. The Journal then records the result under the tool name `write`. Its details name the tool the device ran, and they hold that tool's own details. Wherever the Measures recognise a tool call by its tool, a result the device produced in execute mode SHALL count as a result of the tool it ran, carrying that tool's own details. This covers Pull counts and their tokens, the `write_documentation` count, recall Pulls and their distances, a Plant score's Pull source, a Revisit score's Pull and the tool a Re-fetch names.

A device result marked as an error SHALL count as a call to the tool the device named, as a failed direct call does. Reading a tool's documentation, whether by reading `xd://<tool>` or through the device's help mode, SHALL NOT be a call to that tool. A device result that names no tool SHALL remain a result of the tool name the Journal recorded.

#### Scenario: A recall through the device is a recall Pull

- **WHEN** a Call at Turn 9 writes to `xd://recall_earlier_turns`, and the device's result holds Turns 2 and 5
- **THEN** the Run SHALL count 1 `recall_earlier_turns` Pull with the tokens of that result, and that Pull SHALL be a recall Pull at distance 4

#### Scenario: A failed device call still counts

- **WHEN** a pi-chart Run writes to `xd://recall_earlier_turns` and the device reports an error
- **THEN** that call SHALL count as 1 `recall_earlier_turns` Pull and SHALL NOT be a recall Pull

#### Scenario: A write to the bundle through the device is counted apart

- **WHEN** a pi-chart Run writes to `xd://write_documentation` once
- **THEN** its `write_documentation` count SHALL be 1, and no Pull count SHALL include that call

#### Scenario: A Re-fetch through the device names the tool it ran

- **WHEN** a pi-chart Run's device call to `xd://search_documentation` at Turn 8 returns the text a direct `search_documentation` call returned at Turn 5
- **THEN** that result SHALL be a Re-fetch at distance 3 naming `search_documentation`

#### Scenario: Reading a tool's documentation is not a Pull

- **WHEN** a pi-chart Run reads `xd://recall_earlier_turns`, or asks the device for that tool's help
- **THEN** no Pull count SHALL include that call

#### Scenario: A Plant answered from a device recall has a Pull source

- **WHEN** an evicted Plant's Probe Turn writes to `xd://recall_earlier_turns`, the result contains the Plant's value, and the final reply is right
- **THEN** the score's source SHALL be a Pull naming `recall_earlier_turns`, and the score SHALL NOT be a Lapse

#### Scenario: A Revisit recovered through a device recall names the Pull

- **WHEN** a pi-chart Run read the Revisit's file at Turn 1, and the Revisit's step at Turn 9 writes to `xd://recall_earlier_turns`, whose result holds Turn 1, without fetching the file again
- **THEN** the Revisit score SHALL be unfetched, position evicted, with the Pull `recall_earlier_turns`
