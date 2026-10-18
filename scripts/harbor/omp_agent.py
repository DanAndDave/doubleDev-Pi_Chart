"""Runs omp, once per round, inside a Harbor task's container.

`scripts/evocode.ts` owns the Run; this only sends each round as one Turn of
one Conversation. The host mounts omp at /opt/omp/omp, Bun at /opt/bun/bun
and, for the pi-chart Arm, this checkout at /opt/pi-chart, all read-only.

omp runs with a fresh home in the container (/tmp/omp-home), so it reads none
of the user's settings and pi-chart finds its Journals where it always looks,
under the home. After every round the session folder is copied to
/logs/agent/sessions, which Harbor keeps across resumed rounds and snapshots
into the trial, so the last round's snapshot holds the whole Conversation.

A failed Turn ends the Run: each round writes /logs/agent/turns/<n>.started
before omp and <n>.done after omp exits zero, and a round sends nothing when
an earlier one started without finishing, as a timeout leaves it.

Agent kwargs (`--ak`): `arm` (`vanilla` or `pi-chart`), `omp_version` (what
`omp --version` must print), `model`, and optionally `thinking`. The host
passes the Anthropic token as `OMP_AGENT_TOKEN` and, for pi-chart, the Run's
database as `OMP_AGENT_DATABASE_URL`, in Harbor's own environment, so neither
is written into the job's config.
"""

import shlex
from typing import Any, override

from harbor.agents.capabilities import AgentCapabilities
from harbor.agents.installed.base import BaseInstalledAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

OMP = "/opt/omp/omp"
BUN = "/opt/bun/bun"
PI_CHART = "/opt/pi-chart"
HOME = "/tmp/omp-home"
BUNDLE = "/tmp/pichart-bundle"
LOGS = "/logs/agent"
TURNS = f"{LOGS}/turns"
SESSIONS = f"{HOME}/.omp/agent/sessions"
ARMS = ("vanilla", "pi-chart")
# Linux's limit for one argument (MAX_ARG_STRLEN).
MAX_ARGUMENT = 128 * 1024


class OmpAgent(BaseInstalledAgent):
    capabilities = AgentCapabilities(resume=True)

    def __init__(
        self,
        *args: Any,
        arm: str,
        omp_version: str,
        model: str,
        thinking: str | None = None,
        **kwargs: Any,
    ):
        if arm not in ARMS:
            raise ValueError(f"arm must be one of {ARMS}, got {arm!r}")
        super().__init__(*args, **kwargs)
        self.arm = arm
        self.omp_version = omp_version
        self.model = model
        self.thinking = thinking

    @staticmethod
    @override
    def name() -> str:
        return "omp"

    @override
    def version(self) -> str | None:
        return self.omp_version

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        result = await environment.exec(command=f"{OMP} --version")
        printed = (result.stdout or "").strip()
        if result.return_code != 0 or printed != self.omp_version:
            raise RuntimeError(
                f"{OMP} --version printed {printed!r} (exit {result.return_code}), "
                f"not the host's {self.omp_version!r}: {result.stderr}"
            )

    def omp_command(self, instruction: str) -> str:
        args = [OMP, "-p", "--no-title", "--no-extensions"]
        if self.arm == "pi-chart":
            args += [
                "-e",
                f"{PI_CHART}/scripts/run-url-set.ts",
                "-e",
                f"{PI_CHART}/src/extension.ts",
                "-e",
                f"{PI_CHART}/scripts/run-url-unset.ts",
            ]
        args += ["--model", self.model]
        if self.thinking:
            args += ["--thinking", self.thinking]
        if self._resume:
            args.append("-c")
        args.append(instruction)
        return shlex.join(args)

    def environment_for_omp(self) -> dict[str, str]:
        token = self._get_env("OMP_AGENT_TOKEN")
        if not token:
            raise RuntimeError("OMP_AGENT_TOKEN is not set in Harbor's environment")
        env = {
            "HOME": HOME,
            "ANTHROPIC_OAUTH_TOKEN": token,
            "PICHART_DOC_BUNDLE": BUNDLE,
            "PICHART_BUN": BUN,
        }
        if self.arm == "pi-chart":
            database = self._get_env("OMP_AGENT_DATABASE_URL")
            if not database:
                raise RuntimeError("OMP_AGENT_DATABASE_URL is not set for a pi-chart Run")
            env["BENCH_RUN_DATABASE_URL"] = database
        return env

    @override
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        # Readable by the host's user: the container runs as root, and omp writes its Journals private.
        copy_sessions = (
            f"if [ -d {SESSIONS} ]; then mkdir -p {LOGS}/sessions && cp -a {SESSIONS}/. {LOGS}/sessions/"
            f" && chmod -R a+rX {LOGS}/sessions; fi"
        )
        # The round this call sends: one more than the rounds started before it.
        next_round = f"n=$(( $(ls {TURNS} | grep -c '\\.started$') + 1 ))"
        if len(instruction.encode()) > MAX_ARGUMENT:
            # Marked started and never done, so no later round sends anything.
            await environment.exec(command=f"mkdir -p {TURNS} && {next_round} && touch {TURNS}/$n.started")
            raise RuntimeError(f"the round's instruction is {len(instruction.encode())} bytes, over Linux's {MAX_ARGUMENT} for one argument")

        script = "\n".join(
            [
                f"mkdir -p {TURNS} {HOME} {BUNDLE}",
                f"for started in {TURNS}/*.started; do",
                '  [ -e "$started" ] || continue',
                '  if [ ! -e "${started%.started}.done" ]; then',
                # A timed-out round's omp may still be running; it must not go on spending.
                # Found by name through /proc: images need not have pkill, and this
                # script's own command line holds omp's path.
                '    for proc in /proc/[0-9]*; do [ "$(cat "$proc/comm" 2>/dev/null)" = omp ] && kill -9 "${proc#/proc/}" 2>/dev/null; done',
                f"    {copy_sessions}",
                '    echo "round $(basename "${started%.started}") did not finish; sending nothing"',
                "    exit 0",
                "  fi",
                "done",
                next_round,
                f'touch "{TURNS}/$n.started"',
                f"{self.omp_command(instruction)} </dev/null",
                "code=$?",
                copy_sessions,
                f'[ "$code" -eq 0 ] && touch "{TURNS}/$n.done"',
                'exit "$code"',
            ]
        )
        try:
            await self.exec_as_agent(environment, command=f"bash -c {shlex.quote(script)}", env=self.environment_for_omp())
        finally:
            # After a timeout the script never copied this round's Journal.
            try:
                await environment.exec(command=copy_sessions)
            except Exception as error:
                self.logger.warning("could not copy the round's sessions: %s", error)
