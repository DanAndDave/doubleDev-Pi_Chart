"""Runs graph extraction for one Codebase, outside the pi process that asked.

A cold `graphify extract` on a large Codebase takes minutes, longer than a
session may last. pi launches this runner detached and returns; the runner
coalesces requests, enforces the deadline, and records how each run ended, all
of which has to outlive the session that asked.

Why Python: the one-run-at-a-time guarantee is a kernel lock, `flock`.
Python's standard library has `fcntl.flock`, and Python is guaranteed to be
present wherever graphify is installed (it is a Python package). Bun has no
`flock`; `flock(1)` is util-linux only and absent on macOS; and a PID file is
exactly what the kernel lock avoids: PIDs get reused, and a SIGKILLed holder
leaves a stale file behind that someone would have to clean up.

Why the lock descriptor is passed to graphify: the lock belongs to the open
file, so it is held while any process holds the descriptor. If the runner is
SIGKILLed while graphify is still writing the graph, graphify keeps the
Codebase locked until it exits, and no second run starts underneath it. The
lock never needs cleaning up.

Standard library only, POSIX only.

    run <state-dir> --codebase <path> --graphify <exe> --deadline-ms <n>
    status <state-dir>
"""

import argparse
import errno
import fcntl
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import uuid

# Matches GRACE_MS in process.ts: time between SIGTERM and SIGKILL.
GRACE_S = 2.0
OUTPUT_TAIL_BYTES = 4096


def now_ms():
    return int(time.time() * 1000)


def write_json_atomically(path, value):
    # A reader in another process must never see a half-written file, so the
    # content lands in a temp file in the same directory (same filesystem,
    # so the rename is atomic) and is renamed over the old one.
    directory = os.path.dirname(path)
    fd, temp = tempfile.mkstemp(dir=directory, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle)
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except FileNotFoundError:
            pass
        raise


def read_json(path):
    # Missing, unreadable and corrupt all mean "not there": status reports
    # what it can rather than failing on a file a killed runner left half-made.
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def unlink_quietly(path):
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def output_tail(log_path):
    try:
        with open(log_path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - OUTPUT_TAIL_BYTES))
            data = handle.read()
    except OSError:
        return ""
    return data.decode("utf-8", errors="replace")


def try_lock(lock_path):
    """The lock's descriptor if this process now holds it, else None."""
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        return None
    except BaseException:
        os.close(fd)
        raise
    return fd


def stop_group(process):
    # graphify runs a ProcessPoolExecutor, so stopping only the leader would
    # leave its workers running. The whole session's process group goes.
    pgid = process.pid
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=GRACE_S)
    except subprocess.TimeoutExpired:
        pass
    # Sent even if the leader has exited: a worker that ignored SIGTERM is
    # still in the group.
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def extract(state_dir, codebase, graphify, deadline_s, lock_fd):
    run_id = uuid.uuid4().hex[:12]
    started_at = now_ms()
    current_path = os.path.join(state_dir, "current.json")
    log_path = os.path.join(state_dir, "run.log")
    write_json_atomically(current_path, {"runId": run_id, "startedAt": started_at})

    stopped = None
    process = None
    try:
        with open(log_path, "wb") as log:
            process = subprocess.Popen(
                [graphify, "extract", codebase, "--code-only"],
                cwd=codebase,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                pass_fds=(lock_fd,),
            )
    except OSError as error:
        # 127 is what a shell reports for a command it could not run.
        exit_code = 127
        output = str(error)
    if process is not None:
        try:
            process.wait(timeout=deadline_s)
        except subprocess.TimeoutExpired:
            stop_group(process)
            stopped = "deadline"
        exit_code = process.returncode
        output = output_tail(log_path)

    outcome = {
        "runId": run_id,
        "startedAt": started_at,
        "endedAt": now_ms(),
        "exitCode": exit_code,
        "output": output,
    }
    if stopped is not None:
        # The deadline this run was held to, which a later session reporting
        # the stop may not share.
        outcome["stopped"] = stopped
        outcome["deadlineMs"] = int(deadline_s * 1000)
    write_json_atomically(os.path.join(state_dir, "outcome.json"), outcome)
    unlink_quietly(current_path)

    # A claim on an outcome that has just been replaced can never be used
    # again. Removing claims only now, with the new outcome in place, means a
    # session never sees the old failure unclaimed and reports it twice.
    keep = "reported." + run_id
    for name in os.listdir(state_dir):
        if name.startswith("reported.") and name != keep:
            unlink_quietly(os.path.join(state_dir, name))


def run(args):
    state_dir = args.state_dir
    codebase = args.codebase
    deadline_s = args.deadline_ms / 1000.0 if args.deadline_ms > 0 else None
    os.makedirs(state_dir, exist_ok=True)
    with open(os.path.join(state_dir, "codebase"), "w", encoding="utf-8") as handle:
        handle.write(codebase)

    lock_path = os.path.join(state_dir, "lock")
    requested_path = os.path.join(state_dir, "requested")
    while True:
        lock_fd = try_lock(lock_path)
        if lock_fd is None:
            # The holder checks `requested` again before it lets go.
            return 0
        try:
            while os.path.exists(requested_path):
                # Deleted before the run starts, so a request made during
                # the run survives it and earns exactly one more.
                unlink_quietly(requested_path)
                extract(state_dir, codebase, args.graphify, deadline_s, lock_fd)
        finally:
            os.close(lock_fd)
        # A request made between the loop's last check and the release
        # launched a runner that found the lock held and left. It is ours.
        if not os.path.exists(requested_path):
            return 0


def running(state_dir):
    lock_path = os.path.join(state_dir, "lock")
    try:
        fd = os.open(lock_path, os.O_RDONLY)
    except OSError:
        return None
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno not in (errno.EWOULDBLOCK, errno.EAGAIN):
                return None
        else:
            # Free: nothing is running. Closing the descriptor releases it.
            return None
        current = read_json(os.path.join(state_dir, "current.json"))
        if current is not None and isinstance(current.get("startedAt"), (int, float)):
            run_id = current.get("runId")
            return {
                "runId": run_id if isinstance(run_id, str) else None,
                "since": current["startedAt"],
            }
        # Held between runs, or by a killed runner's graphify whose
        # current.json is gone: the lock file is as close as we can say.
        return {"runId": None, "since": int(os.fstat(fd).st_mtime * 1000)}
    finally:
        os.close(fd)


def status(args):
    state_dir = args.state_dir
    report = {
        "running": running(state_dir),
        "last": read_json(os.path.join(state_dir, "outcome.json")),
    }
    sys.stdout.write(json.dumps(report) + "\n")
    return 0


def main(argv):
    parser = argparse.ArgumentParser(prog="graphify-runner")
    commands = parser.add_subparsers(dest="command", required=True)

    run_parser = commands.add_parser("run")
    run_parser.add_argument("state_dir")
    run_parser.add_argument("--codebase", required=True)
    run_parser.add_argument("--graphify", required=True)
    run_parser.add_argument("--deadline-ms", type=int, required=True)
    run_parser.set_defaults(handler=run)

    status_parser = commands.add_parser("status")
    status_parser.add_argument("state_dir")
    status_parser.set_defaults(handler=status)

    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
