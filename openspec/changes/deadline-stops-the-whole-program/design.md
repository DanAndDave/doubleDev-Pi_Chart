## Context

`runProcess` is the single place this project runs a program (`src/graph-store.ts`, `src/spec-store.ts`, `src/install.ts` all take it through the `RunCommand` seam). It spawns with piped stdout and stderr, sets a timer that sends `SIGTERM` and then `SIGKILL` after `GRACE_MS`, and awaits three things together: both pipes drained to EOF, and `spawned.exited`.

Two facts decide the design:

- A pipe reaches EOF when the **last** writer closes it. A child that inherited the fd is a writer, so `new Response(spawned.stdout).text()` does not settle while that child lives — however long after the deadline that is.
- `spawned.kill()` signals one pid. The child's own children are not in it.

Measured here, Bun 1.4.2 on Linux: `Bun.spawn({ detached: true })` puts the child in a new process group whose id is the child's pid (`ps -o pgid=`), and `process.kill(-pid, "SIGTERM")` then reaches the group. Against `sh -c "echo working; sleep 30 & wait"` the pipes settled 1 ms after the group signal, carrying `working`, with no member of the group left (`pgrep -g`). The same probe without `detached` is what the bug report describes.

`src/graphify-runner.py` already stops its run this way — `os.killpg` with `TERM`, then `KILL` after 2 s — so a process group is the shape this project already uses for "stop the work, not one process of it".

## Goals / Non-Goals

**Goals:**
- A call with a deadline returns within that deadline plus the grace period, whatever the program spawned.
- Nothing survives the stop: the program and its descendants are gone by the time the call returns.
- The partial output stays the diagnosis.

**Non-Goals:**
- Changing any caller, deadline, or the timeout message.
- Reaching a descendant that escapes the group by calling `setsid` itself. A program that deliberately leaves its own group is out of reach of any group signal, and none of the programs run here does it.
- Windows.

## Decisions

### The child gets its own process group, and the deadline signals the group

`Bun.spawn(..., { detached: true })`, then `process.kill(-spawned.pid, "SIGTERM")` at the deadline and `process.kill(-spawned.pid, "SIGKILL")` after `GRACE_MS`.

- *Why not keep `spawned.kill()` and stop awaiting the pipes instead:* returning at the deadline with the pipes abandoned leaves the grandchildren running — a `pip install` stopped that way keeps compiling — and loses the output that arrived in the same moment. The call would be bounded and the machine would not.
- *Why not read the process tree and signal each pid:* a pid read is a race, and the tree is exactly what the kernel already groups for us.
- *Why `detached` is safe without `unref()`:* `detached` is a new session and group, not a detached lifetime. The parent still holds a ref, so `spawned.exited` settles as it does today, and the run is still awaited.
- *Consequence, stated in the proposal:* the program no longer receives the terminal's `SIGINT` through pi's own group. Everything run through `runProcess` is a reported background step, so being signalled by the deadline rather than by the terminal is the behaviour we want.

### Signalling the group is guarded, and failure is not fatal

`process.kill(-pid, ...)` throws `ESRCH` once the group is gone — which is the ordinary case for the `SIGKILL` that follows a `SIGTERM` the program honoured. Both signals are wrapped, and a throw is ignored: the program is already gone, which is the outcome the signal wanted.

## Testing seams

| Requirement | Seam |
| --- | --- |
| A stopped program's descendants are stopped with it, and the call returns at its deadline | `runProcess` in `test/process.test.ts`, against a real `sh` that puts a child in the background (`sh -c "echo working; sleep 30 & wait"`) — the seam the callers themselves use, and the only one at which "the pipe is still open" exists at all |

A faked `RunCommand` cannot express this: the behaviour under test is what the operating system does with pipes and signals. The test asserts on the process table by pid rather than on a clock, as the existing "leaves no process behind" case does.
