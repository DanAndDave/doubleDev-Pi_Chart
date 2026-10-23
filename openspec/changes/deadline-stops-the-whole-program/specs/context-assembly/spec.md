## MODIFIED Requirements

### Requirement: A store that misses its deadline is treated as unavailable

Every Store call a Call waits on SHALL have a deadline, configurable per Store. A Store that has not answered within its deadline SHALL be treated as unavailable: the Context Pack SHALL be assembled without that Store's part, the omission SHALL be reported, and the Accounting for that Call SHALL show the part absent. A Call SHALL NOT wait on a Store beyond its deadline, so the time a Turn spends assembling is bounded by configuration rather than by the slowest Store. A missed deadline SHALL be reported as such, distinguishably from a Store that refused the connection, because the two call for different remedies.

Where serving a part requires running a program, that program SHALL also be bounded: on passing its deadline it SHALL be stopped, whatever output it produced SHALL be kept, and the condition SHALL be reported. A program that never finishes SHALL NOT leave the part's failure unreported.

Stopping a program SHALL mean stopping the program and every process it started. A deadline SHALL bound the wait whatever the program left running, so a process the program spawned SHALL NOT be able to hold the result past the deadline, and SHALL NOT be left running once the program has been stopped.

#### Scenario: A silent store costs its part, not the turn

- **WHEN** a Store accepts the request and does not answer within its deadline
- **THEN** the Pack SHALL be assembled without that Store's part and the Turn SHALL proceed

#### Scenario: A missed deadline is visible

- **WHEN** a Store misses its deadline
- **THEN** the omission SHALL be reported as a missed deadline, and the Accounting for that Call SHALL show the part absent

#### Scenario: One slow store does not cost the others

- **WHEN** one of several Stores consulted for a Call misses its deadline
- **THEN** the parts served by the other Stores SHALL still be carried

#### Scenario: The verbatim tail has its own deadline

- **WHEN** the Store serving the verbatim tail does not answer within its deadline
- **THEN** the tail SHALL fall back to the history the harness itself provides, and the fallback SHALL be recorded as it is for an unreachable Store

#### Scenario: A deadline nothing exceeds changes nothing

- **WHEN** every Store answers within its deadline
- **THEN** the Pack SHALL be exactly what it would have been without deadlines

#### Scenario: Deadlines are configurable per store

- **WHEN** a Store's deadline is changed
- **THEN** subsequent Calls SHALL bound that Store by the new deadline and SHALL leave the other Stores' deadlines untouched

#### Scenario: A program that hangs is stopped and reported

- **WHEN** a program run to serve a part has not finished by its deadline
- **THEN** it SHALL be stopped, the part SHALL be omitted, and the failure SHALL be reported with whatever output the program had produced

#### Scenario: A stopped program takes its children with it

- **WHEN** a program is stopped at its deadline having started a process of its own
- **THEN** that process SHALL be stopped with it, and no process started by the program SHALL remain running once the stop has been reported

#### Scenario: A child outliving its parent cannot outlast the deadline

- **WHEN** a program stopped at its deadline left a process holding the output it was writing to
- **THEN** the failure SHALL still be reported at the deadline, with the output the program had produced, rather than when that process ends

#### Scenario: Assembly time is bounded by the deadlines

- **WHEN** every Store consulted for a Call fails to answer
- **THEN** the Pack SHALL still be supplied, and the Call SHALL have waited no longer than the largest configured deadline
