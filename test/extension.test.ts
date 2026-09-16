import { describe, expect, test } from "bun:test";

import type { CallAddress } from "../src/accounting.ts";
import { assemble, type Pack } from "../src/assembler.ts";
import { DEFAULT_TAIL_TURNS } from "../src/config.ts";
import { register, type Dependencies, type Recorder } from "../src/extension.ts";
import type {
	BranchEntry,
	ContextHandler,
	ExtensionAPI,
	HandlerContext,
	LifecycleHandler,
} from "../src/harness.ts";
import type { ContextSnapshot } from "../src/messages.ts";

interface Recorded extends CallAddress {
	pack?: Pack;
	unassembled?: boolean;
}

interface Harness {
	context: ContextHandler;
	sessionStart: LifecycleHandler;
	agentEnd: LifecycleHandler;
	reported: string[];
	recorded: Recorded[];
	measured: (CallAddress & { snapshot: ContextSnapshot })[];
	/** Awaits the background accounting writes this extension started. */
	settle: () => Promise<void>;
}

function harness(overrides: Partial<Dependencies> = {}): Harness {
	let context: ContextHandler | undefined;
	let sessionStart: LifecycleHandler | undefined;
	let agentEnd: LifecycleHandler | undefined;

	const pi: ExtensionAPI = {
		on(event: string, handler: ContextHandler | LifecycleHandler) {
			if (event === "context") context = handler as ContextHandler;
			if (event === "session_start") sessionStart = handler as LifecycleHandler;
			if (event === "agent_end") agentEnd = handler as LifecycleHandler;
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

	const accounting: Recorder = {
		recordPack: (_conversationId, address, pack) =>
			track(Promise.resolve(recorded.push({ ...address, pack })).then(() => {})),
		recordUnassembled: (_conversationId, address) =>
			track(
				Promise.resolve(recorded.push({ ...address, unassembled: true })).then(
					() => {},
				),
			),
		recordMeasurements: (_conversationId, measurements) =>
			track(Promise.resolve(measured.push(...measurements)).then(() => {})),
	};

	register(pi, {
		config: { tailTurns: DEFAULT_TAIL_TURNS, accountingDir: "/unused" },
		assemble,
		accounting,
		report: (message) => reported.push(message),
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
		settle: async () => {
			// Drains the writes the extension started, plus the reporting
			// microtask chained onto each, without waiting on the clock.
			while (writes.length > 0) await writes.shift();
			await Promise.resolve();
		},
	};
}

function answered(promptTokens: number): BranchEntry[] {
	return [
		{ type: "message", message: { role: "user" } },
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
		const branch = answered(100);

		await cm.context({ messages: [{ role: "user", content: "one" }] }, ctx(branch));
		// A second call within the same turn: another reported window, no new prompt.
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

	test("numbers turns from the session, so a resumed conversation does not restart", async () => {
		const cm = harness();
		const resumed: BranchEntry[] = [
			...answered(100),
			...answered(110),
			{ type: "message", message: { role: "user" } },
		];

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
