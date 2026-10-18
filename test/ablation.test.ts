import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	addSet,
	alone,
	calibrationSet,
	controlUnit,
	countCheck,
	cut,
	duplicated,
	locate,
	matches,
	probeMatches,
	priceOf,
	ratesOf,
	sample,
	sham,
	stability,
	summarise,
	verdict,
	type AblationRecord,
	type CalibrationFile,
	type BodyBlock,
	type CallUnits,
	type Condition,
	type Draw,
	type Fate,
	type Location,
	type RequestBody,
	type Verdict,
} from "../scripts/ablation.ts";
import { type CalibrationKey, setFor } from "../scripts/calibration.ts";
import { measureRun, type Score } from "../scripts/measures.ts";
import { actionOf, targetOf, type Unit, unitsOf } from "../scripts/units.ts";
import { EVICTION_NOTICE, OPENING_FRAMING } from "../src/assembler.ts";
import type { TurnAccounting } from "../src/accounting.ts";
import { readBranch, type JournalTurn } from "../src/journal.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { PINS_FRAMING, pinTexts } from "../src/pins.ts";

describe("tool and target", () => {
	test("read targets the path, without its line selector", () => {
		expect(targetOf({ name: "read", arguments: { path: "src/a.ts:1-40", i: "Reading a" } })).toEqual({
			tool: "read",
			target: "src/a.ts",
		});
	});

	test("write targets its path; edit targets the files its input names; neither keeps a line selector", () => {
		expect(targetOf({ name: "write", arguments: { path: "src/b.ts:raw", content: "x", i: "Writing b" } })).toEqual({
			tool: "write",
			target: "src/b.ts",
		});
		const input = "[src/budget-table.ts#8134]\nPUT 16.=17:\n+/** A. */\n[test/b.test.ts#00AF]\nCUT 3.=4\n";
		expect(targetOf({ name: "edit", arguments: { input, i: "Editing" } })).toEqual({
			tool: "edit",
			target: "src/budget-table.ts\ntest/b.test.ts",
		});
	});

	test("grep and glob target the pattern and the path", () => {
		const grep = (pattern: string, path: string) => targetOf({ name: "grep", arguments: { pattern, path, i: "x" } });
		expect(grep("reconstructTurns", "src/turns.ts")).toEqual(grep("reconstructTurns", "src/turns.ts"));
		expect(grep("reconstructTurns", "src/turns.ts")).not.toEqual(grep("reconstructTurns", "src"));
		expect(grep("reconstructTurns", "src/turns.ts")).not.toEqual(grep("turnSizes", "src/turns.ts"));
		const glob = (path: string, limit?: number) => targetOf({ name: "glob", arguments: { path, limit, i: "x" } });
		expect(glob("test/*.test.ts", 3)).toEqual(glob("test/*.test.ts"));
		expect(glob("test/*.test.ts")).not.toEqual(glob("src/*"));
		expect(glob("src/*").tool).toBe("glob");
	});

	test("bash targets the command with whitespace runs collapsed to one space", () => {
		expect(targetOf({ name: "bash", arguments: { command: "bun  test\n\t test/a.test.ts", i: "Testing" } })).toEqual({
			tool: "bash",
			target: "bun test test/a.test.ts",
		});
	});

	test("any other tool is the tool name alone", () => {
		expect(targetOf({ name: "search_documentation", arguments: { query: "config" } })).toEqual({
			tool: "search_documentation",
		});
		expect(targetOf({ name: "eval", arguments: { language: "py", code: "1" } })).toEqual({ tool: "eval" });
	});

	test("a call through omp's tool device counts as the tool it ran", () => {
		const device = (content: string) =>
			targetOf({ name: "write", arguments: { path: "xd://recall_earlier_turns", content, i: "Recalling" } });
		expect(device('{"query": "reviewer handle", "limit": 5}')).toEqual({ tool: "recall_earlier_turns" });
		// Help mode ran no tool.
		expect(device("?").tool).toBe("write");
		// A read of the device's docs is a read.
		expect(targetOf({ name: "read", arguments: { path: "xd://recall_earlier_turns" } })).toEqual({
			tool: "read",
			target: "xd://recall_earlier_turns",
		});
	});
});

describe("matches", () => {
	const read = (path: string) => ({ name: "read", arguments: { path, i: "Reading" } });
	const bash = (command: string) => ({ name: "bash", arguments: { command, i: "Running" } });

	test("a resend reading a different range of the same file matches", () => {
		expect(matches(actionOf([read("src/a.ts:1-40")]), actionOf([read("src/a.ts:200-260")]))).toBe(true);
	});

	test("a resend matches when any of its tool calls has the original's first tool and target", () => {
		const original = actionOf([read("src/a.ts"), bash("bun test")]);
		expect(matches(original, actionOf([bash("ls"), read("src/a.ts:raw")]))).toBe(true);
		expect(matches(original, actionOf([bash("bun test")]))).toBe(false);
		expect(matches(original, actionOf([read("src/b.ts")]))).toBe(false);
	});

	test("a reply with no tool call matches only a reply with no tool call", () => {
		expect(matches(actionOf([]), actionOf([]))).toBe(true);
		expect(matches(actionOf([]), actionOf([read("src/a.ts")]))).toBe(false);
		expect(matches(actionOf([read("src/a.ts")]), actionOf([]))).toBe(false);
	});

	test("a device call matches the same tool called directly", () => {
		const device = { name: "write", arguments: { path: "xd://recall_earlier_turns", content: '{"query": "q"}' } };
		expect(matches(actionOf([device]), actionOf([{ name: "recall_earlier_turns", arguments: { query: "other" } }]))).toBe(
			true,
		);
	});
});

describe("probeMatches", () => {
	const plants = [
		{ id: "codeword", kind: "literal" as const, value: "HERON-4" },
		{ id: "owner", kind: "constraint" as const, value: "@dana" },
	];
	const resend = (text: string, ...calls: { name: string; arguments: unknown }[]) => ({
		role: "assistant",
		content: [
			{ type: "text", text },
			...calls.map((call, at) => ({ type: "toolCall", id: `r${at}`, ...call })),
		],
	});
	const owned = { name: "write", arguments: { path: "OWNERS", content: "@dana" } };

	test("a resend answering UNKNOWN for a Plant the original got right does not match", () => {
		expect(probeMatches(plants.slice(0, 1), [true], resend("The codeword: UNKNOWN"))).toBe(false);
	});

	test("a resend matches when it scores every probed Plant as the original did", () => {
		expect(probeMatches(plants, [true, true], resend("The codeword is HERON-4.", owned))).toBe(true);
		expect(probeMatches(plants, [true, false], resend("The codeword is HERON-4."))).toBe(true);
		// Right where the original was wrong is still a different answer.
		expect(probeMatches(plants, [true, false], resend("The codeword is HERON-4.", owned))).toBe(false);
	});
});

const prompt = (text: string): HarnessMessage => ({ role: "user", content: [{ type: "text", text }], attribution: "user" });
const reply = (...content: unknown[]): HarnessMessage => ({
	role: "assistant",
	content: content as HarnessMessage["content"],
	usage: { input: 10, output: 40, cacheRead: 9000, cacheWrite: 200, totalTokens: 9250, cost: { total: 0.01 } },
	contextSnapshot: { promptTokens: 9210, nonMessageTokens: 8000 },
});
const said = (text: string) => ({ type: "text", text });
const toolCall = (id: string, name: string, args: unknown) => ({ type: "toolCall", id, name, arguments: args });
const result = (id: string, toolName: string, text: string, details?: unknown): HarnessMessage => ({
	role: "toolResult",
	toolCallId: id,
	toolName,
	content: [{ type: "text", text }],
	...(details === undefined ? {} : { details }),
});

/** A Journal entry: a message, or any other entry by its own fields. */
type Entry = { id: string; message: HarnessMessage } | { id: string; type: string; [field: string]: unknown };

/** A record folder as `bench-tokens` writes one: `run.json`, the Journal in branch order, and the Accounting when given. */
async function recordFolder(arm: string, entries: Entry[], accounting?: TurnAccounting[]): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `ablation-${arm}-`));
	const run = { arm, index: 0, workload: { name: "fixture", version: 1, commit: "c0" }, omp: "omp/18.11.0", cwd: dir };
	await writeFile(join(dir, "run.json"), JSON.stringify({ ...run, sessionId: "s-own", plants: [], prompts: [], checks: [] }));
	const lines = entries.map((entry, at) => ({
		...("message" in entry ? { type: "message" } : {}),
		...entry,
		parentId: entries[at - 1]?.id ?? null,
	}));
	await writeFile(join(dir, "journal.jsonl"), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
	if (accounting) await writeFile(join(dir, "accounting.json"), JSON.stringify({ "s-own": accounting }));
	return dir;
}

/** The units of every main Call of the record at `dir`, in Call order, each from the window `measureRun` gives it. */
async function unitsByCall(dir: string): Promise<Unit[][]> {
	const { turns, compactions, entries } = await readBranch(join(dir, "journal.jsonl"));
	const windows = (await measureRun(dir)).calls.filter((call) => !call.subagent).map((call) => call.window);
	const addresses = turns.flatMap((turn) =>
		turn.messages.flatMap((message, at) => (message.role === "assistant" && message.usage ? [{ turn: turn.turnIndex, message: at }] : [])),
	);
	return addresses.map((address, at) => unitsOf(turns, address, windows[at] ?? "unknown", compactions, pinTexts(entries)));
}

/** One Accounting row per Call: what pi-chart's window carried. */
const carried = (turn: number, calls: number, opening: number, pins: number[], tail: number[]): TurnAccounting => ({
	conversationId: "s-own",
	turnIndex: turn,
	calls: Array.from({ length: calls }, (_, callIndex) => ({
		turnIndex: turn,
		callIndex,
		parts: [
			{ source: "opening", approximateTokens: 20, carried: 1, turnIndices: [opening] },
			{ source: "pinned", approximateTokens: 10, carried: pins.length, pinIds: pins },
			{ source: "verbatim-tail", approximateTokens: 400, carried: tail.length, turnIndices: tail },
		],
	})) as TurnAccounting["calls"],
});

describe("unitsOf", () => {
	const big = "x".repeat(4000);
	/** Turn 0 plants a codeword; Turn 1 reads, recalls through the device and searches the docs; Turn 2 runs tests over three Calls. */
	const piChart = () =>
		recordFolder(
			"pi-chart",
			[
				{ id: "u0", message: prompt("Remember the codeword HERON-4.") },
				{ id: "a0c0", message: reply(said("Noted.")) },
				{ id: "p1", type: "custom", customType: "pi-chart.pin", data: { op: "add", id: 1, text: "Release name PIN-23" } },
				{ id: "u1", message: prompt("Look at the config.") },
				{
					id: "a1c0",
					message: reply(
						{ type: "thinking", thinking: "Read it, then recall." },
						toolCall("t1a", "read", { path: "config.toml" }),
						toolCall("t1b", "write", { path: "xd://recall_earlier_turns", content: '{"query": "codeword"}' }),
						toolCall("t1c", "search_documentation", { query: "config" }),
					),
				},
				{ id: "r1a", message: result("t1a", "read", `port = 8080\n${big}`) },
				{
					id: "r1b",
					message: result("t1b", "write", "[recalled from turn 0] the codeword is HERON-4", {
						xdev: { tool: "recall_earlier_turns", mode: "execute" },
					}),
				},
				{ id: "r1c", message: result("t1c", "search_documentation", "[doc] Config: read once at start.") },
				{ id: "a1c1", message: reply(said("The port is 8080.")) },
				{ id: "u2", message: prompt("Run the tests.") },
				{ id: "a2c0", message: reply(toolCall("t2a", "bash", { command: "bun test" })) },
				{ id: "r2a", message: result("t2a", "bash", "3 pass") },
				{ id: "a2c1", message: reply(toolCall("t2b", "bash", { command: "bun test --coverage" })) },
				{ id: "r2b", message: result("t2b", "bash", "3 pass, 91%") },
				{ id: "a2c2", message: reply(said("All pass.")) },
			],
			[carried(0, 1, 0, [], []), carried(1, 2, 0, [1], [0]), carried(2, 3, 0, [1], [0, 1])],
		);

	test("a pi-chart Call's units are the Opening, each Pin, and each earlier Turn's prose and tool calls", async () => {
		const third = (await unitsByCall(await piChart()))[5] ?? [];

		const tokens = expect.any(Number);
		expect(third).toHaveLength(7);
		expect(third).toEqual(
			expect.arrayContaining([
				{ kind: "opening", turn: 0, text: "Remember the codeword HERON-4.", tokens },
				{ kind: "pin", pin: 1, text: "Release name PIN-23", tokens },
				{ kind: "prose", turn: 0, text: "Remember the codeword HERON-4.", tokens },
				{ kind: "prose", turn: 1, text: "Look at the config.", tokens },
				{ kind: "tool-call", turn: 1, callId: "t1a", tool: "read", tokens },
				{ kind: "pull", turn: 1, callId: "t1b", tool: "recall_earlier_turns", tokens },
				{ kind: "pull", turn: 1, callId: "t1c", tool: "search_documentation", tokens },
			]),
		);
	});

	test("no unit is a message of the Call's own Turn", async () => {
		const calls = await unitsByCall(await piChart());

		for (const units of calls.slice(3)) {
			expect(units.filter((unit) => unit.turn === 2)).toEqual([]);
			expect(units.map((unit) => unit.callId).filter((id) => id === "t2a" || id === "t2b")).toEqual([]);
		}
	});

	test("a Call of Turn 0 has no Opening unit, since the Opening carries Turn 0", async () => {
		const calls = await unitsByCall(await piChart());

		expect(calls[0]).toEqual([]);
		expect(calls[1]?.filter((unit) => unit.kind === "opening").map((unit) => unit.turn)).toEqual([0]);
	});

	test("a unit's tokens are estimated from the record", async () => {
		const third = (await unitsByCall(await piChart()))[5] ?? [];
		const read = third.find((unit) => unit.callId === "t1a");

		// 4,000 characters of result, at about four characters a token, plus the call around it.
		expect(read?.tokens).toBeGreaterThan(1000);
		expect(read?.tokens).toBeLessThan(1100);
	});

	/** Turn 1 runs two commands in two Calls; a compaction keeping from `kept` comes before Turn 2. */
	const compacted = (kept: string) =>
		recordFolder("vanilla", [
			{ id: "u0", message: prompt("Start.") },
			{ id: "a0c0", message: reply(said("Started.")) },
			{ id: "u1", message: prompt("Run the tests.") },
			{ id: "a1c0", message: reply(toolCall("t1a", "bash", { command: "bun test" })) },
			{ id: "r1a", message: result("t1a", "bash", "3 pass") },
			{ id: "a1c1", message: reply(toolCall("t1b", "bash", { command: "bun run typecheck" })) },
			{ id: "r1b", message: result("t1b", "bash", "clean") },
			{ id: "a1c2", message: reply(said("Tests pass.")) },
			{ id: "k1", type: "compaction", summary: "## Goal\nShip build 7341.", firstKeptEntryId: kept },
			{ id: "u2", message: prompt("Ship it.") },
			{ id: "a2c0", message: reply(said("Shipped.")) },
		]);

	test("a plain-omp Call after compaction has the summary as a unit, and nothing the compaction cut", async () => {
		const last = (await unitsByCall(await compacted("u1"))).at(-1);

		const tokens = expect.any(Number);
		expect(last).toHaveLength(4);
		expect(last).toEqual(
			expect.arrayContaining([
				{ kind: "summary", text: "## Goal\nShip build 7341.", tokens },
				{ kind: "prose", turn: 1, text: "Run the tests.", tokens },
				{ kind: "tool-call", turn: 1, callId: "t1a", tool: "bash", tokens },
				{ kind: "tool-call", turn: 1, callId: "t1b", tool: "bash", tokens },
			]),
		);
	});

	test("a tail begun part-way through a Turn holds only the units it carried whole", async () => {
		const last = (await unitsByCall(await compacted("a1c1"))).at(-1) ?? [];

		expect(last.map((unit) => [unit.kind, unit.callId])).toEqual(
			expect.arrayContaining([
				["summary", undefined],
				["tool-call", "t1b"],
			]),
		);
		expect(last).toHaveLength(2);
	});

	/** A right Score of the codeword at Turn 2, its value planted at Turn `planted` and held at `position`. */
	const scored = (position: Score["position"], planted = 0): Score => ({
		id: "codeword",
		turn: 2,
		kind: "literal",
		right: true,
		planted,
		distance: 2 - planted,
		position,
		source: "none",
	});

	test("the positive control cuts the Plant's whole Turn when the verbatim tail held it", async () => {
		const dir = await piChart();
		const { turns } = await readBranch(join(dir, "journal.jsonl"));
		const units = (await unitsByCall(dir))[3] ?? [];

		expect(controlUnit(units, turns, scored("tail", 1), "8080")).toEqual({
			kind: "turn",
			turn: 1,
			text: "Look at the config.",
			callIds: ["t1a", "t1b", "t1c"],
			tokens: expect.any(Number),
		});
		// The Turn's prompt, its calls, their results and its replies, the 4,000-character read among them.
		expect(controlUnit(units, turns, scored("tail", 1), "8080")?.tokens).toBeGreaterThan(1000);
	});

	test("the positive control cuts the Opening, the Pin or the summary that held the Plant", async () => {
		const dir = await piChart();
		const { turns } = await readBranch(join(dir, "journal.jsonl"));
		const units = (await unitsByCall(dir))[3] ?? [];

		expect(controlUnit(units, turns, scored("opening"), "HERON-4")?.kind).toBe("opening");
		expect(controlUnit(units, turns, scored("pin"), "PIN-23")).toMatchObject({ kind: "pin", pin: 1 });
		expect(controlUnit(units, turns, scored("pin"), "absent")).toBeUndefined();
		expect(controlUnit(units, turns, scored("evicted"), "HERON-4")).toBeUndefined();

		const plain = await compacted("u1");
		const last = (await unitsByCall(plain)).at(-1) ?? [];
		const { turns: plainTurns } = await readBranch(join(plain, "journal.jsonl"));
		expect(controlUnit(last, plainTurns, scored("summary"), "7341")?.kind).toBe("summary");
	});
});

describe("count check", () => {
	test("sham − cut may differ from the unit's own count by up to 20 tokens on a small unit", () => {
		expect(countCheck(10_000, 9_880, 100)).toBe(true);
		expect(countCheck(10_000, 9_920, 100)).toBe(true);
		expect(countCheck(10_000, 9_879, 100)).toBe(false);
		expect(countCheck(10_000, 9_921, 100)).toBe(false);
	});

	test("on a unit over 400 tokens the tolerance is 5% of it", () => {
		expect(countCheck(10_000, 8_950, 1_000)).toBe(true);
		expect(countCheck(10_000, 8_949, 1_000)).toBe(false);
		// Thinking blocks dropped with the prefix: 400 more than the unit fell out.
		expect(countCheck(10_000, 8_600, 1_000)).toBe(false);
	});
});

describe("noise", () => {
	test("a Call is stable when 3 of its 4 shams match", () => {
		expect(stability([true, true, false, true])).toBe(true);
		expect(stability([true, true, true, true])).toBe(true);
		expect(stability([true, false, false, true])).toBe(false);
	});

	test("cut resends decide: at most 1 match is needed, 2 unclear, 3 or 4 not needed", () => {
		expect(verdict([false, false, false, false])).toBe("needed");
		expect(verdict([false, true, false, false])).toBe("needed");
		expect(verdict([true, false, true, false])).toBe("unclear");
		expect(verdict([true, true, false, true])).toBe("not-needed");
		expect(verdict([true, true, true, true])).toBe("not-needed");
	});
});

describe("sample", () => {
	const unit = (tokens: number, callId: string): Unit => ({ kind: "tool-call", turn: 0, callId, tool: "bash", tokens });
	/** 12 Calls of three units each; Calls 4 and 9 hold none. */
	const run: CallUnits[] = Array.from({ length: 12 }, (_, call) => ({
		call,
		units: call === 4 || call === 9 ? [] : [unit(100, `c${call}a`), unit(300, `c${call}b`), unit(600, `c${call}c`)],
	}));

	test("the same record, seed and size draw the same Calls and units", () => {
		expect(sample(run, 5, 7, new Set())).toEqual(sample(run, 5, 7, new Set()));
	});

	test("Calls are drawn without replacement, never twice across redraws, and only Calls with a unit", () => {
		const first = sample(run, 6, 7, new Set());
		const firstCalls = first.map((draw) => draw.call);
		expect(new Set(firstCalls).size).toBe(6);

		const redrawn = sample(run, 6, 8, new Set(firstCalls)).map((draw) => draw.call);
		// Ten Calls hold a unit; six are taken, so four are left.
		expect(redrawn).toHaveLength(4);
		expect(redrawn.filter((call) => firstCalls.includes(call))).toEqual([]);
		expect([...firstCalls, ...redrawn].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 10, 11]);
	});

	test("over 1,000 seeds a Call's unit is chosen in proportion to its tokens, within 5 points", () => {
		const chosen = new Map<string, number>();
		for (let seed = 1; seed <= 1000; seed++) {
			for (const draw of sample(run.slice(0, 1), 1, seed, new Set())) {
				chosen.set(draw.unit.callId as string, (chosen.get(draw.unit.callId as string) ?? 0) + 1);
			}
		}
		expect(Math.abs((chosen.get("c0a") ?? 0) / 1000 - 0.1)).toBeLessThan(0.05);
		expect(Math.abs((chosen.get("c0b") ?? 0) / 1000 - 0.3)).toBeLessThan(0.05);
		expect(Math.abs((chosen.get("c0c") ?? 0) / 1000 - 0.6)).toBeLessThan(0.05);
	});
});

describe("pricing", () => {
	const charged = (tokens: Record<"input" | "output" | "cacheRead" | "cacheWrite", number>, cost: typeof tokens) => ({
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		usage: { ...tokens, totalTokens: 0, cost: { ...cost, total: cost.input + cost.output + cost.cacheRead + cost.cacheWrite } },
	});
	/** Two Calls charged at $5/M input, $25/M output, $0.50/M cache read and $10/M cache write. */
	const journal = [
		prompt("Go."),
		charged(
			{ input: 100, output: 1000, cacheRead: 10_000, cacheWrite: 2000 },
			{ input: 0.0005, output: 0.025, cacheRead: 0.005, cacheWrite: 0.02 },
		),
		result("t1", "bash", "ok"),
		charged({ input: 300, output: 200, cacheRead: 30_000, cacheWrite: 0 }, { input: 0.0015, output: 0.005, cacheRead: 0.015, cacheWrite: 0 }),
		{ role: "assistant", content: [{ type: "text", text: "aborted" }] },
	];

	test("rates are the Run's own cost per token of each kind", () => {
		const rates = ratesOf(journal);
		expect(rates.input).toBeCloseTo(5e-6, 12);
		expect(rates.output).toBeCloseTo(25e-6, 12);
		expect(rates.cacheRead).toBeCloseTo(0.5e-6, 12);
		expect(rates.cacheWrite).toBeCloseTo(10e-6, 12);
	});

	test("a kind the Run never used has no rate", () => {
		expect(ratesOf(journal.slice(3)).cacheWrite).toBe(0);
	});

	test("a resend is priced from its own usage at the Run's rates", () => {
		const usage = { input: 50, output: 400, cacheRead: 20_000, cacheWrite: 3000 };
		// 50 · $5/M + 400 · $25/M + 20,000 · $0.50/M + 3,000 · $10/M
		expect(priceOf(usage, ratesOf(journal))).toBeCloseTo(0.00025 + 0.01 + 0.01 + 0.03, 12);
	});
});

describe("summarise", () => {
	const drawn = (condition: Condition, fate: Fate, judged?: Verdict, duplicated?: true): Draw => ({
		call: 0,
		turn: 0,
		condition,
		fate,
		unit: { kind: "prose", turn: 0, text: "Go.", tokens: 100, ...(duplicated ? { duplicated } : {}) },
		original: [],
		resends: [],
		...(judged ? { verdict: judged } : {}),
		spend: 0,
	});
	const times = <T>(count: number, make: () => T): T[] => Array.from({ length: count }, make);
	const record = (arm: string, draws: Draw[], spend: number): AblationRecord => ({
		arm,
		index: 0,
		seed: 7,
		cap: 10,
		band: [43, 46],
		omp: "omp/18.11.0",
		draws,
		spend,
	});

	/** Two pi-chart Runs: 20 judged units and 2 duplicated ones, the rest of their fates, and a null set. */
	const pichart = [
		record(
			"pi-chart",
			[
				...times(6, () => drawn("ablate", "judged", "needed")),
				...times(5, () => drawn("ablate", "judged", "unclear")),
				drawn("ablate", "judged", "needed", true),
				drawn("ablate", "judged", "not-needed", true),
				...times(3, () => drawn("ablate", "unstable")),
				...times(2, () => drawn("ablate", "unfaithful")),
			],
			6.5,
		),
		record(
			"pi-chart",
			[
				...times(9, () => drawn("ablate", "judged", "not-needed")),
				drawn("ablate", "unlocated"),
				drawn("ablate", "miscounted"),
				...times(4, () => drawn("ablate", "capped")),
				drawn("null", "judged", "needed"),
				...times(9, () => drawn("null", "judged", "not-needed")),
				drawn("null", "unstable"),
			],
			3.25,
		),
	];

	test("the tail-and-summary share counts duplicated units, and leaves out unclear, Opening and Pin units", () => {
		const as = (draw: Draw, unit: Draw["unit"]): Draw => ({ ...draw, unit });
		const draws = [
			drawn("ablate", "judged", "needed"),
			drawn("ablate", "judged", "not-needed", true),
			drawn("ablate", "judged", "unclear"),
			as(drawn("ablate", "judged", "not-needed"), { kind: "summary", text: "So far.", tokens: 50 }),
			as(drawn("ablate", "judged", "needed"), { kind: "opening", turn: 0, text: "Build it.", tokens: 20 }),
			as(drawn("ablate", "judged", "needed"), { kind: "pin", pin: 1, text: "Use tabs.", tokens: 3 }),
			drawn("null", "judged", "needed"),
		];

		expect(summarise([record("vanilla", draws, 1)]).get("vanilla")?.tailSummary).toMatchObject({ k: 1, n: 3 });
	});

	test("6 of 20 judged, non-duplicated units Needed reads 30%, 14.5% to 51.9%", () => {
		const summary = summarise(pichart).get("pi-chart");

		expect(summary?.needed.k).toBe(6);
		expect(summary?.needed.n).toBe(20);
		expect(summary?.needed.share).toBeCloseTo(0.3, 12);
		expect(summary?.needed.lower).toBeCloseTo(0.1455, 4);
		expect(summary?.needed.upper).toBeCloseTo(0.519, 4);
	});

	test("duplicated units are summarised apart", () => {
		const summary = summarise(pichart).get("pi-chart");

		expect(summary?.duplicated).toMatchObject({ k: 1, n: 2, share: 0.5 });
	});

	test("beside Needed share: the unclear share, unstable Calls of those drawn, each fate, and the spend", () => {
		const summary = summarise(pichart).get("pi-chart");

		expect(summary?.unclear).toBeCloseTo(5 / 20, 12);
		// 33 ablate Calls and 11 null Calls drawn; 3 and 1 of them unstable.
		expect(summary?.unstable).toEqual({ k: 4, n: 44 });
		expect(summary?.fates).toEqual({ judged: 32, unstable: 4, unfaithful: 2, unlocated: 1, miscounted: 1, capped: 4 });
		expect(summary?.spend).toBeCloseTo(9.75, 12);
		expect(summary?.control).toBeUndefined();
	});

	test("the null false-Needed rate is null units judged Needed over null units judged", () => {
		const summary = summarise(pichart).get("pi-chart");

		expect(summary?.falseNeeded).toMatchObject({ k: 1, n: 10, share: 0.1 });
	});

	test("a positive control of 7 Needed in 10 is not trusted; 8 in 10 is", () => {
		const control = (needed: number) =>
			record(
				"vanilla",
				[
					...times(needed, () => drawn("control", "judged", "needed")),
					...times(10 - needed, () => drawn("control", "judged", "unclear")),
				],
				1,
			);

		expect(summarise([control(7)]).get("vanilla")?.control?.trusted).toBe(false);
		expect(summarise([control(8)]).get("vanilla")?.control).toMatchObject({ share: { k: 8, n: 10 }, trusted: true });
	});

	test("each Arm is summarised on its own", () => {
		const both = summarise([...pichart, record("vanilla", [drawn("ablate", "judged", "needed")], 0.9)]);

		expect([...both.keys()].sort()).toEqual(["pi-chart", "vanilla"]);
		expect(both.get("vanilla")?.needed).toMatchObject({ k: 1, n: 1 });
		expect(both.get("pi-chart")?.needed).toMatchObject({ k: 6, n: 20 });
	});
});

describe("calibration set", () => {
	const key: CalibrationKey = { workload: { name: "gate", version: 3 }, model: "claude-opus-4-5", omp: "omp/18.11.0" };
	const drawn = (condition: Condition, judged: Verdict): Draw => ({
		call: 0,
		turn: 0,
		condition,
		fate: "judged",
		unit: { kind: "pin", pin: 1, text: "Use tabs.", tokens: 3 },
		original: [],
		resends: [],
		verdict: judged,
		spend: 0,
	});
	const times = <T>(count: number, make: () => T): T[] => Array.from({ length: count }, make);
	/** One Run's calibration under `at`: 50 units, 10 null units, and a positive control of `needed` Needed in `of`. */
	const calibration = (needed: number, of: number, at: CalibrationKey = key) =>
		calibrationSet(
			at,
			[
				{
					record: {
						arm: "vanilla",
						index: 0,
						seed: 7,
						cap: 10,
						band: [43, 46],
						omp: at.omp,
						draws: [
							...times(50, () => drawn("ablate", "not-needed")),
							...times(10, () => drawn("null", "not-needed")),
							...times(needed, () => drawn("control", "needed")),
							...times(of - needed, () => drawn("control", "unclear")),
						],
						spend: 9,
					},
					turns: [],
					folder: "vanilla-0",
				},
			],
			"2026-10-16",
		);
	const empty: CalibrationFile = { sets: [] };

	test("a set whose positive control holds is added under its key", () => {
		const set = calibration(9, 10);
		const added = addSet(empty, set);

		expect(added).toEqual({ file: { sets: [set] } });
		expect(setFor(added.file, key)?.control).toMatchObject({ share: { k: 9, n: 10 }, trusted: true });
	});

	test("a positive control of 75% Needed leaves the file unchanged, and says why", () => {
		const result = addSet(empty, calibration(15, 20));

		expect(result.file).toBe(empty);
		expect(empty.sets).toEqual([]);
		expect(result.refused).toContain("15/20");
	});

	test("a key that already has a set gets no second", () => {
		const once = addSet(empty, calibration(9, 10)).file;
		const twice = addSet(once, calibration(10, 10));

		expect(twice.file).toBe(once);
		// Naming when the existing set was made.
		expect(twice.refused).toContain("2026-10-16");
	});

	test("a set is never read for another key", () => {
		const newer: CalibrationKey = { ...key, omp: "omp/18.12.0" };
		const file = addSet(addSet(empty, calibration(9, 10)).file, calibration(10, 10, newer)).file;

		expect(setFor(file, newer)?.control.share.k).toBe(10);
		expect(setFor(file, { ...key, model: "claude-sonnet-4-5" })).toBeUndefined();
		expect(setFor(file, { ...key, workload: { name: "gate", version: 4 } })).toBeUndefined();
		expect(setFor(file, { ...key, workload: { name: "smoke", version: 3 } })).toBeUndefined();
		// The file is read back from JSON, where a key's fields may come in any order.
		expect(setFor(file, { omp: key.omp, model: key.model, workload: { version: 3, name: "gate" } })?.control.share.k).toBe(9);
	});

	test("a judged tool-call unit keeps the call as rendered and its result, its Call's original next action and its verdict", () => {
		const turns: JournalTurn[] = [
			{
				turnIndex: 0,
				prompt: "Read a.",
				messages: [
					{ role: "user", content: "Read a." },
					{ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "src/a.ts" } }] },
					{ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "export const a = 1;" }] },
				],
				callCount: 1,
				calls: [0, 0, 0],
			},
		];
		const original = [{ tool: "bash", target: "bun test" }];
		const draw: Draw = {
			...drawn("ablate", "needed"),
			call: 2,
			turn: 1,
			unit: { kind: "tool-call", turn: 0, callId: "t1", tool: "read", tokens: 12 },
			original,
		};
		const record: AblationRecord = { arm: "pi-chart", index: 3, seed: 7, cap: 10, band: [43, 46], omp: key.omp, draws: [draw], spend: 1 };

		expect(calibrationSet(key, [{ record, turns, folder: "pi-chart-3" }], "2026-10-16").units).toEqual([
			{
				arm: "pi-chart",
				folder: "pi-chart-3",
				run: 3,
				call: 2,
				turn: 1,
				unit: draw.unit,
				content: 'read({"path":"src/a.ts"})\nexport const a = 1;',
				original,
				verdict: "needed",
			},
		]);
	});

	test("a judged prose unit keeps the prompt and the replies' text, without the Turn's tool calls", () => {
		// A prose cut leaves the Turn's thinking and tool calls in place, so its content holds neither.
		const thinking = { type: "thinking", thinking: "Which file?" };
		const turns: JournalTurn[] = [
			{
				turnIndex: 0,
				prompt: "Read a.",
				messages: [
					{ role: "user", content: "Read a." },
					{
						role: "assistant",
						content: [
							thinking,
							{ type: "text", text: "Reading it." },
							{ type: "toolCall", id: "t1", name: "read", arguments: { path: "src/a.ts" } },
						],
					},
					{ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "export const a = 1;" }] },
					{ role: "assistant", content: [{ type: "text", text: "a is 1." }] },
				],
				callCount: 2,
				calls: [0, 0, 0, 1],
			},
		];
		const draw: Draw = { ...drawn("null", "not-needed"), unit: { kind: "prose", turn: 0, text: "Read a.", tokens: 9 } };
		const record: AblationRecord = { arm: "vanilla", index: 1, seed: 7, cap: 10, band: [43, 46], omp: key.omp, draws: [draw], spend: 1 };

		expect(calibrationSet(key, [{ record, turns, folder: "vanilla-1" }], "2026-10-16").nulls.map((unit) => unit.content)).toEqual([
			"Read a.\nReading it.\na is 1.",
		]);
	});
});

describe("a unit cut from the finished request", () => {
	const mark = { type: "ephemeral", ttl: "1h" };
	const pins = `${PINS_FRAMING}\n\n[pinned by the user: #1, 1 of 2]\nUse tabs.\n\n[pinned by the user: #2, 2 of 2]\nNo emoji.`;
	const opening = `${OPENING_FRAMING}\nBuild the budget table.`;
	/** Turns 3 and 4 in the window, then the current Turn 5; breakpoints on the harness prompt, Turn 4's prompt and the last result. */
	const request = (): RequestBody => ({
		model: "claude-opus-5-5",
		tools: [{ type: "custom", name: "_read" }],
		system: [
			{ type: "text", text: "x-anthropic-billing-header: cch=1;" },
			{ type: "text", text: "The harness prompt.", cache_control: mark },
			{ type: "text", text: `${pins}\n\n${opening}\n\n${EVICTION_NOTICE}` },
		],
		messages: [
			{ role: "user", content: [{ type: "text", text: "<system-reminder>Today: 2026-10-16</system-reminder>" }, { type: "text", text: "Read src/a.ts." }] },
			{ role: "assistant", content: [{ type: "thinking", thinking: "", signature: "s1" }, { type: "tool_use", id: "t1", name: "_read", input: { path: "src/a.ts" } }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "export const a = 1;" }] },
			{ role: "assistant", content: [{ type: "thinking", thinking: "", signature: "s2" }, { type: "text", text: "a is 1." }] },
			{ role: "user", content: [{ type: "text", text: "Read src/b.ts.", cache_control: mark }] },
			{ role: "assistant", content: [{ type: "tool_use", id: "t2", name: "_read", input: { path: "src/b.ts" } }, { type: "tool_use", id: "t3", name: "_read", input: { path: "src/a.ts", i: "again" } }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "export const b = 2;" }, { type: "tool_result", tool_use_id: "t3", content: "export const a = 1;" }] },
			{ role: "assistant", content: [{ type: "text", text: "b is 2." }] },
			{ role: "user", content: [{ type: "text", text: "Now add c." }] },
			{ role: "assistant", content: [{ type: "tool_use", id: "t4", name: "_read", input: { path: "src/c.ts" } }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "t4", content: "", cache_control: mark }] },
		],
	});
	const group = (callId: string): Unit => ({ kind: "tool-call", turn: 3, callId, tool: "read", tokens: 10 });
	/** Every breakpoint, by where it sits: `system[1]`, `messages[4][0]`. */
	const breakpoints = (body: RequestBody): string[] => [
		...(body.tools ?? []).flatMap((block, at) => (block.cache_control ? [`tools[${at}]`] : [])),
		...(body.system ?? []).flatMap((block, at) => (block.cache_control ? [`system[${at}]`] : [])),
		...body.messages.flatMap((message, m) =>
			typeof message.content === "string" ? [] : message.content.flatMap((block, b) => (block.cache_control ? [`messages[${m}][${b}]`] : [])),
		),
	];
	const ids = (body: RequestBody) =>
		body.messages.flatMap((message) => (typeof message.content === "string" ? [] : message.content.map((block) => block.id ?? block.tool_use_id ?? block.text ?? block.type)));

	test("a cut tool-call group takes its call and its result, and drops the messages it empties", () => {
		const body = request();
		const location = locate(body, group("t1")) as Location;
		const after = cut(body, location);
		expect(ids(after)).toEqual([
			"<system-reminder>Today: 2026-10-16</system-reminder>", "Read src/a.ts.",
			"a is 1.",
			"Read src/b.ts.", "t2", "t3", "t2", "t3", "b is 2.",
			"Now add c.", "t4", "t4",
		]);
		expect(after.messages).toHaveLength(9);
	});

	test("sham and cut both lose the thinking after the unit and in the messages the cut empties; thinking before it stays", () => {
		const body = request();
		const t1 = locate(body, group("t1")) as Location;
		// s1 shares the message the cut empties; s2 comes after the unit.
		expect(ids(sham(body, t1))).toEqual([
			"<system-reminder>Today: 2026-10-16</system-reminder>", "Read src/a.ts.", "t1", "t1", "a is 1.",
			"Read src/b.ts.", "t2", "t3", "t2", "t3", "b is 2.",
			"Now add c.", "t4", "t4",
		]);
		(body.messages[7]?.content as BodyBlock[]).unshift({ type: "thinking", thinking: "", signature: "s3" });
		const t2 = locate(body, group("t2")) as Location;
		const kept = ["<system-reminder>Today: 2026-10-16</system-reminder>", "Read src/a.ts.", "thinking", "t1", "t1", "thinking", "a is 1.", "Read src/b.ts."];
		expect(ids(sham(body, t2))).toEqual([...kept, "t2", "t3", "t2", "t3", "b is 2.", "Now add c.", "t4", "t4"]);
		expect(ids(cut(body, t2))).toEqual([...kept, "t3", "t3", "b is 2.", "Now add c.", "t4", "t4"]);
		// A system unit changes the prefix of every message: they all lose their thinking, and nothing else.
		const pin = locate(body, { kind: "pin", pin: 1, text: "Use tabs.", tokens: 3 }) as Location;
		expect(ids(sham(body, pin))).toEqual(ids(body).filter((id) => id !== "thinking"));
		expect(cut(body, pin).messages).toEqual(sham(body, pin).messages);
	});

	test("a prose cut takes the prompt and the replies' text, and leaves the Turn's tool calls", () => {
		const body = request();
		const location = locate(body, { kind: "prose", turn: 4, text: "Read src/b.ts.", tokens: 10 }) as Location;
		expect(ids(cut(body, location))).toEqual([
			"<system-reminder>Today: 2026-10-16</system-reminder>", "Read src/a.ts.", "thinking", "t1", "t1", "thinking", "a is 1.",
			"t2", "t3", "t2", "t3",
			"Now add c.", "t4", "t4",
		]);
	});

	test("a Pin cut takes that Pin's section alone", () => {
		const body = request();
		const location = locate(body, { kind: "pin", pin: 1, text: "Use tabs.", tokens: 3 }) as Location;
		expect(cut(body, location).system?.[2]?.text).toBe(
			`${PINS_FRAMING}\n\n[pinned by the user: #2, 2 of 2]\nNo emoji.\n\n${opening}\n\n${EVICTION_NOTICE}`,
		);
	});

	test("an Opening cut takes the framing and the prompt, and leaves the Pins and the notice", () => {
		const body = request();
		const location = locate(body, { kind: "opening", turn: 0, text: "Build the budget table.", tokens: 6 }) as Location;
		expect(cut(body, location).system?.[2]?.text).toBe(`${pins}\n\n${EVICTION_NOTICE}`);
	});

	test("the sham removes nothing, and it and the cut carry the same breakpoints, one added before the unit", () => {
		const body = request();
		const location = locate(body, group("t2")) as Location;
		const shamBody = sham(body, location);
		const cutBody = cut(body, location);
		expect(ids(shamBody)).toEqual(ids(body));
		// Before the unit: Turn 4's prompt already carries one, so nothing is added.
		expect(breakpoints(shamBody)).toEqual(["system[1]", "messages[4][0]", "messages[10][0]"]);
		expect(breakpoints(cutBody)).toEqual(breakpoints(shamBody));
		const t1 = locate(body, group("t1")) as Location;
		// Thinking cannot carry one: the prompt before it does.
		expect(breakpoints(sham(body, t1))).toEqual(["system[1]", "messages[0][1]", "messages[4][0]", "messages[10][0]"]);
	});

	test("a request at 4 breakpoints stays at 4, the earliest dropped from both", () => {
		const body = request();
		(body.tools?.[0] as BodyBlock).cache_control = mark;
		const location = locate(body, group("t1")) as Location;
		expect(breakpoints(sham(body, location))).toEqual(["system[1]", "messages[0][1]", "messages[4][0]", "messages[10][0]"]);
		expect(breakpoints(cut(body, location))).toHaveLength(4);
	});

	test("a string-content message carries no breakpoint: the one before the unit goes on the last block that can", () => {
		const body: RequestBody = {
			system: [{ type: "text", text: "The harness prompt." }],
			messages: [
				{ role: "user", content: "Read src/a.ts." },
				{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "_read", input: { path: "src/a.ts" } }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "export const a = 1;" }] },
				{ role: "assistant", content: [{ type: "text", text: "a is 1." }] },
				{ role: "user", content: [{ type: "text", text: "Now add b." }] },
			],
		};
		const location = locate(body, group("t1")) as Location;
		expect(breakpoints(sham(body, location))).toEqual(["system[0]"]);
		expect(breakpoints(cut(body, location))).toEqual(["system[0]"]);
	});

	test("a tool result a later result repeats is duplicated; one nothing repeats is not", () => {
		const body = request();
		expect(duplicated(body, locate(body, group("t1")) as Location, group("t1"))).toBe(true);
		expect(duplicated(body, locate(body, group("t2")) as Location, group("t2"))).toBe(false);
	});

	test("a summary cut takes the block holding it, and the message it empties", () => {
		const summary = "The user asked for a budget table; it exists in src/budget.ts.";
		const body: RequestBody = {
			system: [{ type: "text", text: "The harness prompt.", cache_control: mark }],
			messages: [
				{ role: "user", content: [{ type: "text", text: `Summary of earlier work:\n${summary}` }] },
				{ role: "assistant", content: [{ type: "text", text: "Understood." }] },
				{ role: "user", content: [{ type: "text", text: "Now add totals." }] },
			],
		};
		const unit: Unit = { kind: "summary", text: summary, tokens: 15 };
		const location = locate(body, unit) as Location;
		expect(location.blocks).toEqual([{ message: 0, block: 0 }]);
		expect(cut(body, location).messages.map((message) => message.role)).toEqual(["assistant", "user"]);
	});

	test("a Turn cut takes its prompt, its replies' text and every tool call it made", () => {
		const body = request();
		const turn: Unit = { kind: "turn", turn: 4, text: "Read src/b.ts.", callIds: ["t2", "t3"], tokens: 20 };
		expect(ids(cut(body, locate(body, turn) as Location))).toEqual([
			"<system-reminder>Today: 2026-10-16</system-reminder>", "Read src/a.ts.", "thinking", "t1", "t1", "thinking", "a is 1.",
			"Now add c.", "t4", "t4",
		]);
		expect(locate(body, { ...turn, callIds: ["t2", "t9"] })).toBeUndefined();
	});

	test("a system message the cut leaves after an assistant reply leaves both bodies; one still after a user message stays", () => {
		const body: RequestBody = {
			system: [{ type: "text", text: "The harness prompt." }],
			messages: [
				{ role: "user", content: [{ type: "text", text: "Read a." }] },
				{ role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "x", name: "_read", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "a" }] },
				{ role: "system", content: [{ type: "text", text: "<system-reminder>todo</system-reminder>" }] },
				{ role: "assistant", content: [{ type: "text", text: "a is a." }] },
				{ role: "user", content: [{ type: "text", text: "Now b." }] },
			],
		};
		const x = locate(body, { kind: "tool-call", turn: 0, callId: "x", tool: "read", tokens: 5 }) as Location;
		expect(cut(body, x).messages.map((message) => message.role)).toEqual(["user", "assistant", "assistant", "user"]);
		expect(sham(body, x).messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
		const kept = structuredClone(body);
		(kept.messages[1] as { content: BodyBlock[] }).content.shift();
		const y = locate(kept, { kind: "tool-call", turn: 0, callId: "x", tool: "read", tokens: 5 }) as Location;
		expect(cut(kept, y).messages.map((message) => message.role)).toEqual(["user", "system", "assistant", "user"]);
	});

	test("a unit the request does not hold is unlocated", () => {
		expect(locate(request(), group("t9"))).toBeUndefined();
		expect(locate(request(), { kind: "pin", pin: 7, text: "Gone.", tokens: 1 })).toBeUndefined();
	});

	test("a tool call counted alone is its own messages, siblings kept and thinking left out, against them without it", () => {
		const body = request();
		const dot = { type: "text", text: "." };
		const t2 = { type: "tool_use", id: "t2", name: "_read", input: { path: "src/b.ts" } };
		const t3 = { type: "tool_use", id: "t3", name: "_read", input: { path: "src/a.ts", i: "again" } };
		const r2 = { type: "tool_result", tool_use_id: "t2", content: "export const b = 2;" };
		const r3 = { type: "tool_result", tool_use_id: "t3", content: "export const a = 1;" };
		const shared = alone(body, locate(body, group("t2")) as Location, group("t2"));
		expect(shared.unit).toEqual({
			model: "claude-opus-5-5",
			tools: body.tools,
			messages: [
				{ role: "user", content: [dot] },
				{ role: "assistant", content: [t2, t3] },
				{ role: "user", content: [r2, r3] },
			],
		});
		expect(shared.placeholder).toEqual({
			model: "claude-opus-5-5",
			tools: body.tools,
			messages: [
				{ role: "user", content: [dot] },
				{ role: "assistant", content: [t3] },
				{ role: "user", content: [r3] },
			],
		});
		// Alone in its messages: they go with it, so their framing counts.
		const single = alone(body, locate(body, group("t1")) as Location, group("t1"));
		expect(single.unit.messages).toEqual([
			{ role: "user", content: [dot] },
			{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "_read", input: { path: "src/a.ts" } }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "export const a = 1;" }] },
		]);
		expect(single.placeholder.messages).toEqual([{ role: "user", content: [dot] }]);
	});

	test("any other unit counted alone is its blocks in their own messages, against the same messages holding '.'", () => {
		const body = request();
		const dot = { type: "text", text: "." };
		// A prose unit opens with its own prompt; its breakpoint is not carried.
		const unit: Unit = { kind: "prose", turn: 4, text: "Read src/b.ts.", tokens: 10 };
		const prose = alone(body, locate(body, unit) as Location, unit);
		expect(prose.unit).toEqual({
			model: "claude-opus-5-5",
			tools: body.tools,
			messages: [
				{ role: "user", content: [{ type: "text", text: "Read src/b.ts." }] },
				{ role: "assistant", content: [{ type: "text", text: "b is 2." }] },
			],
		});
		expect(prose.placeholder.messages).toEqual([
			{ role: "user", content: [dot] },
			{ role: "assistant", content: [dot] },
		]);
		// A system span is one user message of its text.
		const pinUnit: Unit = { kind: "pin", pin: 1, text: "Use tabs.", tokens: 3 };
		const pin = alone(body, locate(body, pinUnit) as Location, pinUnit);
		expect(pin.unit.messages).toEqual([{ role: "user", content: [{ type: "text", text: "[pinned by the user: #1, 1 of 2]\nUse tabs." }] }]);
		expect(pin.placeholder.messages).toEqual([{ role: "user", content: [dot] }]);
	});
});
