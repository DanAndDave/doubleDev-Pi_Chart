## MODIFIED Requirements

### Requirement: Recall Lapses per Run by distance band

Each recall Pull SHALL be a recovered Lapse. For each pi-chart Run, the Measures SHALL count recall Pulls and recall Pulls unknown, each in total and in the five distance bands Re-fetches use. A recall Pull unknown with no distance SHALL count in its total and in no band. These counts SHALL be reported beside the Re-fetch Lapses and never added to them, except in the Gate's Lapses per Run, which compares pi-chart with pi-chart. They SHALL read "n/a" for plain omp, which has no recall tool. A report covering both Arms SHALL state that the Arms recover Lapses by different routes, so that zero recall Pulls on plain omp does not read as zero Lapses.

#### Scenario: Recall Pulls are banded

- **WHEN** a pi-chart Run's recall Pulls fall at distances 4 and 9
- **THEN** its recall Pulls SHALL be 1 in 1–5 and 1 in 8–12, with a total of 2, and zero in every other band

#### Scenario: A pi-chart Run with no recall Pull counts zero

- **WHEN** a complete pi-chart Run makes no recall Pull
- **THEN** its recall Pulls and recall Pulls unknown SHALL each be zero in every band, not absent

#### Scenario: Plain omp reads n/a and the routes are named

- **WHEN** a report covers plain-omp and pi-chart Runs
- **THEN** the recall Pull counts SHALL read "n/a" for plain omp
- **AND** the report SHALL state that plain omp recovers Lapses only through Re-fetches, and pi-chart through Re-fetches and recall Pulls

### Requirement: Failed Probes per Run by distance band

A failed-Probe Lapse SHALL be a Lapse that was not recovered. For each Run, on both Arms, the Measures SHALL count failed-Probe Lapses and failed Probes unknown, each in total and in the five distance bands Re-fetches use. These counts SHALL be reported beside Re-fetch Lapses and recall Pulls and never added to them, except in the Gate's Lapses per Run, which compares pi-chart with pi-chart. A Run with no such score SHALL count zero in every band, not be absent.

#### Scenario: Failed Probes are banded

- **WHEN** a Run's failed-Probe Lapses fall at distances 9 and 37
- **THEN** its failed-Probe Lapses SHALL be 1 in 8–12 and 1 in 25 or more, with a total of 2

#### Scenario: A Run whose Probes all pass counts zero

- **WHEN** every score of a complete Run is right
- **THEN** its failed-Probe Lapses and failed Probes unknown SHALL be zero in every band
