## 1. The stop

- [x] 1.1 Add the red case to `test/process.test.ts`: a command whose child outlives it on every shell (`sh -c "echo working; sleep 30 & wait"`, the child's pid written to a file and `exec`-free so it is a separate process), asserting that the call returns at its deadline with `working` in the output, and that neither the shell nor its child is in the process table afterwards. Verify it fails against the current `runProcess` by timing out on the pipes
  - Red (Ubuntu 24.04, Bun 1.4.2): the new case times out at 5,000 ms against its 200 ms deadline, as does the existing "a command that outlives its deadline is stopped and says so" — 4 pass, 2 fail, the file taking 10.2 s.
- [x] 1.2 Spawn with `detached: true` in `src/process.ts` and signal the group — `process.kill(-pid, "SIGTERM")`, then `SIGKILL` after `GRACE_MS` — each wrapped so an already-gone group is not an error. Verify with `bun test test/process.test.ts`: the new case and the four existing ones pass, including "a stopped command leaves no process behind" and the one that was timing out on Ubuntu
  - Green: 6 pass, 0 fail, the file taking 612 ms. Measured first with a throwaway probe: `Bun.spawn({ detached: true })` gives the child a group of its own (`pgid` = its pid), and `process.kill(-pid, "SIGTERM")` settled the pipes 1 ms later with `working` kept and no member of the group left.
- [x] 1.3 State in the doc comment what a deadline stops, and why the child runs in its own group. Verify by reading `src/process.ts`

## 2. Close

- [x] 2.1 Run `tsc --noEmit` and the full `bun test`, with `PICHART_DATABASE_URL` set so the store-backed suites run rather than skip
  - `tsc --noEmit` clean. Full suite against a pgvector server: 805 pass, 24 skip, 0 fail, 8.6 s (the 24 skips are the embedding and live-graphify suites, which want `PICHART_EMBED=1` / `PICHART_GRAPHIFY=1`).
  - Smoked against real programs through the seam the Stores use: `docker compose ps` returned `{ok: true, output: "pi-chart-thread-store running"}`, and `sh -c "echo begun; python3 -c 'time.sleep(60)' & wait"` under a 300 ms deadline returned at 301 ms with `it had printed: begun` and left no `python3` behind.
