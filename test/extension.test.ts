import { describe, expect, test } from "bun:test";

import {
	MemoryAccounting,
	type AccountingStore,
	type CallAddress,
	type Measurement,
	type TailSource,
} from "../src/accounting.ts";
import { assemble, type Pack } from "../src/assembler.ts";
import { DEFAULT_TAIL_TURNS } from "../src/config.ts";
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

interface Recorded extends CallAddress {
	pack?: Pack;
	unassembled?: boolean;
	tailSource?: TailSource;
}

interface Harness {
	context: ContextHandler;
	sessionStart: LifecycleHandler;
	agentEnd: LifecycleHandler;
	reported: string[];
	recorded: Recorded[];
	measured: Measurement[];
	commands: Record<string, CommandDefinition>;
	tools: Record<string, ToolDefinition>;
	shown: string[];
	/** Awaits the background accounting writes this extension started. */
	settle: () => Promise<void>;
}

function harness(overrides: Partial<Dependencies> = {}): Harness {
	let context: ContextHandler | undefined;
	let sessionStart: LifecycleHandler | undefined;
	let agentEnd: LifecycleHandler | undefined;

	const commands: Record<string, CommandDefinition> = {};
	const tools: Record<string, ToolDefinition> = {};
	const shown: string[] = [];
	const pi: ExtensionAPI = {
		on(event: string, handler: ContextHandler | LifecycleHandler) {
			if (event === "context") context = handler as ContextHandler;
			if (event === "session_start") sessionStart = handler as LifecycleHandler;
			if (event === "agent_end") agentEnd = handler as LifecycleHandler;
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

	register(pi, {
		config: {
			tailTurns: DEFAULT_TAIL_TURNS,
			recallTurns: 0,
			recallMaxDistance: 1,
			docBundle: "/unused",
		},
		assemble,
		turns: new MemoryTurnSource(),
		accounting,
		report: (message) => reported.push(message),
		show: (text) => shown.push(text),
		...overrides,
	});

	if (!context || !sessionStart || !agentEnd) {
		throw new Error("extension did not register its handlers");
	}

	return {
		context,
		sessionStart,
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
			config: { tailTurns: 8, recallTurns: 2, recallMaxDistance: 1, docBundle: "/unused" },
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
					rejected: 0,
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
			config: { tailTurns: 8, recallTurns: 2, recallMaxDistance: 1, docBundle: "/unused" },
			recall: {
				similarTurns: () => Promise.reject(new Error("index offline")),
			},
		});

		const result = await cm.context({ messages: conversation }, ctx());
		await cm.settle();

		expect(result?.messages).toHaveLength(1);
		expect(cm.reported.join()).toContain("index offline");
	});

	test("no recall is requested when its budget is zero", async () => {
		let asked = false;
		const cm = harness({
			recall: {
				similarTurns: async () => {
					asked = true;
					return { turns: [], rejected: 0 };
				},
			},
		});

		await cm.context({ messages: conversation }, ctx());
		await cm.settle();

		expect(asked).toBe(false);
	});
});

describe("the pack command", () => {
	const prompt = [{ role: "user", content: "current" }];

	test("changing a budget applies to the next call", async () => {
		const config = { tailTurns: 8, recallTurns: 0, recallMaxDistance: 1, docBundle: "/unused" };
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
					rejected: 0,
				}),
			},
		});

		// Recall is off, so the first pack carries none.
		await cm.context({ messages: prompt }, ctx());
		await cm.settle();
		expect(cm.recorded[0]?.pack?.parts.map((part) => part.source)).not.toContain(
			"recalled",
		);

		await cm.commands.pack?.handler("budget recall 2", {});
		await cm.context({ messages: prompt }, ctx());
		await cm.settle();

		expect(cm.recorded[1]?.pack?.parts.map((part) => part.source)).toContain(
			"recalled",
		);
	});

	test("an invalid budget is reported and nothing changes", async () => {
		const config = { tailTurns: 8, recallTurns: 4, recallMaxDistance: 1, docBundle: "/unused" };
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
