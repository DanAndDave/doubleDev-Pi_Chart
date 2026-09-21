import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DocStore } from "../src/doc-store.ts";
import { GraphStore, PINNED_GRAPHIFY } from "../src/graph-store.ts";
import { SpecStore } from "../src/spec-store.ts";

import {
	MemoryAccounting,
	type AccountingStore,
	type CallAddress,
	type Measurement,
	type TailSource,
} from "../src/accounting.ts";
import { assemble, type Pack } from "../src/assembler.ts";
import {
	DEFAULT_RETRIEVAL_DEADLINE_MS,
	DEFAULT_TAIL_TURNS,
	loadConfig,
} from "../src/config.ts";
import { register, type Dependencies } from "../src/extension.ts";
import { MemoryTurnSource } from "../src/thread-store.ts";
import type {
	BranchEntry,
	CommandDefinition,
	ToolDefinition,
	ContextHandler,
	ExtensionAPI,
	HandlerContext,
	LifecycleHandler,
} from "../src/harness.ts";
import type { ContextSnapshot } from "../src/messages.ts";
import {
	branchOf,
	COMPACTION_FIXTURE,
	JOURNAL_FIXTURE,
	settings,
} from "./fixtures.ts";

interface Recorded extends CallAddress {
	pack?: Pack;
	unassembled?: boolean;
	tailSource?: TailSource;
}

interface Harness {
	context: ContextHandler;
	sessionStart: LifecycleHandler;
	agentEnd: LifecycleHandler;
	sessionShutdown: LifecycleHandler;
	reported: string[];
	recorded: Recorded[];
	measured: Measurement[];
	commands: Record<string, CommandDefinition>;
	tools: Record<string, ToolDefinition>;
	shown: string[];
	/** Awaits the background accounting writes this extension started. */
	settle: () => Promise<void>;
}

/** Overrides as a test writes them: the config is merged, not replaced. */
type Overrides = Partial<Omit<Dependencies, "config">> & {
	config?: Partial<Dependencies["config"]>;
};

function harness(overrides: Overrides = {}): Harness {
	let context: ContextHandler | undefined;
	let sessionStart: LifecycleHandler | undefined;
	let agentEnd: LifecycleHandler | undefined;
	let sessionShutdown: LifecycleHandler | undefined;

	const commands: Record<string, CommandDefinition> = {};
	const tools: Record<string, ToolDefinition> = {};
	const shown: string[] = [];
	const pi: ExtensionAPI = {
		on(event: string, handler: ContextHandler | LifecycleHandler) {
			if (event === "context") context = handler as ContextHandler;
			if (event === "session_start") sessionStart = handler as LifecycleHandler;
			if (event === "agent_end") agentEnd = handler as LifecycleHandler;
			if (event === "session_shutdown") {
				sessionShutdown = handler as LifecycleHandler;
			}
		},
		registerCommand(name: string, command: CommandDefinition) {
			commands[name] = command;
		},
		registerTool(tool: ToolDefinition) {
			tools[tool.name] = tool;
		},
	} as ExtensionAPI;

	const reported: string[] = [];
	const recorded: Recorded[] = [];
	const measured: Harness["measured"] = [];

	const writes: Promise<unknown>[] = [];
	function track<T>(write: Promise<T>): Promise<T> {
		writes.push(write.catch(() => undefined));
		return write;
	}

	const accounting: AccountingStore = {
		recordPack: (_conversationId, address, pack, tailSource) =>
			track(
				Promise.resolve(recorded.push({ ...address, pack, tailSource })).then(
					() => {},
				),
			),
		recordUnassembled: (_conversationId, address) =>
			track(
				Promise.resolve(recorded.push({ ...address, unassembled: true })).then(
					() => {},
				),
			),
		recordMeasurements: (_conversationId, measurements) =>
			track(Promise.resolve(measured.push(...measurements)).then(() => {})),
		readAccounting: async () => [],
	};

	const { config: configOverrides, ...rest } = overrides;
	register(pi, {
		background: (work) => track(work),
		assemble,
		turns: new MemoryTurnSource(),
		accounting,
		report: (message) => reported.push(message),
		show: (text) => shown.push(text),
		...rest,
		// After the rest, so a test's partial config merges over these
		// defaults rather than replacing them.
		config: settings({
			tailTurns: DEFAULT_TAIL_TURNS,
			recallTurns: 0,
			recallMaxDistance: 1,
			docConcepts: 0,
			docMaxDistance: 0.5,
			graphSymbols: 0,
			graphExtract: false,
			specsVerify: false,
			docBundle: "/unused",
			...configOverrides,
		}),
	});

	if (!context || !sessionStart || !agentEnd || !sessionShutdown) {
		throw new Error("extension did not register its handlers");
	}

	return {
		context,
		sessionStart,
		sessionShutdown,
		agentEnd,
		reported,
		recorded,
		measured,
		commands,
		tools,
		shown,
		settle: async () => {
			// Drains the writes the extension started, plus the reporting
			// microtask chained onto each, without waiting on the clock.
			while (writes.length > 0) await writes.shift();
			await Promise.resolve();
		},
	};
}

/** A completed Turn as the session records it: a prompt and an answered call. */
function answered(promptTokens: number, prompt = "earlier"): BranchEntry[] {
	return [
		{ type: "message", message: { role: "user", content: prompt } },
		{
			type: "message",
			message: {
				role: "assistant",
				contextSnapshot: { promptTokens, nonMessageTokens: 90 },
			},
		},
	];
}

function ctx(branch: BranchEntry[] = [], extra: Partial<HandlerContext> = {}) {
	return {
		sessionManager: { getSessionId: () => "conv-1", getBranch: () => branch },
		...extra,
	} satisfies HandlerContext;
}

describe("context handler", () => {
	test("replaces the message array with the assembled pack", async () => {
		const cm = harness();

		const result = await cm.context(
			{ messages: [{ role: "user", content: "hello" }] },
			ctx(),
		);

		expect(result?.messages).toEqual([{ role: "user", content: "hello" }]);
	});

	test("an assembly failure leaves the turn unmodified and is reported", async () => {
		const cm = harness({
			assemble: () => {
				throw new Error("boom");
			},
		});

		const result = await cm.context(
			{ messages: [{ role: "user", content: "hello" }] },
			ctx(),
		);
		await cm.settle();

		expect(result).toBeUndefined();
		expect(cm.reported.join()).toContain("boom");
		expect(cm.recorded[0]?.unassembled).toBe(true);
	});

	test("an accounting failure leaves the pack intact and the turn running", async () => {
		const cm = harness({
			accounting: {
				async recordPack() {
					throw new Error("disk full");
				},
				async recordUnassembled() {},
				async recordMeasurements() {},
				async readAccounting() {
					return [];
				},
			},
		});

		const result = await cm.context(
			{ messages: [{ role: "user", content: "hello" }] },
			ctx(),
		);
		await cm.settle();

		expect(result?.messages).toHaveLength(1);
		expect(cm.reported.join()).toContain("disk full");
	});

	test("does not wait for accounting before handing back the pack", async () => {
		const { promise: blocked, resolve: released } = Promise.withResolvers<void>();
		const cm = harness({
			accounting: {
				recordPack: () => blocked,
				async recordUnassembled() {},
				async recordMeasurements() {},
				async readAccounting() {
					return [];
				},
			},
		});

		const result = await cm.context(
			{ messages: [{ role: "user", content: "hello" }] },
			ctx(),
		);

		expect(result?.messages).toHaveLength(1);
		released();
	});

	test("addresses each call to its turn, so a tool loop stays one turn", async () => {
		const cm = harness();
		// The prompt is in the branch already, which is what a tool loop's
		// second and later calls look like.
		const branch = answered(100, "one");

		await cm.context({ messages: [{ role: "user", content: "one" }] }, ctx(branch));
		branch.push({
			type: "message",
			message: {
				role: "assistant",
				contextSnapshot: { promptTokens: 110, nonMessageTokens: 90 },
			},
		});
		await cm.context({ messages: [{ role: "user", content: "one" }] }, ctx(branch));
		await cm.settle();

		expect(cm.recorded.map((entry) => [entry.turnIndex, entry.callIndex])).toEqual([
			[0, 1],
			[0, 2],
		]);
	});

	test("turns after a clear do not collide with the ones before it", async () => {
		const cm = harness();
		// Clearing does not drop history: the branch keeps the earlier prompt
		// and gains a boundary marker, while the new prompt has not landed yet.
		const branch = answered(100, "first");
		await cm.context({ messages: [{ role: "user", content: "first" }] }, ctx(branch));

		branch.push({ type: "reset_boundary" });
		await cm.context({ messages: [{ role: "user", content: "after" }] }, ctx(branch));
		await cm.settle();

		expect(cm.recorded.map((entry) => entry.turnIndex)).toEqual([0, 1]);
	});

	test("numbers turns from the session, so a resumed conversation does not restart", async () => {
		const cm = harness();
		const resumed: BranchEntry[] = [...answered(100), ...answered(110)];

		await cm.context({ messages: [{ role: "user", content: "third" }] }, ctx(resumed));
		await cm.settle();

		expect(cm.recorded[0]).toMatchObject({ turnIndex: 2, callIndex: 0 });
	});

	test("a prompt the branch has not recorded yet still starts a new turn", async () => {
		const cm = harness();
		// The session lags by one prompt, which is what a resumed conversation
		// looks like at the moment the context event fires.
		const lagging = answered(100);

		await cm.context(
			{
				messages: [
					{ role: "user", content: "first" },
					{ role: "assistant", content: "answered" },
					{ role: "user", content: "second" },
				],
			},
			ctx(lagging),
		);
		await cm.settle();

		expect(cm.recorded[0]).toMatchObject({ turnIndex: 1, callIndex: 0 });
	});
});

describe("a pack approaching its ceiling", () => {
	/** A prompt of roughly `tokens` estimated tokens. */
	const prompt = (tokens: number) => ({
		role: "user" as const,
		content: "z".repeat(tokens * 4),
	});

	test("says so once when a call crosses the configured share", async () => {
		const cm = harness({ config: { packTokens: 1000, packWarnShare: 0.75 } });

		await cm.context({ messages: [prompt(800)] }, ctx());
		await cm.context({ messages: [prompt(800)] }, ctx());
		await cm.settle();

		const warnings = cm.reported.filter((line) =>
			line.includes("approaching their ceiling"),
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("of 1000 tokens");
	});

	test("says nothing while packs stay under the share", async () => {
		const cm = harness({ config: { packTokens: 1000, packWarnShare: 0.75 } });

		await cm.context({ messages: [prompt(100)] }, ctx());
		await cm.settle();

		expect(cm.reported.filter((line) => line.includes("ceiling"))).toEqual([]);
	});

	test("reports a pack that could not be brought under its ceiling", async () => {
		const cm = harness({ config: { packTokens: 200, packWarnShare: 0.75 } });

		// A prompt is never shortened and the current Turn is never dropped,
		// so this pack goes out over budget and must say so.
		const result = await cm.context({ messages: [prompt(900)] }, ctx());
		await cm.settle();

		expect(result?.messages).toHaveLength(1);
		expect(cm.reported.some((line) => line.includes("exceeds its ceiling"))).toBe(
			true,
		);
	});

	test("a reporter that throws neither alters the pack nor fails the turn", async () => {
		const cm = harness({
			config: { packTokens: 1000, packWarnShare: 0.75 },
			report: () => {
				throw new Error("nowhere to report");
			},
		});

		const result = await cm.context({ messages: [prompt(800)] }, ctx());
		await cm.settle();

		expect(result?.messages).toEqual([prompt(800)]);
	});
});

describe("memory backend check", () => {
	test("reports loudly when the harness memory backend is active", async () => {
		const cm = harness();

		await cm.sessionStart(
			{},
			ctx([], { memory: { status: () => ({ backend: "mnemopi", active: true }) } }),
		);

		expect(cm.reported.join()).toContain("mnemopi");
	});

	test("stays quiet when the backend is off", async () => {
		const cm = harness();

		await cm.sessionStart(
			{},
			ctx([], { memory: { status: () => ({ backend: "off", active: false }) } }),
		);

		expect(cm.reported).toEqual([]);
	});
});

describe("measurement reconciliation", () => {
	test("addresses every reported window to the call that produced it", async () => {
		const cm = harness();

		await cm.agentEnd({}, ctx([...answered(100), ...answered(120)]));
		await cm.settle();

		expect(cm.measured).toEqual([
			{ turnIndex: 0, callIndex: 0, snapshot: { promptTokens: 100, nonMessageTokens: 90 } },
			{ turnIndex: 1, callIndex: 0, snapshot: { promptTokens: 120, nonMessageTokens: 90 } },
		]);
	});

	test("does not re-record measurements it has already written", async () => {
		const cm = harness();
		const branch = answered(100);
		const session = ctx(branch);

		await cm.agentEnd({}, session);
		branch.push(...answered(120));
		await cm.agentEnd({}, session);
		await cm.settle();

		expect(cm.measured.map((entry) => entry.snapshot.promptTokens)).toEqual([
			100, 120,
		]);
	});
});

describe("the verbatim tail", () => {
	const currentOnly = [{ role: "user", content: "current" }];

	test("comes from the thread store when it has the conversation", async () => {
		const store = new MemoryTurnSource();
		await store.ingest("conv-1", [
			{
				turnIndex: 0,
				prompt: "stored prompt",
				messages: [
					{ role: "user", content: "stored prompt" },
					{ role: "assistant", content: "stored answer" },
				],
				callCount: 1,
				calls: [0, 0],
			},
		]);
		const cm = harness({ turns: store });

		// The harness has forgotten the earlier turn; the store has not.
		const result = await cm.context({ messages: currentOnly }, ctx());
		await cm.settle();

		expect(result?.messages.map((message) => message.content)).toEqual([
			"stored prompt",
			"stored answer",
			"current",
		]);
		expect(cm.recorded[0]?.tailSource).toBe("thread-store");
	});

	test("falls back to the harness's own history when the store rejects", async () => {
		const cm = harness({
			turns: {
				recentTurns: () => Promise.reject(new Error("connection refused")),
			},
		});

		const result = await cm.context(
			{
				messages: [
					{ role: "user", content: "earlier" },
					{ role: "assistant", content: "answered" },
					{ role: "user", content: "current" },
				],
			},
			ctx(),
		);
		await cm.settle();

		expect(result?.messages.map((message) => message.content)).toEqual([
			"earlier",
			"answered",
			"current",
		]);
		expect(cm.reported.join()).toContain("connection refused");
	});

	test("records that a fallback tail did not come from the store", async () => {
		const cm = harness({
			turns: {
				recentTurns: () => Promise.reject(new Error("connection refused")),
			},
		});

		await cm.context({ messages: currentOnly }, ctx());
		await cm.settle();

		expect(cm.recorded[0]?.tailSource).toBe("harness-fallback");
	});

	test("an empty store is not treated as a failure", async () => {
		const cm = harness({ turns: new MemoryTurnSource() });

		const result = await cm.context({ messages: currentOnly }, ctx());
		await cm.settle();

		expect(result?.messages).toHaveLength(1);
		expect(cm.reported).toEqual([]);
	});
});

describe("recall wiring", () => {
	const conversation = [{ role: "user", content: "what did we decide" }];

	test("a pack draws recall from the store, attributed as its own part", async () => {
		const cm = harness({
			config: { tailTurns: 8, recallTurns: 2, recallMaxDistance: 1, docConcepts: 0, docMaxDistance: 0.5, docBundle: "/unused", graphSymbols: 0, graphExtract: false, specsVerify: false },
			recall: {
				similarTurns: async () => ({
					turns: [
						{
							turnIndex: 3,
							turn: {
								prompt: "we decided to cache",
								messages: [{ role: "user", content: "we decided to cache" }],
							},
						},
					],
					rejected: 0, misses: [], unsearched: 0,
				}),
			},
		});

		await cm.context({ messages: conversation }, ctx());
		await cm.settle();

		const sources = cm.recorded[0]?.pack?.parts.map((part) => part.source);
		expect(sources).toContain("recalled");
		expect(sources).toContain("current-turn");
	});

	test("a retrieval failure costs the recollections, not the turn", async () => {
		const cm = harness({
			config: { tailTurns: 8, recallTurns: 2, recallMaxDistance: 1, docConcepts: 0, docMaxDistance: 0.5, docBundle: "/unused", graphSymbols: 0, graphExtract: false, specsVerify: false },
			recall: {
				similarTurns: () => Promise.reject(new Error("index offline")),
			},
		});

		const result = await cm.context({ messages: conversation }, ctx());
		await cm.settle();

		expect(result?.messages).toHaveLength(1);
		expect(cm.reported.join()).toContain("index offline");
		// Nothing to explain from, and nothing invented to explain with.
		const recalled = cm.recorded[0]?.pack?.parts.find(
			(part) => part.source === "recalled",
		);
		expect(recalled?.excludedCandidates).toEqual([]);
		expect(recalled?.absent).toBe("failed");
	});

	test("what the curated part refused reaches the accounting", async () => {
		const cm = harness({
			config: { docConcepts: 2, docMaxDistance: 0.4 },
			docs: {
				indexConcepts: async () => ({ embedded: 0, contested: [] }),
				searchConcepts: async () => ({
					hits: [],
					rejected: 2,
					misses: [
						{ conceptId: "decisions/caching", distance: 0.55 },
						{ conceptId: "decisions/retention", distance: 0.62 },
					],
				}),
			},
		});

		await cm.context({ messages: conversation }, ctx());
		await cm.settle();

		const curated = cm.recorded[0]?.pack?.parts.find(
			(part) => part.source === "curated",
		);
		expect(curated?.irrelevant).toBe(2);
		expect(curated?.threshold).toBe(0.4);
		expect(curated?.absent).toBe("irrelevant");
		expect(curated?.excludedCandidates?.map((each) => each.conceptId)).toEqual([
			"decisions/caching",
			"decisions/retention",
		]);
	});

	test("no recall is requested when its budget is zero", async () => {
		let asked = false;
		const cm = harness({
			recall: {
				similarTurns: async () => {
					asked = true;
					return { turns: [], rejected: 0, misses: [], unsearched: 0 };
				},
			},
		});

		await cm.context({ messages: conversation }, ctx());
		await cm.settle();

		expect(asked).toBe(false);
	});
});

describe("an embedding model that changed under the corpus", () => {
	test("says so once, naming both models and the turns affected", async () => {
		const cm = harness({
			ingest: new MemoryTurnSource(),
			embed: async () => undefined,
			vectorModels: async () => ({
				inUse: "Xenova/bge-small-en-v1.5",
				others: [{ model: "some/other-model", turns: 42 }],
			}),
		});

		await cm.agentEnd({}, ctx());
		await cm.agentEnd({}, ctx());
		await cm.settle();

		const swap = cm.reported.filter((line) => line.includes("other-model"));
		expect(swap).toHaveLength(1);
		expect(swap[0]).toContain("Xenova/bge-small-en-v1.5");
		expect(swap[0]).toContain("42");
	});

	test("stays quiet when every vector came from the model in use", async () => {
		const cm = harness({
			ingest: new MemoryTurnSource(),
			embed: async () => undefined,
			vectorModels: async () => ({ inUse: "pinned", others: [] }),
		});

		await cm.agentEnd({}, ctx());
		await cm.settle();

		// Scoped to the swap: a sweep with no Journal to read reports that
		// separately, and it is not what this case is about.
		expect(cm.reported.filter((line) => line.includes("model"))).toEqual([]);
	});

	test("a check that fails costs the report, not the turn", async () => {
		let embedded = false;
		const cm = harness({
			ingest: new MemoryTurnSource(),
			embed: async () => {
				embedded = true;
			},
			vectorModels: async () => {
				throw new Error("store unreachable");
			},
		});

		await cm.agentEnd({}, ctx());
		await cm.settle();

		expect(embedded).toBe(true);
		expect(cm.reported.join("\n")).toContain("store unreachable");
	});
});

describe("the pack command", () => {
	const prompt = [{ role: "user", content: "current" }];

	test("changing a budget applies to the next call", async () => {
		const config = { tailTurns: 8, recallTurns: 0, recallMaxDistance: 1, docConcepts: 0, docMaxDistance: 0.5, docBundle: "/unused", graphSymbols: 0, graphExtract: false, specsVerify: false };
		const cm = harness({
			config,
			recall: {
				similarTurns: async () => ({
					turns: [
						{
							turnIndex: 3,
							turn: {
								index: 3,
								prompt: "older decision",
								messages: [{ role: "user", content: "older decision" }],
							},
						},
					],
					rejected: 0, misses: [], unsearched: 0,
				}),
			},
		});

		// Recall is off, so the first pack carries none.
		await cm.context({ messages: prompt }, ctx());
		await cm.settle();
		expect(
			cm.recorded[0]?.pack?.parts.find((part) => part.source === "recalled")
				?.carried,
		).toBe(0);

		await cm.commands.pack?.handler("budget recall 2", {});
		await cm.context({ messages: prompt }, ctx());
		await cm.settle();

		expect(
			cm.recorded[1]?.pack?.parts.find((part) => part.source === "recalled")
				?.carried,
		).toBe(1);
	});

	test("an invalid budget is reported and nothing changes", async () => {
		const config = { tailTurns: 8, recallTurns: 4, recallMaxDistance: 1, docConcepts: 0, docMaxDistance: 0.5, docBundle: "/unused", graphSymbols: 0, graphExtract: false, specsVerify: false };
		const cm = harness({ config });

		await cm.commands.pack?.handler("budget recall plenty", {});

		expect(cm.shown.join()).toContain("not a count");
		expect(config.recallTurns).toBe(4);
	});

	test("with nothing recorded the command says so rather than failing", async () => {
		const cm = harness();

		await cm.commands.pack?.handler("", {});

		expect(cm.shown.join()).toContain("Nothing recorded");
	});

	/**
	 * Three Calls over two Turns, recorded the way a session records them:
	 * a Turn answered in one Call, then a Turn that took two.
	 */
	async function recordedConversation(overrides: Overrides = {}) {
		const cm = harness({ accounting: new MemoryAccounting(), ...overrides });
		await cm.context({ messages: [{ role: "user", content: "first" }] }, ctx());
		const branch = answered(100, "first");
		await cm.context(
			{ messages: [{ role: "user", content: "second" }] },
			ctx(branch),
		);
		await cm.context(
			{ messages: [{ role: "user", content: "second" }] },
			ctx([
				...branch,
				{ type: "message", message: { role: "user", content: "second" } },
				{
					type: "message",
					message: {
						role: "assistant",
						contextSnapshot: { promptTokens: 200, nonMessageTokens: 90 },
					},
				},
			]),
		);
		await cm.settle();
		return cm;
	}

	test("a call several turns back is examined by its address", async () => {
		const cm = await recordedConversation();

		await cm.commands.pack?.handler("0", {});

		expect(cm.shown.at(-1)).toContain("Turn 0, call 0");
	});

	test("a turn without a call number resolves to its last call", async () => {
		const cm = await recordedConversation();

		await cm.commands.pack?.handler("1", {});
		expect(cm.shown.at(-1)).toContain("Turn 1, call 1");

		await cm.commands.pack?.handler("1.0", {});
		expect(cm.shown.at(-1)).toContain("Turn 1, call 0");
	});

	test("an address that was never recorded is refused, naming what is", async () => {
		const cm = await recordedConversation();

		await cm.commands.pack?.handler("9.4", {});

		const answer = cm.shown.at(-1) ?? "";
		expect(answer).toContain("No call recorded at 9.4");
		expect(answer).toContain("turns 0 to 1, 3 calls");
		// Never a different Call in its place.
		expect(answer).not.toContain("Turn 1");
	});

	test("two named calls can be compared, whether or not either is the latest", async () => {
		const cm = await recordedConversation();

		await cm.commands.pack?.handler("diff 0 1.0", {});
		const named = cm.shown.at(-1) ?? "";
		await cm.commands.pack?.handler("diff", {});
		const latest = cm.shown.at(-1) ?? "";

		// Turn 0's pack carried turn 0; Turn 1's carried turn 1. The named
		// diff must be those two, not the two most recent Calls — which
		// are 1.0 and 1.1, and carried the same Turn as each other.
		expect(named).toContain("+ current-turn turn 1");
		expect(named).toContain("- current-turn turn 0");
		expect(latest).toBe("No change between these packs.");
	});

	test("why names the turn recall refused, with its distance", async () => {
		const refusing = {
			config: { recallTurns: 2, recallMaxDistance: 0.52 },
			recall: {
				similarTurns: async () => ({
					turns: [],
					rejected: 1,
					misses: [{ turnIndex: 4, distance: 0.61 }],
					unsearched: 0,
				}),
			},
		};

		// A bare number is the subject, not an address: "why 4" is the
		// commonest question this command exists to answer.
		for (const asked of ["why turn 4", "why 4"]) {
			const cm = await recordedConversation(refusing);
			await cm.commands.pack?.handler(asked, {});

			const answer = cm.shown.at(-1) ?? "";
			expect(answer).toContain("turn 4");
			expect(answer).toContain("distance 0.61");
			expect(answer).toContain("beyond the 0.52 threshold");
		}
	});

	test("why can be asked of a call that is not the latest", async () => {
		const cm = await recordedConversation();

		await cm.commands.pack?.handler("why 0 turn 4", {});

		expect(cm.shown.at(-1)).toContain("turn 0, call 0");
	});

	test("why without a subject says what to ask", async () => {
		const cm = await recordedConversation();

		await cm.commands.pack?.handler("why", {});

		expect(cm.shown.at(-1)).toContain("Say what to explain");
	});
});

describe("a harness compaction during a session", () => {
	/** The fixture's branch, driven through one Call. */
	async function compactedSession() {
		const accounting = new MemoryAccounting();
		const cm = harness({ accounting });
		await cm.context(
			{ messages: [{ role: "user", content: "what did we decide about retention" }] },
			ctx(await branchOf(COMPACTION_FIXTURE)),
		);
		await cm.settle();
		return { cm, accounting };
	}

	test("is recorded against the call it was first reported at", async () => {
		const { cm, accounting } = await compactedSession();

		// The epochs the fixture reports: 0, 0, then 1 at the third Call.
		const recordedTurns = await accounting.readAccounting("conv-1");
		expect(
			recordedTurns.flatMap((turn) =>
				turn.calls.map((call) => call.compactionEpoch),
			),
		).toEqual([0, 0, 1, undefined]);

		await cm.commands.pack?.handler("summary", {});
		expect(cm.shown.at(-1)).toContain("compacted this conversation at turn 2");
	});

	test("the calls before it are not recorded as compacted", async () => {
		const { cm } = await compactedSession();

		await cm.commands.pack?.handler("1", {});
		expect(cm.shown.at(-1)).not.toContain("compacted");
		await cm.commands.pack?.handler("2.0", {});
		expect(cm.shown.at(-1)).toContain("compacted");
	});

	test("a call assembled after it is not itself reported as the compaction", async () => {
		// The Call this session just assembled is at turn 2, call 1: it
		// followed the compaction but is not where the epoch changed, and
		// the harness has not measured it at all yet.
		const { cm } = await compactedSession();

		await cm.commands.pack?.handler("2.1", {});

		expect(cm.shown.at(-1)).toContain("Turn 2, call 1");
		expect(cm.shown.at(-1)).not.toContain("compacted");
	});

	test("detecting one does not change the pack or fail the turn", async () => {
		const branch = await branchOf(COMPACTION_FIXTURE);
		const cm = harness({ accounting: new MemoryAccounting() });
		const messages = [{ role: "user", content: "what did we decide about retention" }];

		const compacted = await cm.context({ messages }, ctx(branch));
		const plain = await cm.context({ messages }, ctx());
		await cm.settle();

		expect(compacted?.messages).toEqual(plain?.messages);
		expect(cm.reported).toEqual([]);
	});
});

describe("searching across conversations", () => {
	const hit = {
		turnIndex: 2,
		turn: {
			index: 2,
			prompt: "we chose exponential backoff",
			messages: [{ role: "user", content: "we chose exponential backoff" }],
		},
		conversationId: "other-conversation",
		codebase: "/work/elsewhere",
		calls: 1,
	};

	test("the agent can search, and results say where they came from", async () => {
		const cm = harness({ search: { searchAll: async () => [hit] } });

		const result = await cm.tools.recall_across_conversations?.execute("1", {
			query: "retries",
		});

		const text = result?.content.map((block) => block.text).join("\n") ?? "";
		expect(text).toContain("other-conversation");
		expect(text).toContain("/work/elsewhere");
		expect(text).toContain("exponential backoff");
	});

	test("finding nothing says so rather than returning something weak", async () => {
		const cm = harness({ search: { searchAll: async () => [] } });

		const result = await cm.tools.recall_across_conversations?.execute("1", {
			query: "anything",
		});

		expect(result?.content[0]?.text).toContain("No conversation holds");
	});

	test("searching does not change the pack assembled afterwards", async () => {
		const messages = [{ role: "user", content: "current" }];
		const without = harness();
		const searching = harness({ search: { searchAll: async () => [hit] } });

		const before = await without.context({ messages }, ctx());

		// Search first, then assemble: a future implementation that fed
		// results back into assembly would diverge here.
		await searching.tools.recall_across_conversations?.execute("1", {
			query: "retries",
		});
		const after = await searching.context({ messages }, ctx());
		await without.settle();
		await searching.settle();

		expect(after?.messages).toEqual(before?.messages ?? []);
		expect(JSON.stringify(after?.messages)).not.toContain("other-conversation");
	});

	test("no tool is offered when there is nothing to search", async () => {
		const cm = harness();

		expect(cm.tools.recall_across_conversations).toBeUndefined();
	});

	test("a search failure is the tool's result, not the turn's", async () => {
		const cm = harness({
			search: {
				searchAll: () => Promise.reject(new Error("store unreachable")),
			},
		});

		const result = await cm.tools.recall_across_conversations?.execute("1", {
			query: "x",
		});

		expect(result?.content[0]?.text).toContain("store unreachable");
		expect(result?.details?.failed).toBe(true);
		expect(cm.reported.join()).toContain("store unreachable");
	});
});

describe("the doc store in a session", () => {
	const hit = {
		conceptId: "decisions/caching",
		text: "Caching\n\nWe cache parsed configuration.",
		trust: "human-reviewed" as const,
		stale: false,
		distance: 0.2,
	};

	test("concepts reach the pack", async () => {
		const cm = harness({
			config: {
				tailTurns: DEFAULT_TAIL_TURNS,
				recallTurns: 0,
				recallMaxDistance: 1,
				docConcepts: 2,
				docMaxDistance: 0.5,
				graphSymbols: 0,
				graphExtract: false,
			specsVerify: false,
				docBundle: "/unused",
			},
			docs: {
				indexConcepts: async () => ({ embedded: 0, contested: [] }),
				searchConcepts: async () => ({ hits: [hit], rejected: 0, misses: [] }),
			},
		});

		const result = await cm.context(
			{ messages: [{ role: "user", content: "how do we handle config?" }] },
			ctx(),
		);

		expect(JSON.stringify(result?.messages)).toContain(
			"[curated knowledge: decisions/caching]",
		);
	});

	test("a doc store failure costs the concepts, not the turn", async () => {
		const cm = harness({
			config: {
				tailTurns: DEFAULT_TAIL_TURNS,
				recallTurns: 0,
				recallMaxDistance: 1,
				docConcepts: 2,
				docMaxDistance: 0.5,
				graphSymbols: 0,
				graphExtract: false,
			specsVerify: false,
				docBundle: "/unused",
			},
			docs: {
				indexConcepts: async () => ({ embedded: 0, contested: [] }),
				searchConcepts: async () => {
					throw new Error("index offline");
				},
			},
		});

		const result = await cm.context(
			{ messages: [{ role: "user", content: "how do we handle config?" }] },
			ctx(),
		);

		expect(result?.messages).toHaveLength(1);
		expect(cm.reported.join("\n")).toContain("Doc Store unavailable");
	});

	test("the bundle is indexed at session start, off the request path", async () => {
		const indexing = Promise.withResolvers<void>();
		let indexed = 0;
		const cm = harness({
			docs: {
				indexConcepts: async () => {
					await indexing.promise;
					indexed++;
					return { embedded: 1, contested: [] };
				},
				searchConcepts: async () => ({ hits: [], rejected: 0, misses: [] }),
			},
			bundle: async () => [],
		});

		await cm.sessionStart({}, ctx());
		// Indexing has not finished, and the first Call does not wait for it.
		const result = await cm.context(
			{ messages: [{ role: "user", content: "hello" }] },
			ctx(),
		);
		expect(indexed).toBe(0);
		expect(result?.messages).toHaveLength(1);

		indexing.resolve();
		await cm.settle();
		expect(indexed).toBe(1);
	});

	test("a bundle that cannot be read is reported, not thrown", async () => {
		const cm = harness({
			docs: {
				indexConcepts: async () => ({ embedded: 0, contested: [] }),
				searchConcepts: async () => ({ hits: [], rejected: 0, misses: [] }),
			},
			bundle: async () => {
				throw new Error("no bundle there");
			},
		});

		await cm.sessionStart({}, ctx());
		await cm.settle();

		expect(cm.reported.join("\n")).toContain("Doc Store indexing");
	});
});

describe("a bundle that is not there", () => {
	test("indexes nothing, and says nothing", async () => {
		let indexed: number | undefined;
		const cm = harness({
			docs: {
				indexConcepts: async (concepts) => {
					indexed = concepts.length;
					return { embedded: 0, contested: [] };
				},
				searchConcepts: async () => ({ hits: [], rejected: 0, misses: [] }),
			},
			// What the real reader returns for a path that is not there.
			bundle: async () => undefined,
		});

		await cm.sessionStart({}, ctx());
		await cm.settle();

		// Nothing indexed, because an empty corpus would prune the index —
		// and nothing reported, because most machines have no bundle.
		expect(indexed).toBeUndefined();
		expect(cm.reported.join("\n")).not.toContain("Doc Store");
	});

	test("a concept that lost its identity race is named", async () => {
		const cm = harness({
			docs: {
				indexConcepts: async () => ({
					embedded: 0,
					contested: ["decisions/caching-copy"],
				}),
				searchConcepts: async () => ({ hits: [], rejected: 0, misses: [] }),
			},
			bundle: async () => [],
		});

		await cm.sessionStart({}, ctx());
		await cm.settle();

		expect(cm.reported.join("\n")).toContain("decisions/caching-copy");
	});

	test("indexing waits for the schema", async () => {
		const migrated = Promise.withResolvers<void>();
		let indexed = false;
		const cm = harness({
			docs: {
				indexConcepts: async () => {
					indexed = true;
					return { embedded: 0, contested: [] };
				},
				searchConcepts: async () => ({ hits: [], rejected: 0, misses: [] }),
			},
			bundle: async () => [],
			ready: migrated.promise,
		});

		await cm.sessionStart({}, ctx());
		// The table indexing writes to is created by that migration, so
		// indexing before it lands fails the whole session's Doc Store.
		expect(indexed).toBe(false);

		migrated.resolve();
		await cm.settle();
		expect(indexed).toBe(true);
	});
});

describe("the graph store in a session", () => {
	const graphJson = readFileSync(
		new URL("./fixtures/graph.json", import.meta.url).pathname,
		"utf8",
	);

	function graphStore(options: { graph?: string; fails?: boolean } = {}) {
		const refreshed: string[] = [];
		const store = new GraphStore({
			home: "/home/test/.context-manager/graphify",
			exists: async (path) =>
				path.endsWith("bin/graphify") ||
				(options.graph !== undefined && path.endsWith("graph.json")),
			changedAt: async () => (options.graph === undefined ? undefined : 1),
			read: async () => {
				if (options.fails) throw new Error("graph unreadable");
				return options.graph ?? graphJson;
			},
			makeDirectory: async () => {},
			run: async (_command, args) => {
				refreshed.push(args.join(" "));
				return { ok: true, output: "" };
			},
		});
		return { store, refreshed };
	}

	const config = (graphSymbols: number, graphExtract = false) => ({
		tailTurns: DEFAULT_TAIL_TURNS,
		recallTurns: 0,
		recallMaxDistance: 1,
		docConcepts: 0,
		docMaxDistance: 0.5,
		docBundle: "/unused",
		graphSymbols,
		graphExtract,
		specsVerify: false,
	});

	test("structure about a named symbol reaches the pack", async () => {
		const { store } = graphStore({ graph: graphJson });
		const cm = harness({ config: config(2), graph: store });

		const result = await cm.context(
			{ messages: [{ role: "user", content: "who calls assemble?" }] },
			ctx(),
		);

		expect(JSON.stringify(result?.messages)).toContain(
			"[codebase structure: assemble() (src/assembler.ts:L92)]",
		);
		expect(JSON.stringify(result?.messages)).toContain("src/extension.ts:L520");
	});

	test("a codebase with no graph contributes nothing", async () => {
		const { store } = graphStore();
		const cm = harness({ config: config(2), graph: store });

		const result = await cm.context(
			{ messages: [{ role: "user", content: "who calls assemble?" }] },
			ctx(),
		);

		expect(result?.messages).toHaveLength(1);
	});

	test("a graph store failure costs the structure, not the turn", async () => {
		const { store } = graphStore({ graph: graphJson, fails: true });
		const cm = harness({ config: config(2), graph: store });

		const result = await cm.context(
			{ messages: [{ role: "user", content: "who calls assemble?" }] },
			ctx(),
		);

		expect(result?.messages).toHaveLength(1);
		expect(cm.reported.join("\n")).toContain("Graph Store unavailable");
	});

	test("the codebase is extracted at session start, off the request path", async () => {
		const { store, refreshed } = graphStore({ graph: graphJson });
		const cm = harness({
			config: config(2, true),
			graph: store,
			codebase: "/work/project",
		});

		await cm.sessionStart({}, ctx());
		await cm.settle();

		expect(refreshed).toContain("extract /work/project --code-only");
	});

	test("a failure to extract is reported and the session goes on", async () => {
		const store = new GraphStore({
			home: "/home/test/.context-manager/graphify",
			exists: async () => true,
			changedAt: async () => undefined,
			read: async () => graphJson,
			makeDirectory: async () => {},
			run: async (_command, args) =>
				args[0] === "--version"
					? { ok: true, output: `graphify ${PINNED_GRAPHIFY}` }
					: { ok: false, output: "tree-sitter exploded" },
		});
		const cm = harness({ config: config(2, true), graph: store });

		await cm.sessionStart({}, ctx());
		await cm.settle();
		const result = await cm.context(
			{ messages: [{ role: "user", content: "hello" }] },
			ctx(),
		);

		expect(cm.reported.join("\n")).toContain("Graph Store extraction failed");
		expect(cm.reported.join("\n")).toContain("tree-sitter exploded");
		expect(result?.messages).toHaveLength(1);
	});

	test("extraction is declined when it is switched off", async () => {
		const { store, refreshed } = graphStore({ graph: graphJson });
		const cm = harness({ config: config(2, false), graph: store });

		await cm.sessionStart({}, ctx());
		await cm.settle();

		// It writes a directory into the user's repository, so it must be
		// possible to say no.
		expect(refreshed).toEqual([]);
	});
});

describe("the spec store in a session", () => {
	function specStore(tree: "conforming" | "partial" | "absent") {
		const ran: string[][] = [];
		const store = new SpecStore({
			inspect: async (path) => {
				if (tree === "absent") return "absent";
				if (tree === "partial" && path.endsWith("specs")) return "absent";
				return path.endsWith("config.yaml") ? "file" : "directory";
			},
			run: async (_command, args) => {
				ran.push(args);
				return { ok: true, output: "All items valid" };
			},
		});
		return { store, ran };
	}

	const config = (specsVerify: boolean) => ({
		tailTurns: DEFAULT_TAIL_TURNS,
		recallTurns: 0,
		recallMaxDistance: 1,
		docConcepts: 0,
		docMaxDistance: 0.5,
		docBundle: "/unused",
		graphSymbols: 0,
		graphExtract: false,
		specsVerify,
	});

	test("a non-conforming codebase is reported at session start", async () => {
		const { store } = specStore("partial");
		const cm = harness({ config: config(true), specs: store });

		await cm.sessionStart({}, ctx());
		await cm.settle();

		expect(cm.reported.join("\n")).toContain("openspec/specs is missing");
	});

	test("a conforming codebase is not mentioned", async () => {
		const { store } = specStore("conforming");
		const cm = harness({ config: config(true), specs: store });

		await cm.sessionStart({}, ctx());
		await cm.settle();

		// A Codebase that is set up correctly has nothing to say about it.
		expect(cm.reported.join("\n")).not.toContain("OpenSpec");
	});

	test("a session never initializes a codebase by itself", async () => {
		const { store, ran } = specStore("absent");
		const cm = harness({ config: config(true), specs: store });

		await cm.sessionStart({}, ctx());
		await cm.settle();

		// An openspec/ tree is a claim about how a project is run, not a
		// cache: planting one unasked would be presumptuous.
		expect(ran.some((args) => args[0] === "init")).toBe(false);
	});

	test("a codebase that is simply not spec-driven is left in peace", async () => {
		const { store } = specStore("absent");
		const cm = harness({ config: config(true), specs: store });

		await cm.sessionStart({}, ctx());
		await cm.settle();

		// A missing tree is a project's own business; a broken one is a
		// problem. Only the second is worth a line every session.
		expect(cm.reported.join("\n")).not.toContain("OpenSpec");
	});

	test("asking about a codebase with no tree says so, without judging content", async () => {
		const { store, ran } = specStore("absent");
		const cm = harness({ config: config(true), specs: store });

		await cm.commands.specs?.handler("", {});

		expect(cm.shown.join("\n")).toContain("No OpenSpec tree");
		// OpenSpec would answer "no root here", which reads as a verdict
		// on specs that do not exist.
		expect(ran).toEqual([]);
	});

	test("an unrecognised argument is answered, not silently ignored", async () => {
		const { store } = specStore("conforming");
		const cm = harness({ config: config(true), specs: store });

		await cm.commands.specs?.handler("init --force", {});

		expect(cm.shown.join("\n")).toContain("Unknown arguments");
	});

	test("verification can be switched off entirely", async () => {
		const { store } = specStore("absent");
		const cm = harness({ config: config(false), specs: store });

		await cm.sessionStart({}, ctx());
		await cm.settle();

		expect(cm.reported.join("\n")).not.toContain("OpenSpec");
	});

	test("the pack is the same whether or not the codebase has a tree", async () => {
		const { store, ran } = specStore("conforming");
		const withSpecs = harness({ config: config(true), specs: store });
		const without = harness({ config: config(true) });
		const messages = [{ role: "user" as const, content: "hello" }];

		const carried = await withSpecs.context({ messages }, ctx());
		const bare = await without.context({ messages }, ctx());

		// This Store feeds nothing into a pack, by requirement: assembling
		// must not consult it at all.
		expect(ran).toEqual([]);
		expect(carried?.messages).toEqual(bare?.messages);
	});

	test("asking initializes, and reports the result", async () => {
		const ran: string[][] = [];
		let initialized = false;
		const store = new SpecStore({
			inspect: async (path) =>
				initialized
					? path.endsWith("config.yaml")
						? "file"
						: "directory"
					: "absent",
			run: async (_command, args) => {
				ran.push(args);
				if (args[0] === "init") initialized = true;
				return { ok: true, output: "" };
			},
		});
		const cm = harness({ config: config(true), specs: store });

		await cm.commands.specs?.handler("init", {});

		expect(ran[0]?.[0]).toBe("init");
		expect(cm.shown.join("\n")).toContain("as expected");
	});

	test("verifying says what is wrong and what openspec says", async () => {
		const store = new SpecStore({
			inspect: async (path) =>
				path.endsWith("specs")
					? "absent"
					: path.endsWith("config.yaml")
						? "file"
						: "directory",
			run: async () => ({ ok: false, output: "✗ change/half-done" }),
		});
		const cm = harness({ config: config(true), specs: store });

		await cm.commands.specs?.handler("", {});

		const shown = cm.shown.join("\n");
		expect(shown).toContain("openspec/specs is missing");
		expect(shown).toContain("specs init");
		expect(shown).toContain("change/half-done");
	});
});

describe("an invariant that cannot be checked", () => {
	test("a harness that does not report its memory backend is said so", async () => {
		const cm = harness();

		// Not the same as verified off: a silent return would read as
		// confirmation (ADR-0003).
		await cm.sessionStart({}, ctx([], { memory: {} }));

		expect(cm.reported.join("\n")).toContain("cannot be confirmed off");
	});

	test("a harness that reports it off says nothing", async () => {
		const cm = harness();

		await cm.sessionStart(
			{},
			ctx([], { memory: { status: () => ({ backend: "off", active: false }) } }),
		);

		expect(cm.reported.join("\n")).not.toContain("memory backend");
	});
});

describe("walking the documentation bundle", () => {
	const BUNDLE = new URL("./fixtures/okf-acme-retail", import.meta.url).pathname;

	function walking(root = BUNDLE) {
		const read: string[] = [];
		const store = new DocStore(root, { onRead: (path) => read.push(path) });
		return { cm: harness({ walk: store }), read };
	}

	async function walk(
		cm: ReturnType<typeof harness>,
		params: { level?: string; concept?: string },
	): Promise<string> {
		const result = await cm.tools.walk_documentation?.execute("1", params);
		return result?.content.map((block) => block.text).join("\n") ?? "";
	}

	test("the top of a bundle lists what is directly in it", async () => {
		const { cm } = walking();

		const text = await walk(cm, {});

		expect(text).toContain("level metrics");
		expect(text).toContain("level policies");
	});

	test("a level lists what is beneath it, with descriptions", async () => {
		const { cm } = walking();

		const text = await walk(cm, { level: "metrics" });

		expect(text).toContain("concept metrics/gross-margin");
		expect(text).toContain("—");
	});

	test("reading a level does not read the concepts below it", async () => {
		const { cm, read } = walking();

		await walk(cm, {});

		// Progressive disclosure is the point: a Level that loaded the
		// corpus would be a corpus, not a Level. Paths arrive rooted, so
		// this matches on the part that names a concept beneath the top.
		expect(read.some((path) => path.includes("/metrics/"))).toBe(false);
		expect(read.length).toBeGreaterThan(0);
	});

	test("an author's own listing is preferred, and says so", async () => {
		const root = await mkdtemp(join(tmpdir(), "cm-walk-"));
		await Bun.write(
			join(root, "second.md"),
			"---\ntype: Decision\ntitle: Second\ndescription: written second\n---\n\nBody.\n",
		);
		await Bun.write(
			join(root, "first.md"),
			"---\ntype: Decision\ntitle: First\ndescription: written first\n---\n\nBody.\n",
		);
		// The author's own ordering, which is the opposite of the
		// alphabetical one a synthesised listing would produce.
		await Bun.write(
			join(root, "index.md"),
			"# Bundle\n\n- [second](second.md) — read this one first\n- [first](first.md) — then this\n",
		);
		const { cm } = walking(root);

		const text = await walk(cm, {});

		expect(text).toContain("curated by the bundle's author");
		// Both present before comparing: indexOf gives -1 for a missing
		// entry, and -1 is less than any real position.
		expect(text).toContain("concept second");
		expect(text).toContain("concept first");
		expect(text.indexOf("concept second")).toBeLessThan(
			text.indexOf("concept first"),
		);
	});

	test("a concept named in a listing can be opened", async () => {
		const { cm } = walking();

		const text = await walk(cm, { concept: "metrics/gross-margin" });

		expect(text).toContain("Definition");
	});

	test("a concept the bundle does not hold says so", async () => {
		const { cm } = walking();

		expect(await walk(cm, { concept: "metrics/invented" })).toContain(
			"No concept called",
		);
	});

	test("an empty level says it is empty, not that it is absent", async () => {
		const root = await mkdtemp(join(tmpdir(), "cm-walk-empty-"));
		await Bun.write(join(root, "unwritten", ".keep"), "");
		const { cm } = walking(root);

		const text = await walk(cm, { level: "unwritten" });

		// The opposite answer to "No level called": this part of the
		// corpus exists and has nothing in it yet.
		expect(text).toContain("nothing yet");
		expect(text).not.toContain("No level called");
	});

	test("a level written with a trailing slash is the same level", async () => {
		const { cm } = walking();

		// The path comes from a model. `metrics/` silently listed nothing,
		// which reads as "this part of the corpus is empty".
		expect(await walk(cm, { level: "metrics/" })).toContain("gross-margin");
		expect(await walk(cm, { level: "./metrics" })).toContain("gross-margin");
	});

	test("an empty concept string is no concept, not a concept named nothing", async () => {
		const { cm } = walking();

		const text = await walk(cm, { level: "metrics", concept: "" });

		expect(text).toContain("gross-margin");
		expect(text).not.toContain("No concept called");
	});

	test("an argument of the wrong type does not blame the bundle", async () => {
		const { cm } = walking();

		const result = await cm.tools.walk_documentation?.execute("1", {
			level: 42,
		});
		const text = result?.content.map((block) => block.text).join("\n") ?? "";

		expect(text).not.toContain("Could not read the bundle");
		expect(text).toContain("holds:");
	});

	test("a named level missing because there is no bundle says so", async () => {
		const { cm } = walking("/nonexistent/bundle");

		// Otherwise the agent keeps guessing names against nothing.
		expect(await walk(cm, { level: "metrics" })).toContain(
			"No documentation bundle",
		);
	});

	test("a reserved file is not a concept", async () => {
		const { cm } = walking();

		// `log.md` and `index.md` are named by no listing and are not
		// Concepts; serving them would hand back a stray file.
		expect(await walk(cm, { concept: "log" })).toContain("No concept called");
		expect(await walk(cm, { concept: "metrics/index" })).toContain(
			"No concept called",
		);
	});

	test("a failed walk is reported to the operator too", async () => {
		const failing = {
			list: async () => {
				throw new Error("disk went away");
			},
			open: async () => undefined,
		};
		const cm = harness({ walk: failing });

		await cm.tools.walk_documentation?.execute("1", {});

		// The person running the session can act on it; the model cannot.
		expect(cm.reported.join("\n")).toContain("Walking the bundle failed");
	});

	test("a concept id cannot escape the bundle", async () => {
		const { cm } = walking();

		// The id comes from an agent. `../../../README` is a readable path
		// from the fixture bundle, and this is a documentation tool, not a
		// file reader.
		const text = await walk(cm, { concept: "../../../README" });

		expect(text).toContain("No concept called");
	});

	test("a level path cannot escape the bundle", async () => {
		const { cm } = walking();

		expect(await walk(cm, { level: "../.." })).toContain("No level called");
	});

	test("a level the bundle does not have is not an empty level", async () => {
		const { cm } = walking();

		// Absent and empty mean opposite things.
		expect(await walk(cm, { level: "invented" })).toContain("No level called");
	});

	test("no bundle on the machine is an answer, not a failure", async () => {
		const { cm } = walking("/nonexistent/bundle");

		expect(await walk(cm, {})).toContain("No documentation bundle");
	});

	test("walking leaves the context pack untouched", async () => {
		// With the Doc Store wired too, so the curated part is populated
		// and a walked Concept leaking into it would be visible.
		const store = new DocStore(BUNDLE);
		const cm = harness({
			walk: store,
			config: {
				tailTurns: DEFAULT_TAIL_TURNS,
				recallTurns: 0,
				recallMaxDistance: 1,
				docConcepts: 2,
				docMaxDistance: 0.5,
				docBundle: BUNDLE,
				graphSymbols: 0,
				graphExtract: false,
				specsVerify: false,
			},
			docs: {
				indexConcepts: async () => ({ embedded: 0, contested: [] }),
				searchConcepts: async () => ({
					hits: [
						{
							conceptId: "metrics/gross-margin",
							text: "Gross margin is revenue less cost.",
							trust: "unverified" as const,
							stale: false,
							distance: 0.2,
						},
					],
					rejected: 0,
					misses: [],
				}),
			},
		});
		const messages = [{ role: "user" as const, content: "what is documented?" }];

		const before = await cm.context({ messages }, ctx());
		await cm.tools.walk_documentation?.execute("1", { level: "metrics" });
		const after = await cm.context({ messages }, ctx());

		// The agent choosing to look at something must not change what
		// assembly carries.
		expect(JSON.stringify(before?.messages)).toContain("curated knowledge");
		expect(after?.messages).toEqual(before?.messages);
	});
});

describe("a store that misses its deadline", () => {
	const prompt = [{ role: "user" as const, content: "what did we decide" }];

	/** A Store call that never answers, and a clock that expires instantly. */
	function stalled(): { after: (ms: number) => Promise<void>; waited: number[] } {
		const waited: number[] = [];
		return {
			waited,
			after: async (ms) => {
				waited.push(ms);
			},
		};
	}

	test("a silent store costs its part, not the turn", async () => {
		const clock = stalled();
		const cm = harness({
			after: clock.after,
			// Not the default, so what bounded the wait is unambiguous.
			config: { recallTurns: 2, recallDeadlineMs: 2_500 },
			recall: {
				// Never settles: the Store took the request and went quiet.
				similarTurns: () => new Promise(() => {}),
			},
		});

		const result = await cm.context({ messages: prompt }, ctx());
		await cm.settle();

		expect(result?.messages).toBeDefined();
		// Bounded by recall's own deadline, and no other Store's.
		expect(clock.waited).toContain(2_500);
		expect(clock.waited).not.toContain(DEFAULT_RETRIEVAL_DEADLINE_MS);
		expect(cm.reported.join("\n")).toContain("did not answer within 2500ms");
		// What the pack did not carry, the accounting does not claim — and
		// it attributes the absence to the Store rather than to relevance.
		const recalled = cm.recorded[0]?.pack?.parts.find(
			(part) => part.source === "recalled",
		);
		expect(recalled?.carried).toBe(0);
		expect(recalled?.absent).toBe("failed");
	});

	test("a missed deadline reads differently from a refused connection", async () => {
		const missed = harness({
			after: stalled().after,
			config: { recallTurns: 2 },
			recall: { similarTurns: () => new Promise(() => {}) },
		});
		const refused = harness({
			config: { recallTurns: 2 },
			recall: {
				similarTurns: async () => {
					throw new Error("ECONNREFUSED");
				},
			},
		});

		await missed.context({ messages: prompt }, ctx());
		await refused.context({ messages: prompt }, ctx());

		expect(missed.reported.join("\n")).toContain("did not answer within");
		expect(refused.reported.join("\n")).toContain("Recall unavailable");
		expect(refused.reported.join("\n")).not.toContain("did not answer within");
	});

	test("one slow store does not cost the others", async () => {
		const store = new MemoryTurnSource();
		await store.ingest("conv-1", [
			{
				turnIndex: 0,
				prompt: "an earlier turn",
				messages: [{ role: "user", content: "an earlier turn" }],
				callCount: 1,
				calls: [0],
			},
		]);
		const cm = harness({
			after: stalled().after,
			turns: store,
			config: { tailTurns: 4, docConcepts: 2 },
			docs: {
				indexConcepts: async () => ({ embedded: 0, contested: [] }),
				searchConcepts: () => new Promise(() => {}),
			},
		});

		const result = await cm.context({ messages: prompt }, ctx());

		// The Doc Store went quiet; the tail the Thread Store served is
		// still in the pack.
		expect(JSON.stringify(result?.messages)).toContain("an earlier turn");
		expect(JSON.stringify(result?.messages)).not.toContain("curated knowledge");
	});

	test("a tail that misses its deadline falls back to the harness's history", async () => {
		const cm = harness({
			after: stalled().after,
			config: { tailTurns: 4 },
			turns: { recentTurns: () => new Promise(() => {}) },
		});

		await cm.context(
			{
				messages: [
					{ role: "user", content: "older prompt" },
					{ role: "assistant", content: "older answer" },
					...prompt,
				],
			},
			ctx(),
		);
		await cm.settle();

		expect(cm.recorded[0]?.tailSource).toBe("harness-fallback");
	});

	test("a deadline nothing exceeds changes nothing", async () => {
		const answering = {
			indexConcepts: async () => ({ embedded: 0, contested: [] }),
			searchConcepts: async () => ({ hits: [], rejected: 0, misses: [] }),
		};
		const bounded = harness({ config: { docConcepts: 2 }, docs: answering });
		const unbounded = harness({
			config: { docConcepts: 2, docDeadlineMs: 0 },
			docs: answering,
		});

		const withDeadline = await bounded.context({ messages: prompt }, ctx());
		const without = await unbounded.context({ messages: prompt }, ctx());

		expect(withDeadline?.messages).toEqual(without?.messages);
		expect(bounded.reported).toEqual([]);
	});

	test("every store failing still supplies a pack, waiting only its deadlines", async () => {
		const clock = stalled();
		const cm = harness({
			after: clock.after,
			config: {
				tailTurns: 4,
				recallTurns: 2,
				docConcepts: 2,
				graphSymbols: 2,
				tailDeadlineMs: 1_500,
				recallDeadlineMs: 5_000,
				docDeadlineMs: 5_000,
				graphDeadlineMs: 5_000,
			},
			turns: { recentTurns: () => new Promise(() => {}) },
			recall: { similarTurns: () => new Promise(() => {}) },
			docs: {
				indexConcepts: async () => ({ embedded: 0, contested: [] }),
				searchConcepts: () => new Promise(() => {}),
			},
			// Only the two methods assembly reaches for; the Store itself
			// needs a machine with graphify on it.
			graph: {
				graph: () => new Promise(() => {}),
				refresh: async () => undefined,
			} as unknown as GraphStore,
		});

		const result = await cm.context({ messages: prompt }, ctx());

		expect(result?.messages?.length).toBeGreaterThan(0);
		// Nothing waited longer than the largest deadline configured.
		expect(Math.max(...clock.waited)).toBe(5_000);
	});
});

describe("a journal that cannot be found", () => {
	test("is reported, naming the conversation and where it was looked for", async () => {
		const cm = harness({
			ingest: new MemoryTurnSource(),
			findJournal: async () => undefined,
			sessionRoot: "/somewhere/else",
		});

		await cm.agentEnd({}, ctx());
		await cm.settle();

		const miss = cm.reported.find((line) => line.includes("No journal"));
		expect(miss).toContain("conv-1");
		expect(miss).toContain("/somewhere/else");
	});

	test("an empty journal reads differently from a journal never found", async () => {
		const empty = await mkdtemp(join(tmpdir(), "cm-journal-"));
		const path = join(empty, "conv-1.jsonl");
		await Bun.write(path, "");
		const read = harness({
			ingest: new MemoryTurnSource(),
			findJournal: async () => path,
		});
		const missing = harness({
			ingest: new MemoryTurnSource(),
			findJournal: async () => undefined,
		});

		await read.agentEnd({}, ctx());
		await missing.agentEnd({}, ctx());
		await read.settle();
		await missing.settle();

		expect(read.reported.join("\n")).toContain("holds no turns yet");
		expect(read.reported.join("\n")).not.toContain("No journal found");
		expect(missing.reported.join("\n")).toContain("No journal found");
	});

	test("a journal with turns says how many were stored", async () => {
		const cm = harness({
			ingest: new MemoryTurnSource(),
			findJournal: async () => JOURNAL_FIXTURE,
		});

		await cm.agentEnd({}, ctx());
		await cm.settle();

		expect(cm.reported.join("\n")).toMatch(/Ingested \d+ turns/);
	});

	test("does not fail the turn", async () => {
		const cm = harness({
			ingest: new MemoryTurnSource(),
			findJournal: async () => undefined,
		});

		await cm.agentEnd({}, ctx());
		const result = await cm.context(
			{ messages: [{ role: "user", content: "still answered" }] },
			ctx(),
		);

		expect(JSON.stringify(result?.messages)).toContain("still answered");
	});
});

describe("retention at the end of a session", () => {
	test("runs only when an age is configured, and says what went", async () => {
		const asked: number[] = [];
		const cm = harness({
			ingest: new MemoryTurnSource(),
			findJournal: async () => undefined,
			config: { retainDays: 30 },
			retire: async (days) => {
				asked.push(days);
				return 7;
			},
		});

		await cm.sessionShutdown({}, ctx());

		expect(asked).toEqual([30]);
		expect(cm.reported.join("\n")).toContain("removed 7 turns older than 30 days");
	});

	test("does not run when no age is configured", async () => {
		let asked = false;
		const cm = harness({
			ingest: new MemoryTurnSource(),
			findJournal: async () => undefined,
			retire: async () => {
				asked = true;
				return 0;
			},
		});

		await cm.sessionShutdown({}, ctx());

		expect(asked).toBe(false);
	});

	test("an unusable retention age is refused with a reason", () => {
		const config = loadConfig({ CM_RETAIN_DAYS: "a fortnight" });

		expect(config.retainDays).toBeUndefined();
		expect(config.problems.join("\n")).toContain("CM_RETAIN_DAYS");
	});
});

describe("what a session gives back when it ends", () => {
	test("closes the constructed dependencies", async () => {
		let closed = false;
		const cm = harness({
			ingest: new MemoryTurnSource(),
			findJournal: async () => undefined,
			close: () => {
				closed = true;
			},
		});

		await cm.sessionShutdown({}, ctx());

		expect(closed).toBe(true);
	});

	test("a failed final sweep does not skip cleanup", async () => {
		let closed = false;
		const cm = harness({
			ingest: new MemoryTurnSource(),
			findJournal: async () => {
				throw new Error("the session root is gone");
			},
			config: { retainDays: 30 },
			retire: async () => {
				throw new Error("retention failed too");
			},
			close: () => {
				closed = true;
			},
		});

		await cm.sessionShutdown({}, ctx());

		expect(closed).toBe(true);
		expect(cm.reported.join("\n")).toContain("Ingest failed");
	});
});
