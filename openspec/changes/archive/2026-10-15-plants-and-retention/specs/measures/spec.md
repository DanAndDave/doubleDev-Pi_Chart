## MODIFIED Requirements

### Requirement: Retention per Plant

For each Probe Turn a Run completed, each Plant that Turn probes SHALL be scored right or wrong according to its kind:
- **literal**: right when the final assistant reply of that Turn in the main Journal contains the Plant's value exactly.
- **superseded**: right when that reply contains the value and does not contain the earlier value. A wrong score whose reply contains the earlier value SHALL be marked stale.
- **constraint**: right when the arguments of a tool call the main agent made in that Turn contain the value. The reply SHALL NOT count.

When the Probe forbids tools and its Turn made a tool call, each of its scores SHALL be marked as a breach and still count. An Arm's Retention for a Probe SHALL be the share of its complete Runs that scored that Plant right at that Probe Turn.

#### Scenario: Each Plant of a Probe is scored separately

- **WHEN** a Probe asks for two Plants and the Turn's final reply contains the first Plant's value and not the second's
- **THEN** the first Plant SHALL be scored right and the second wrong

#### Scenario: A Probe that was never reached is not scored

- **WHEN** a Run failed before its Probe Turn
- **THEN** the Run SHALL contribute no score to any Plant that Probe asks for

#### Scenario: Giving the superseded value is wrong and stale

- **WHEN** a superseded Plant's earlier value is `PORT-3304`, its value is `PORT-8817`, and the Probe's final reply says `PORT-3304`
- **THEN** that Plant SHALL be scored wrong and marked stale

#### Scenario: Naming both values is wrong

- **WHEN** a Probe's final reply for that superseded Plant contains both `PORT-8817` and `PORT-3304`
- **THEN** that Plant SHALL be scored wrong and marked stale

#### Scenario: A constraint is scored by what the agent did

- **WHEN** a constraint Plant's value is `owner: QUILL-9`, the Probe Turn writes a file whose content contains `owner: QUILL-9`, and the reply does not mention it
- **THEN** that Plant SHALL be scored right

#### Scenario: A tools-forbidden Probe that used a tool is a breach

- **WHEN** a Probe that forbids tools made a `read` call in its Turn and its reply contains the Plant's value
- **THEN** that Plant SHALL be scored right and marked as a breach

## ADDED Requirements

### Requirement: Where a Plant sat when its Probe ran

For each score, the Measures SHALL give the Plant's Turn, its distance and its position.

- **Plant's Turn**: the first Turn of the main Journal whose prompt or tool result contains the Plant's value. When no Turn before the Probe's has one, the Plant SHALL be unplanted and have no distance.
- **Distance**: the Probe's Turn less the Plant's Turn.
- **Position**: taken from the window of the first Call of the Probe Turn, as the first of these that holds:
  - **Opening**: the Plant entered in the prompt of the Turn whose prompt the Opening carried.
  - **Pin**: a Pin the window carried contains the value.
  - **tail**: the message in which the Plant entered is one the tail carried.
  - **summary**: the window carried a summary that contains the value.
  - **evicted**: none of the above.

The position SHALL be unknown, rather than tail or evicted, when that window is unknown, or when the message in which the Plant entered sits in a tail marked partial. An unplanted Plant's position SHALL be unplanted.

#### Scenario: A Plant carried by the Opening

- **WHEN** a pi-chart Run's Plant entered in Turn 0's prompt, and the Probe at Turn 39 was sent with the Opening of Turn 0 and a tail of Turns 31 to 38
- **THEN** that score's Plant Turn SHALL be 0, its distance 39 and its position Opening

#### Scenario: An evicted Plant

- **WHEN** a pi-chart Run's Plant entered in Turn 2's prompt, and the Probe at Turn 39 was sent with the Opening of Turn 0 and a tail of Turns 31 to 38
- **THEN** that score's distance SHALL be 37 and its position evicted

#### Scenario: A Plant read from a file enters at the read

- **WHEN** a Plant placed in a tool result first appears in a `read` result at Turn 6, and its Probe is at Turn 10 with a tail of Turns 3 to 9
- **THEN** that score's Plant Turn SHALL be 6, its distance 4 and its position tail

#### Scenario: A file never read leaves the Plant unplanted

- **WHEN** no prompt or tool result before the Probe Turn contains a tool-result Plant's value
- **THEN** that score SHALL be unplanted, with no distance

#### Scenario: A plain-omp summary that kept the Plant

- **WHEN** a plain-omp Plant entered at Turn 2, a compaction kept everything from Turn 6 with a summary containing the value, and the Probe is at Turn 9
- **THEN** that score's position SHALL be summary

#### Scenario: An unknown window gives an unknown position

- **WHEN** a pi-chart Probe's first Call has no Accounting
- **THEN** that score's position SHALL be unknown

### Requirement: Each answer has a source

Each score SHALL have a source, the first of these that holds the Plant's value:
1. **A window part** of the first Call of the Probe Turn:
   - the Opening, meaning the prompt of the Turn it carried;
   - a Pin the window carried;
   - the tail, meaning any message of a Turn it carried, counted from the first message it carried;
   - the summary the window carried.
2. **A Pull result** received in the Probe Turn before the scored message.
3. **Any other tool result** received in the Probe Turn before the scored message.
4. **None.**

The scored message SHALL be the final reply, or, for a right constraint, the first tool call whose arguments contain the value.

The source SHALL be unknown, ending the search, when the window is unknown, or when the tail holds the value and is marked partial while neither the Opening nor a Pin holds it.

Each score SHALL then be classed:
- **Leak**: right with source none.
- **Wrong despite a source**: wrong with a source other than none or unknown.
- **Failed-Probe Lapse**: wrong with source none and position evicted.
- **Failed Probe unknown**: wrong and not unplanted, with source unknown, or with source none and position unknown.
- **Unplanted**: wrong and unplanted. This SHALL be neither a Lapse nor unknown.

#### Scenario: An answer from the Opening

- **WHEN** a Plant carried by the Opening is answered right with no tool call
- **THEN** its source SHALL be the Opening and it SHALL be no leak

#### Scenario: An answer recovered by a recall Pull

- **WHEN** an evicted Plant's Probe Turn calls `recall_earlier_turns`, the result contains the value, and the final reply is right
- **THEN** its source SHALL be a Pull, naming `recall_earlier_turns`, and it SHALL be no Lapse

#### Scenario: An answer from re-reading the file

- **WHEN** an evicted tool-result Plant's Probe Turn reads the file again, a `read` result contains the value, and the reply is right
- **THEN** its source SHALL be a tool result

#### Scenario: A right answer with nothing behind it is a leak

- **WHEN** a Plant is answered right, no window part of the Probe's first Call holds the value, and no tool result of the Probe Turn holds it
- **THEN** its source SHALL be none and it SHALL be classed as a leak

#### Scenario: A wrong answer with the value in the tail is no Lapse

- **WHEN** the tail of the Probe's first Call holds the Plant's value and the final reply does not
- **THEN** its source SHALL be the tail and it SHALL be classed wrong despite a source, not as a Lapse

#### Scenario: An evicted Plant answered wrong is a Lapse

- **WHEN** an evicted Plant's Probe Turn has no result holding its value and the final reply is wrong
- **THEN** it SHALL be classed as a failed-Probe Lapse at the score's distance

#### Scenario: A value repeated in a later Turn is held by the tail

- **WHEN** the Plant entered at Turn 2, the agent's reply at Turn 35 repeats its value, the Probe at Turn 39 has a tail of Turns 31 to 38, and the final reply is right
- **THEN** its position SHALL be evicted and its source the tail, and it SHALL be no leak

### Requirement: Failed Probes per Run by distance band

A failed-Probe Lapse SHALL be a Lapse that was not recovered. For each Run, on both Arms, the Measures SHALL count failed-Probe Lapses and failed Probes unknown, each in total and in the five distance bands Re-fetches use. These counts SHALL be reported beside Re-fetch Lapses and recall Pulls and never added to them. A Run with no such score SHALL count zero in every band, not be absent.

#### Scenario: Failed Probes are banded

- **WHEN** a Run's failed-Probe Lapses fall at distances 9 and 37
- **THEN** its failed-Probe Lapses SHALL be 1 in 8–12 and 1 in 25 or more, with a total of 2

#### Scenario: A Run whose Probes all pass counts zero

- **WHEN** every score of a complete Run is right
- **THEN** its failed-Probe Lapses and failed Probes unknown SHALL be zero in every band

### Requirement: Retention is reported by Probe, distance and position

A report over several Runs SHALL give, per Arm over complete Runs:
- Retention for each Probe, naming the Plant, its kind, the Probe's Turn and whether it forbids tools;
- Retention by the distance band of each score, and by position;
- for each source, the number of right and wrong scores;
- the number of leaks, of wrong scores despite a source, of stale scores and of breaches.

Scores with no distance SHALL be counted under unplanted, not in a band. The band table SHALL give failed-Probe Lapses and failed Probes unknown on both Arms. Where both Arms are present, the report SHALL state that failed Probes are Lapses neither Arm recovered.

#### Scenario: Retention by position across Runs

- **WHEN** an Arm has three complete Runs whose build Plant sat in the tail and was right in one, and was evicted and wrong in two
- **THEN** that Arm's Retention by position SHALL be 1/1 in tail and 0/2 evicted

#### Scenario: Leaks are counted in the report

- **WHEN** one complete pi-chart Run has a score classed as a leak
- **THEN** the report SHALL give pi-chart one leak
