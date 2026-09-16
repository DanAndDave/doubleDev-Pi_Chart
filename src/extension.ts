import {
	MemoryAccounting,
	type AccountingStore,
	type CallAddress,
	type Measurement,
	type TailSource,
} from "./accounting.ts";
import {
	assemble as defaultAssemble,
	type AssemblerConfig,
	type Pack,
} from "./assembler.ts";
import { loadConfig, type Config } from "./config.ts";
import { findJournal, readJournal } from "./journal.ts";
import { messageText, type ContextSnapshot, type HarnessMessage, type Turn } from "./messages.ts";
import type { BranchEntry, ExtensionAPI, HandlerContext } from "./harness.ts";
import { PostgresStore } from "./postgres-store.ts";
import { MemoryTurnSource, type TurnSink, type TurnSource } from "./thread-store.ts";
import { reconstructTurns } from "./turns.ts";

export interface Dependencies {
	config: Config;
	assemble: (turns: Turn[], config: AssemblerConfig) => Pack;
	turns: TurnSource;
	ingest?: TurnSink;
	accounting: AccountingStore;
	report: (message: string) => void;
}

const UNKNOWN_CONVERSATION = "unknown-conversation";

/**
 * Wires the Assembler into the harness.
 *
 * Everything of consequence lives behind this function: reconstruction,
 * assembly, retrieval, and accounting are pure or injected, so this adapter is
 * the only code that knows the harness exists.
 */
export function register(pi: ExtensionAPI, deps: Dependencies): void {
	const measuredByConversation = new Map<string, number>();

	/**
	 * Neither accounting nor ingest may delay the model request, so their
	 * writes are started and not awaited. Failures are reported.
	 */
	function inBackground(what: string, work: Promise<void>): void {
		void work.catch((error: unknown) => {
			deps.report(`${what} failed: ${describe(error)}`);
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		const status = await ctx.memory?.status?.();
		if (!status) return;
		if (status.active === true || (status.backend && status.backend !== "off")) {
			deps.report(
				`The harness memory backend is active (${status.backend ?? "unknown"}). ` +
					"Two systems will inject recalled content into one context window; " +
					"set memory.backend to off.",
			);
		}
	});

	pi.on("context", async (event, ctx) => {
		const conversationId = conversationOf(ctx);
		const branch = ctx.sessionManager?.getBranch?.() ?? [];
		const messages = event.messages ?? [];
		const address = addressOf(branch, messages);

		reconcile(conversationId, branch);

		try {
			const live = reconstructTurns(messages);
			const current = live[live.length - 1];

			// The current Turn always comes from the event: the Journal has not
			// been flushed for it yet, and reading our own write would race.
			const { tail, tailSource } = await tailFor(
				conversationId,
				live,
				deps.config.tailTurns,
			);

			const pack = deps.assemble(
				current ? [...tail, current] : tail,
				{ tailTurns: deps.config.tailTurns },
			);

			inBackground(
				"Accounting",
				deps.accounting.recordPack(conversationId, address, pack, tailSource),
			);

			return { messages: pack.messages };
		} catch (error) {
			// Fails open, toward the accumulating window this exists to prevent,
			// so every occurrence is reported and the Call is marked unassembled
			// rather than vanishing from the accounting.
			deps.report(`Assembly failed, turn left unassembled: ${describe(error)}`);
			inBackground(
				"Unassembled turn",
				deps.accounting.recordUnassembled(conversationId, address),
			);
			return undefined;
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		const conversationId = conversationOf(ctx);
		reconcile(conversationId, ctx.sessionManager?.getBranch?.() ?? []);
		if (deps.ingest) {
			inBackground("Ingest", ingestJournal(conversationId, deps.ingest));
		}
	});

	/**
	 * The verbatim tail, from the store when it can be reached. Falling back to
	 * the harness's own history is a worse pack, not a broken Turn — and it is
	 * recorded, so a session spent on fallback is visible afterwards.
	 */
	async function tailFor(
		conversationId: string,
		live: Turn[],
		tailTurns: number,
	): Promise<{ tail: Turn[]; tailSource: TailSource }> {
		try {
			const stored = await deps.turns.recentTurns(conversationId, tailTurns);
			if (stored.length > 0) return { tail: stored, tailSource: "thread-store" };
		} catch (error) {
			deps.report(`Thread Store unreachable, using harness history: ${describe(error)}`);
			return { tail: live.slice(0, -1), tailSource: "harness-fallback" };
		}
		// An empty store is not a failure: a Conversation's first Turns predate
		// any ingest, and the harness still has them.
		return { tail: live.slice(0, -1), tailSource: "harness-fallback" };
	}

	async function ingestJournal(
		conversationId: string,
		sink: TurnSink,
	): Promise<void> {
		const path = await findJournal(conversationId);
		if (!path) return;
		await sink.ingest(conversationId, await readJournal(path));
	}

	/** Writes any reported window size this process has not written yet. */
	function reconcile(conversationId: string, branch: BranchEntry[]): void {
		const measurements = measurementsOf(branch);
		const already = measuredByConversation.get(conversationId) ?? 0;
		const fresh = measurements.slice(already);
		if (fresh.length === 0) return;

		measuredByConversation.set(conversationId, measurements.length);
		inBackground(
			"Measurements",
			deps.accounting.recordMeasurements(conversationId, fresh),
		);
	}
}

function conversationOf(ctx: HandlerContext): string {
	return ctx.sessionManager?.getSessionId?.() ?? UNKNOWN_CONVERSATION;
}

/**
 * Where the Call about to happen sits.
 *
 * The branch holds every prompt the Conversation has ever seen, including
 * those before a clear — clearing adds a boundary marker, it does not drop
 * history — so counting prompts there numbers Turns continuously. What the
 * branch may lack is the prompt that triggered *this* Call: it is appended
 * after the context event on a new Turn, and present on the Calls of a tool
 * loop. That distinction is the whole of the arithmetic.
 */
function addressOf(
	branch: BranchEntry[],
	messages: HarnessMessage[],
): CallAddress {
	let prompts = 0;
	let callsThisTurn = 0;
	let lastPrompt: string | undefined;
	for (const entry of branch) {
		if (entry.message?.role === "user") {
			prompts++;
			callsThisTurn = 0;
			lastPrompt = messageText({
				role: "user",
				content: entry.message.content,
			});
		}
		if (entry.message?.contextSnapshot) callsThisTurn++;
	}

	const current = currentPrompt(messages);
	const inBranch = prompts > 0 && current !== undefined && current === lastPrompt;

	// Not yet in the branch: this prompt opens a Turn, at its first Call.
	if (!inBranch) return { turnIndex: prompts, callIndex: 0 };

	return { turnIndex: prompts - 1, callIndex: callsThisTurn };
}

function currentPrompt(messages: HarnessMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === "user") return messageText(message);
	}
	return undefined;
}

/** Every window size the harness has reported, addressed to its Call. */
function measurementsOf(branch: BranchEntry[]): Measurement[] {
	const measurements: Measurement[] = [];
	let turnIndex = -1;
	let callIndex = 0;
	for (const entry of branch) {
		if (entry.message?.role === "user") {
			turnIndex++;
			callIndex = 0;
		}
		const snapshot: ContextSnapshot | undefined = entry.message?.contextSnapshot;
		if (!snapshot) continue;
		measurements.push({
			turnIndex: Math.max(turnIndex, 0),
			callIndex,
			snapshot,
		});
		callIndex++;
	}
	return measurements;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export default function contextManager(pi: ExtensionAPI): void {
	const config = loadConfig(process.env);

	if (!config.databaseUrl) {
		// Without a Thread Store the Assembler still owns the window; the tail
		// simply comes from the harness's own history, as it did before.
		const memory = new MemoryTurnSource();
		register(pi, {
			config,
			assemble: defaultAssemble,
			turns: memory,
			accounting: new MemoryAccounting(),
			report: reportToStderr,
		});
		return;
	}

	const store = PostgresStore.connect(config.databaseUrl);
	void store.migrate().catch((error: unknown) => {
		reportToStderr(`Thread Store migration failed: ${describe(error)}`);
	});

	register(pi, {
		config,
		assemble: defaultAssemble,
		turns: store,
		ingest: store,
		accounting: store,
		report: reportToStderr,
	});
}

function reportToStderr(message: string): void {
	process.stderr.write(`[context-manager] ${message}\n`);
}
