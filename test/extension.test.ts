import { describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import type { Pack } from "../src/assembler.ts";
import { DEFAULT_TAIL_TURNS } from "../src/config.ts";
import { register, type Dependencies, type Recorder } from "../src/extension.ts";
import type {
	ContextHandler,
	ExtensionAPI,
	HandlerContext,
	LifecycleHandler,
} from "../src/harness.ts";
import type { ContextSnapshot } from "../src/messages.ts";

interface Harness {
	pi: ExtensionAPI;
	context: ContextHandler;
	sessionStart: LifecycleHandler;
	agentEnd: LifecycleHandler;
	reported: string[];
	recorded: { conversationId: string; callIndex: number; pack: Pack }[];
	measured: { conversationId: string; snapshots: ContextSnapshot[] }[];
}

function harness(overrides: Partial<Dependencies> = {}): Harness {
	const handlers: Record<string, unknown> = {};
	const pi = {
		on(event: string, handler: unknown) {
			handlers[event] = handler;
		},
	} as unknown as ExtensionAPI;

	const reported: string[] = [];
	const recorded: Harness["recorded"] = [];
	const measured: Harness["measured"] = [];

	const accounting: Recorder = {
		async recordPack(conversationId, callIndex, pack) {
			recorded.push({ conversationId, callIndex, pack });
		},
		async recordMeasurements(conversationId, snapshots) {
			measured.push({ conversationId, snapshots });
		},
	};

	register(pi, {
		config: { tailTurns: DEFAULT_TAIL_TURNS, accountingDir: "/unused" },
		assemble,
		accounting,
		report: (message) => reported.push(message),
		...overrides,
	});

	return {
		pi,
		context: handlers.context as ContextHandler,
		sessionStart: handlers.session_start as LifecycleHandler,
		agentEnd: handlers.agent_end as LifecycleHandler,
		reported,
		recorded,
		measured,
	};
}

function ctx(overrides: Partial<HandlerContext> = {}): HandlerContext {
	return {
		sessionManager: { getSessionId: () => "conv-1", getBranch: () => [] },
		...overrides,
	};
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

		expect(result).toBeUndefined();
		expect(cm.reported.join()).toContain("boom");
	});

	test("an accounting failure leaves the pack intact and the turn running", async () => {
		const cm = harness({
			accounting: {
				async recordPack() {
					throw new Error("disk full");
				},
				async recordMeasurements() {},
			},
		});

		const result = await cm.context(
			{ messages: [{ role: "user", content: "hello" }] },
			ctx(),
		);

		expect(result?.messages).toHaveLength(1);
		expect(cm.reported.join()).toContain("disk full");
	});

	test("numbers calls within a conversation so measurements can be matched", async () => {
		const cm = harness();

		await cm.context({ messages: [{ role: "user", content: "one" }] }, ctx());
		await cm.context({ messages: [{ role: "user", content: "two" }] }, ctx());

		expect(cm.recorded.map((entry) => entry.callIndex)).toEqual([0, 1]);
	});
});

describe("memory backend check", () => {
	test("reports loudly when the harness memory backend is active", async () => {
		const cm = harness();

		await cm.sessionStart(
			{},
			ctx({ memory: { status: () => ({ backend: "mnemopi", active: true }) } }),
		);

		expect(cm.reported.join()).toContain("mnemopi");
	});

	test("stays quiet when the backend is off", async () => {
		const cm = harness();

		await cm.sessionStart(
			{},
			ctx({ memory: { status: () => ({ backend: "off", active: false }) } }),
		);

		expect(cm.reported).toEqual([]);
	});
});

describe("measurement reconciliation", () => {
	test("collects every reported window size from the session branch", async () => {
		const cm = harness();

		await cm.agentEnd(
			{},
			ctx({
				sessionManager: {
					getSessionId: () => "conv-1",
					getBranch: () => [
						{ type: "message", message: { role: "user" } },
						{
							type: "message",
							message: {
								role: "assistant",
								contextSnapshot: { promptTokens: 100, nonMessageTokens: 90 },
							},
						},
						{
							type: "message",
							message: {
								role: "assistant",
								contextSnapshot: { promptTokens: 120, nonMessageTokens: 90 },
							},
						},
					],
				},
			}),
		);

		expect(cm.measured[0]?.snapshots).toEqual([
			{ promptTokens: 100, nonMessageTokens: 90 },
			{ promptTokens: 120, nonMessageTokens: 90 },
		]);
	});
});
