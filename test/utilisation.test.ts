import { describe, expect, test } from "bun:test";

import type { Window } from "../scripts/measures.ts";
import { type CallUtilisation, type Rule, utilisationOf } from "../scripts/utilisation.ts";
import type { Compaction, JournalTurn, MessageAddress } from "../src/journal.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { approximateTokens } from "../src/tokens.ts";

const CWD = "/work/run-3";

const user = (text: string): HarnessMessage => ({ role: "user", content: [{ type: "text", text }] });
const reply = (...content: unknown[]): HarnessMessage => ({
	role: "assistant",
	content: content as HarnessMessage["content"],
	usage: { input: 10, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 50, cost: { total: 0.01 } },
});
const said = (text: string) => ({ type: "text", text });
const call = (id: string, name: string, args: unknown) => ({ type: "toolCall", id, name, arguments: args });
const result = (id: string, toolName: string, text: string): HarnessMessage => ({
	role: "toolResult",
	toolCallId: id,
	toolName,
	content: [{ type: "text", text }],
});
/** A tool call and its result, as an assistant message and the result after it. */
const ran = (id: string, name: string, args: unknown, text: string) => [reply(call(id, name, args)), result(id, name, text)];

/** Turn `index`: its prompt, then `messages`; each assistant message is the next Call. */
function turn(index: number, prompt: string, ...messages: HarnessMessage[]): JournalTurn {
	const all = [user(prompt), ...messages];
	let at = 0;
	const calls = all.map((message, position) => (message.role === "assistant" && position > 1 ? ++at : at));
	return { turnIndex: index, prompt, messages: all, callCount: at + 1, calls };
}

/** A window with Turns `tail` verbatim, its first carried message `from` when given. */
const tail = (current: number, turns: number[], extra: Partial<Exclude<Window, "unknown">> = {}): Window => ({
	pins: [],
	tail: { turns },
	current,
	...extra,
});

/** One measured Call's figures; fails the test when the Call was not measured. */
function measured(figure: CallUtilisation | "empty" | "unknown" | undefined): CallUtilisation {
	if (figure === undefined || typeof figure === "string") throw new Error(`the Call was not measured: ${figure}`);
	return figure;
}

const at = (turn: number, message: number): MessageAddress => ({ turn, message });
const none = new Map<number, string>();

describe("the units Utilisation judges", () => {
	const turns = [
		turn(0, "Remember the codeword HERON-4."),
		turn(1, "Look at the config.", ...ran("t1a", "read", { path: "config.toml" }, "port = 8080"), reply(said("Port 8080."))),
		turn(
			2,
			"Run the tests.",
			...ran("t2a", "bash", { command: "bun test" }, "3 pass"),
			...ran("t2b", "write", { path: "xd://recall_earlier_turns", content: '{"query": "codeword"}' }, "HERON-4"),
			reply(said("All pass.")),
		),
	];

	test("the Call's own Turn is never judged, its earlier results included", () => {
		const third = at(2, 5);
		const { calls } = utilisationOf(
			turns,
			[
				{ address: third, window: tail(2, [0, 1, 2]) },
				{ address: third, window: tail(2, [0, 1]) },
			],
			[],
			none,
			CWD,
		);

		expect(measured(calls[0]).judged).toBe(measured(calls[1]).judged);
		expect(measured(calls[0]).byKind.pull).toBeUndefined();
	});

	test("the Opening and Pins are not judged", () => {
		const pins = new Map([[1, "Release name PIN-23"]]);
		const second = at(2, 1);
		const { calls } = utilisationOf(
			turns,
			[
				{ address: second, window: tail(2, [1], { opening: 0, pins: [1] }) },
				{ address: second, window: tail(2, [1]) },
			],
			[],
			pins,
			CWD,
		);

		expect(measured(calls[0])).toEqual(measured(calls[1]));
		expect(Object.keys(measured(calls[0]).byKind).sort()).toEqual(["prose", "tool-call"]);
	});

	test("an earlier Pull's result is judged as a Pull result", () => {
		const later = [...turns, turn(3, "Again.", reply(said("Done.")))];
		const { calls } = utilisationOf(later, [{ address: at(3, 1), window: tail(3, [2]) }], [], none, CWD);

		expect(measured(calls[0]).byKind.pull?.judged).toBeGreaterThan(0);
		expect(measured(calls[0]).byKind["tool-call"]?.judged).toBeGreaterThan(0);
	});

	test("a plain-omp summary is judged as a summary", () => {
		const compactions: Compaction[] = [
			{ id: "c1", before: at(2, 0), firstKept: at(1, 0), summary: "The codeword is HERON-4." },
		];
		const { calls } = utilisationOf(
			turns,
			[{ address: at(2, 1), window: tail(2, [1], { summary: "c1" }) }],
			compactions,
			none,
			CWD,
		);

		expect(measured(calls[0]).byKind.summary?.judged).toBeGreaterThan(0);
	});
});

/**
 * Turn 0 runs `echo 0` … `echo n−1`, each result `notes[i]` or `entry i`;
 * its prompt is `prompt`. A Call carrying it `from` its first tool call
 * judges exactly those n tool-call units.
 */
function entries(n: number, notes: Record<number, string> = {}, prompt = "Collect the entries."): JournalTurn {
	const messages = Array.from({ length: n }, (_, i) => ran(`e${i}`, "bash", { command: `echo ${i}` }, notes[i] ?? `entry ${i}`));
	return turn(0, prompt, ...messages.flat());
}

/** A Call of Turn 1 carrying Turn 0's tool calls from the `first`-th on. */
const carrying = (first: number, extra: Partial<Exclude<Window, "unknown">> = {}): Window =>
	tail(1, [0], { ...extra, tail: { turns: [0], from: at(0, 2 * first + 1) } });

/**
 * The Utilisation of Turn 1's first Call, whose reply is `next` and whose
 * window carries Turn 0's tool calls; with it, the judged tokens of Turn 0's
 * last tool call alone, which every fixture here makes the one that should be Used.
 */
function judge(
	zero: JournalTurn,
	next: HarnessMessage,
	options: { prompt?: string; rule?: Rule; pins?: Map<number, string>; window?: Partial<Exclude<Window, "unknown">> } = {},
): { figure: CallUtilisation; last: number } {
	const turns = [zero, turn(1, options.prompt ?? "Go on.", next)];
	const last = (zero.messages.length - 1) / 2 - 1;
	const { calls } = utilisationOf(
		turns,
		[
			{ address: at(1, 1), window: carrying(0, options.window) },
			{ address: at(1, 1), window: carrying(last) },
		],
		[],
		options.pins ?? none,
		CWD,
		options.rule,
	);
	return { figure: measured(calls[0]), last: measured(calls[1]).judged };
}

describe("the next action of a Call", () => {
	const port = entries(60, { 59: "PORT-8817 opened" });

	test("a value only in the thinking makes nothing Used", () => {
		const thought = judge(port, reply({ type: "thinking", thinking: "Use PORT-8817." }, said("Checking.")));
		const spoken = judge(port, reply(said("Use PORT-8817.")));

		expect(thought.figure.used).toBe(0);
		expect(spoken.figure.used).toBe(spoken.last);
	});

	test("the first tool call is the action, ahead of the reply text and later calls", () => {
		const prose = "Reading the notes before we change the scale of the chart";
		const zero = turn(
			0,
			"Start.",
			...ran("n0", "bash", { command: "ls" }, "src/main.ts"),
			...ran("n1", "bash", { command: "cat" }, prose),
			...ran("n2", "bash", { command: "find" }, "see notes/scale.md"),
		);
		const next = reply(
			said(prose),
			call("r", "read", { path: "notes/scale.md" }),
			call("g", "grep", { pattern: "main", path: "src/main.ts" }),
		);
		const { figure, last } = judge(zero, next);

		expect(figure.used).toBe(last);
	});

	test("a reply with neither a tool call nor text is measured, with nothing Used", () => {
		const { figure } = judge(port, reply({ type: "thinking", thinking: "PORT-8817" }));

		expect(figure.judged).toBeGreaterThan(0);
		expect(figure.used).toBe(0);
	});

	test("a call through omp's tool device is the tool it ran, with its parsed content", () => {
		const zero = entries(60, { 58: "docs at xd://recall_earlier_turns", 59: "QUILL_9 listens on 8817" });
		const next = reply(call("x", "write", { path: "xd://recall_earlier_turns", content: '{"query": "QUILL_9 8817"}' }));
		const { figure, last } = judge(zero, next);

		expect(figure.used).toBe(last);
	});
});

describe("the path signal", () => {
	/** Turn 0 has a decoy tool call, then one whose result is `text`. */
	const mention = (text: string) =>
		turn(0, "Start.", ...ran("d", "bash", { command: "ls" }, "nothing here"), ...ran("m", "bash", { command: "cat" }, text));
	const reading = (path: string) => reply(call("r", "read", { path }));

	test("an absolute path in the action fires on its relative mention", () => {
		const { figure, last } = judge(mention("patched src/stats.ts today"), reading(`${CWD}/src/stats.ts:1-40`));

		expect(figure.used).toBe(last);
	});

	test("a relative path in the action fires on an absolute mention", () => {
		const { figure, last } = judge(mention(`wrote ${CWD}/src/stats.ts.`), reading("./src/stats.ts"));

		expect(figure.used).toBe(last);
	});

	test("a path inside a longer name does not fire", () => {
		expect(judge(mention("see src/a.tsx"), reading("src/a.ts")).figure.used).toBe(0);
		expect(judge(mention("see src/a.ts.bak"), reading("src/a.ts")).figure.used).toBe(0);
		expect(judge(mention("see lib-src/a.ts"), reading("src/a.ts")).figure.used).toBe(0);
	});

	test("the working directory and `.` never fire", () => {
		expect(judge(mention(`ran in ${CWD}/x and ./ and .`), reading(CWD)).figure.used).toBe(0);
		expect(judge(mention("ran in . and ./x"), reply(call("g", "grep", { pattern: "zz", path: "." }))).figure.used).toBe(0);
	});

	test("edit names its files, grep and glob their path, and a glob pattern is no path", () => {
		const edit = reply(call("e", "edit", { input: "[src/b.ts#1A2B]\nPUT 1.=1:\n+x\n[src/c.ts#3C4D]\nCUT 2.=2" }));
		const edited = judge(mention("changed src/c.ts"), edit);
		const grepped = judge(mention("lib/util.ts:12: zz"), reply(call("g", "grep", { pattern: "zz", path: "lib/util.ts" })));
		const globbed = judge(mention("docs/a.md"), reply(call("g", "glob", { path: "docs" })));
		const pattern = judge(mention("matched src/*.ts"), reply(call("g", "glob", { path: "src/*.ts" })));

		expect(edited.figure.used).toBe(edited.last);
		expect(grepped.figure.used).toBe(grepped.last);
		expect(globbed.figure.used).toBe(globbed.last);
		expect(pattern.figure.used).toBe(0);
	});
});

describe("the copied-span signal", () => {
	const greek = turn(
		0,
		"Start.",
		...ran("d", "bash", { command: "ls" }, "nothing here"),
		...ran("m", "bash", { command: "cat" }, "alpha beta gamma delta epsilon zeta eta theta iota"),
	);
	const writing = (content: string) => reply(call("w", "write", { path: "out.txt", content }));

	test("8 tokens the unit holds in order fire", () => {
		const { figure, last } = judge(greek, writing("so: alpha beta gamma delta epsilon zeta eta theta!"));

		expect(figure.used).toBe(last);
	});

	test("7 tokens do not fire at s = 8, and do at s = 6", () => {
		const seven = writing("so: alpha beta gamma delta epsilon zeta eta!");

		expect(judge(greek, seven).figure.used).toBe(0);
		const six = judge(greek, seven, { rule: { s: 6, k: 2 } });
		expect(six.figure.used).toBe(six.last);
	});

	test("identical content in two units makes both Used", () => {
		const twice = turn(
			0,
			"Start.",
			...ran("a", "bash", { command: "cat" }, "alpha beta gamma delta epsilon zeta eta theta iota"),
			...ran("b", "bash", { command: "cat" }, "alpha beta gamma delta epsilon zeta eta theta iota"),
		);
		const { figure } = judge(twice, writing("alpha beta gamma delta epsilon zeta eta theta"));

		expect(figure.used).toBe(figure.judged);
	});
});

describe("the rare-identifiers signal", () => {
	const quill = entries(60, { 59: "QUILL_9 listens on 8817" });
	const deploying = (command: string) => reply(call("b", "bash", { command }));

	test("two rare items fire", () => {
		const { figure, last } = judge(quill, deploying("deploy QUILL_9 --port 8817"));

		expect(figure.used).toBe(last);
	});

	test("an item the current Turn holds does not count; the one left fires only at k = 1", () => {
		const prompt = "Use port 8817.";
		const one = judge(quill, deploying("deploy QUILL_9 --port 8817"), { prompt, rule: { s: 8, k: 1 } });

		expect(judge(quill, deploying("deploy QUILL_9 --port 8817"), { prompt }).figure.used).toBe(0);
		expect(one.figure.used).toBe(one.last);
	});

	test("an item in 10 of 60 units does not count", () => {
		const common = entries(60, {
			...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, `COMMON_1 entry ${i}`])),
			59: "QUILL_9 with COMMON_1",
		});

		expect(judge(common, deploying("deploy QUILL_9 COMMON_1")).figure.used).toBe(0);
	});

	test("an item in the carried Opening or a carried Pin does not count", () => {
		const opened = entries(60, { 59: "QUILL_9 listens on 8817" }, "Port 8817 is reserved.");
		const pins = new Map([[1, "Port 8817"]]);

		expect(judge(opened, deploying("deploy QUILL_9 8817"), { window: { opening: 0 } }).figure.used).toBe(0);
		expect(judge(quill, deploying("deploy QUILL_9 8817"), { pins, window: { pins: [1] } }).figure.used).toBe(0);
		// Not carried, they exclude nothing.
		expect(judge(opened, deploying("deploy QUILL_9 8817")).figure.used).toBeGreaterThan(0);
	});

	test("prose words are not items", () => {
		const prose = entries(60, { 59: "deploy the release candidate tonight" });

		expect(judge(prose, deploying("deploy release tonight"), { rule: { s: 8, k: 1 } }).figure.used).toBe(0);
	});

	test("an apostrophe opens no literal", () => {
		const quoted = entries(60, { 59: "don't trust QUILL_9 won't" });

		expect(judge(quoted, deploying("don't trust QUILL_9 won't")).figure.used).toBe(0);
	});

	test("an action's raw argument meets a unit's quoted literal", () => {
		const literal = entries(60, { 59: 'target "deploy-east-west" ready' });
		const { figure, last } = judge(literal, deploying("deploy-east-west"), { rule: { s: 8, k: 1 } });

		expect(figure.used).toBe(last);
	});
});

/** A tool call and its result whose tool-call unit is estimated at exactly `tokens`, its result opening with `text`. */
function sized(id: string, text: string, tokens: number): HarnessMessage[] {
	for (let pad = 0; pad < 4 * tokens; pad++) {
		const [asked, answer] = ran(id, "bash", { command: id }, `${text} ${"x".repeat(pad)}`) as [HarnessMessage, HarnessMessage];
		if (approximateTokens([{ role: "assistant", content: asked.content }, answer]) === tokens) return [asked, answer];
	}
	throw new Error(`no padding makes ${id} ${tokens} tokens`);
}

describe("Utilisation per Call and per Run", () => {
	test("a Run's Utilisation is token-weighted over its measured Calls", () => {
		const zero = turn(
			0,
			"Start.",
			...sized("u0", "a.txt", 800),
			...sized("u1", "b.txt", 1200),
			...sized("u2", "a.txt", 100),
			...sized("u3", "b.txt", 900),
		);
		const reads = reply(call("r", "read", { path: "a.txt" }));
		const one = turn(1, "Read it.", reads, result("r", "read", "ok"), reply(call("s", "read", { path: "a.txt" })));
		const { calls, run } = utilisationOf(
			[zero, one],
			[
				{ address: at(1, 1), window: tail(1, [0], { tail: { turns: [0], from: at(0, 5) } }) },
				{ address: at(1, 3), window: tail(1, [0], { tail: { turns: [0], from: at(0, 1) } }) },
			],
			[],
			none,
			CWD,
		);

		expect(measured(calls[0])).toMatchObject({ used: 100, judged: 1000 });
		expect(measured(calls[1])).toMatchObject({ used: 900, judged: 3000 });
		expect(run).toMatchObject({ used: 1000, judged: 4000 });
		expect(run.used / run.judged).toBe(0.25);
	});

	test("Calls with nothing to judge and with an unknown window are counted apart and add nothing", () => {
		const turns = [turn(0, "Start.", ...ran("a", "bash", { command: "ls" }, "a.txt")), turn(1, "Go.", reply(said("ok")))];
		const { calls, run } = utilisationOf(
			turns,
			[
				{ address: at(0, 1), window: tail(0, []) },
				{ address: at(1, 1), window: "unknown" },
				{ address: at(1, 1), window: tail(1, [0]) },
			],
			[],
			none,
			CWD,
		);

		expect(calls.slice(0, 2)).toEqual(["empty", "unknown"]);
		expect(run.calls).toEqual({ measured: 1, empty: 1, unknown: 1 });
		expect(run.judged).toBe(measured(calls[2]).judged);
		expect(run.byKind.summary).toEqual({ used: 0, judged: 0 });
	});
});
