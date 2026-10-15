## ADDED Requirements

### Requirement: Revisits are scored by whether the agent fetched the file again

For each Revisit whose step's Turns the Run all completed, the Measures SHALL give one Revisit score, computed the same way on both Arms from the main Journal. A tool result SHALL concern the Revisit's file when it is not marked as an error and answers a main-agent tool call one of whose argument strings contains the file's path. Its text SHALL NOT matter, so a read of part of the file concerns it, and a search that never names the file does not.

The score SHALL give:
- **the earlier read**: the most recent result concerning the file received before the step's first Turn, and its Turn;
- **the distance**: the step's first Turn less the earlier read's Turn;
- **the fetch**: the first result concerning the file received during the step's Turns, and its Turn;
- **the position**: where the earlier read sat in the window of the first Call of the step's first Turn: **tail** when the tail carried it; **summary** when it did not, and the window's summary came from a compaction that kept only what followed it; **evicted** otherwise; **unknown** when that window is unknown, or the tail is marked partial and carried the read's Turn;
- **the Pull**: the Pull tool, when a recall Pull made during the step's Turns held the earlier read's Turn;
- **the step's outcome**: Pass, Fail or not graded, as the Run recorded it.

The score's class SHALL be the first that applies:
1. **unread**: no result concerning the file came before the step;
2. **edited**: the record names a Turn at or before the step's last Turn after which the file no longer matched `overlay/`;
3. **held**, **left** or **unknown**, when the step fetched the file: classified from the window of the Call that made the fetch, as a Re-fetch is against its earlier result;
4. **unfetched**: the step never fetched the file, so it answered from its window or from a Pull.

A score that is unread SHALL have no distance and the position unread. A Revisit classified left SHALL be a recovered Lapse. It SHALL be reported apart from Re-fetch Lapses, recall Pulls and failed-Probe Lapses and never added to them, since the same fetch can also be a Re-fetch.

#### Scenario: A file fetched after it left the window

- **WHEN** a pi-chart Run read `notes/scale.md` at Turn 1, the Revisit's step is Turn 6, that Turn's first Call carried only Turns 4 and 5 in its tail, and that Call read `notes/scale.md` again, and the step's check passed
- **THEN** the Revisit score SHALL be left, at distance 5, position evicted, fetched at Turn 6, Pass

#### Scenario: A file fetched while the window still held it

- **WHEN** a plain-omp Run that never compacted read the file at Turn 1 and read it again in the Revisit's step at Turn 3
- **THEN** the Revisit score SHALL be held, at distance 2, position tail

#### Scenario: A ranged read is a fetch

- **WHEN** the Revisit's step reads lines 1 to 3 of the file, whose text differs from the earlier whole-file read
- **THEN** that read SHALL be the Revisit's fetch

#### Scenario: A search that never names the file is not a fetch

- **WHEN** the Revisit's step's only tool call is a search over the whole workspace that returns a line of the file
- **THEN** the Revisit score SHALL be unfetched

#### Scenario: A file answered from the window

- **WHEN** the Revisit's step makes no tool call concerning the file and its check fails
- **THEN** the Revisit score SHALL be unfetched, with the step's outcome Fail

#### Scenario: A file read before a compaction's cut sits in the summary

- **WHEN** a plain-omp Run read the file at Turn 2, a compaction later kept everything from Turn 5, and the Revisit's step at Turn 8 does not fetch it
- **THEN** the Revisit score SHALL be unfetched with position summary

#### Scenario: A file recovered by recall

- **WHEN** a pi-chart Run read the file at Turn 1, and the Revisit's step at Turn 9 makes a `recall_earlier_turns` call whose result holds Turn 1 and never fetches the file
- **THEN** the Revisit score SHALL be unfetched, position evicted, with the Pull `recall_earlier_turns`

#### Scenario: An edited file is excluded

- **WHEN** the record names Turn 2 as the first after which the Revisit's file no longer matched `overlay/`, and the Revisit's step is Turn 4
- **THEN** the Revisit score SHALL be edited, and SHALL count neither as held, left nor unfetched

#### Scenario: A file never read before the step

- **WHEN** no result concerning the file came before the Revisit's step
- **THEN** the Revisit score SHALL be unread, with no distance

#### Scenario: A step the Run never finished is not scored

- **WHEN** a Run failed during the Revisit's step
- **THEN** the Measures SHALL give no score for that Revisit

#### Scenario: A record with no Revisits

- **WHEN** a Run's record declares no Revisits, or was written before Revisits existed
- **THEN** the Measures SHALL give no Revisit score

### Requirement: Revisits are reported by class and position

A report over several Runs SHALL give, per Arm over complete Runs:
- for each Revisit, naming its file and step, the number of scores in each class;
- for each class, the Passes over the scores of that class that were graded;
- for each position, the Passes over the scores at that position that were graded.

A row SHALL appear only where some Arm has a score. The report SHALL state that left Revisits are recovered Lapses, reported apart from every other Lapse count. A report over Runs recorded before Revisits were scored SHALL show those cells as having no figure, not as zero.

#### Scenario: Direct answers and fetches are both scored by the check

- **WHEN** three complete pi-chart Runs score one Revisit left and Pass, unfetched and Pass, and unfetched and Fail
- **THEN** the report SHALL give pi-chart left 1/1 and unfetched 1/2 Passes, and one score each of left and two of unfetched for that Revisit

#### Scenario: An incomplete Run is left out of the Revisit tables

- **WHEN** a Run failed after the Revisit's step had completed
- **THEN** its Revisit score SHALL NOT count in the report
