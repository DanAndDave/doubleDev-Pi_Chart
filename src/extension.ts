import { Accounting, type CallAddress } from "./accounting.ts";
import {
	assemble as defaultAssemble,
	type AssemblerConfig,
	type Pack,
} from "./assembler.ts";
import { loadConfig, type Config } from "./config.ts";
import type { ContextSnapshot, HarnessMessage, Turn } from "./messages.ts";
import type { BranchEntry, ExtensionAPI, HandlerContext } from "./harness.ts";
import { reconstructTurns } from "./turns.ts";

export interface Recorder {
	recordPack(
		conversationId: string,
		address: CallAddress,
		pack: Pack,
	): Promise<void>;
	recordUnassembled(
		conversationId: string,
		address: CallAddress,
	): Promise<void>;
	recordMeasurements(
		conversationId: string,
		measurements: (CallAddress & { snapshot: ContextSnapshot })[],
	): Promise<void>;
}

export interface Dependencies {
	config: Config;
	assemble: (turns: Turn[], config: AssemblerConfig) => Pack;
	accounting: Recorder;
	report: (message: string) => void;
}

const UNKNOWN_CONVERSATION = "unknown-conversation";

/**
 * Wires the Assembler into the harness.
 *
 * Everything of consequence lives behind this function: reconstruction,
 * assembly, and accounting are pure or injected, so this adapter is the only
 * code that knows the harness exists.
 */
export function register(pi: ExtensionAPI, deps: Dependencies): void {
	const measuredByConversation = new Map<string, number>();

	/**
	 * Accounting must never delay the model request, so writes are started and
	 * not awaited. Failures are reported rather than surfaced to the turn.
	 */
	function recordInBackground(what: string, write: Promise<void>): void {
		void write.catch((error: unknown) => {
			deps.report(`${what} was not recorded: ${describe(error)}`);
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
		const address = addressOf(branch, event.messages ?? []);

		// A Call's reported size only exists once the provider has answered,
		// which may be after this process's last agent_end. Sweeping here too
		// means the next Turn — or the next process — still records it.
		reconcile(conversationId, branch);

		try {
			const turns = reconstructTurns(event.messages ?? []);
			const pack = deps.assemble(turns, { tailTurns: deps.config.tailTurns });

			recordInBackground(
				"Accounting",
				deps.accounting.recordPack(conversationId, address, pack),
			);

			return { messages: pack.messages };
		} catch (error) {
			// Fails open, toward the accumulating window this exists to prevent,
			// so every occurrence is reported and the Call is marked unassembled
			// rather than vanishing from the accounting.
			deps.report(`Assembly failed, turn left unassembled: ${describe(error)}`);
			recordInBackground(
				"Unassembled turn",
				deps.accounting.recordUnassembled(conversationId, address),
			);
			return undefined;
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		reconcile(conversationOf(ctx), ctx.sessionManager?.getBranch?.() ?? []);
	});

	/** Writes any reported window size this process has not written yet. */
	function reconcile(conversationId: string, branch: BranchEntry[]): void {
		const measurements = measurementsOf(branch);
		const already = measuredByConversation.get(conversationId) ?? 0;
		const fresh = measurements.slice(already);
		if (fresh.length === 0) return;

		measuredByConversation.set(conversationId, measurements.length);
		recordInBackground(
			"Measurements",
			deps.accounting.recordMeasurements(conversationId, fresh),
		);
	}
}

function conversationOf(ctx: HandlerContext): string {
	return ctx.sessionManager?.getSessionId?.() ?? UNKNOWN_CONVERSATION;
}

/**
 * Where the Call about to happen sits: Turns are counted from the prompts in
 * the session, and Calls from the windows the harness has reported *within*
 * the current Turn. Both come from the session rather than from a counter, so
 * a resumed Conversation does not restart at zero and overwrite its history.
 *
 * The session branch can lag the prompt that triggered this Call — on a
 * resumed Conversation the new prompt is not in it yet — so the event's own
 * message array, which always carries it, decides the Turn.
 */
function addressOf(
	branch: BranchEntry[],
	messages: HarnessMessage[],
): CallAddress {
	let turnIndex = -1;
	let callIndex = 0;
	for (const entry of branch) {
		if (entry.message?.role === "user") {
			turnIndex++;
			callIndex = 0;
		}
		if (entry.message?.contextSnapshot) callIndex++;
	}

	let prompts = 0;
	for (const message of messages) if (message.role === "user") prompts++;

	// A prompt the branch has not caught up with starts a Turn, at its first Call.
	if (prompts > turnIndex + 1) return { turnIndex: prompts - 1, callIndex: 0 };

	return { turnIndex: Math.max(turnIndex, 0), callIndex };
}

/** Every window size the harness has reported, addressed to its Call. */
function measurementsOf(
	branch: BranchEntry[],
): (CallAddress & { snapshot: ContextSnapshot })[] {
	const measurements: (CallAddress & { snapshot: ContextSnapshot })[] = [];
	let turnIndex = -1;
	let callIndex = 0;
	for (const entry of branch) {
		if (entry.message?.role === "user") {
			turnIndex++;
			callIndex = 0;
		}
		const snapshot = entry.message?.contextSnapshot;
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
	register(pi, {
		config,
		assemble: defaultAssemble,
		accounting: new Accounting(config.accountingDir),
		report: (message) => {
			process.stderr.write(`[context-manager] ${message}\n`);
		},
	});
}
