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
		background: (work) => track(work),
		config: {
			tailTurns: DEFAULT_TAIL_TURNS,
			recallTurns: 0,
			recallMaxDistance: 1,
			docConcepts: 0,
			docMaxDistance: 0.5,
			graphSymbols: 0,
			graphExtract: false,
			specsVerify: false,
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
			config: { tailTurns: 8, recallTurns: 2, recallMaxDistance: 1, docConcepts: 0, docMaxDistance: 0.5, docBundle: "/unused", graphSymbols: 0, graphExtract: false, specsVerify: false },
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
				searchConcepts: async () => [hit],
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
				searchConcepts: async () => [],
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
				searchConcepts: async () => [],
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
				searchConcepts: async () => [],
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
				searchConcepts: async () => [],
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
				searchConcepts: async () => [],
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
				searchConcepts: async () => [
					{
						conceptId: "metrics/gross-margin",
						text: "Gross margin is revenue less cost.",
						trust: "unverified" as const,
						stale: false,
					},
				],
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
