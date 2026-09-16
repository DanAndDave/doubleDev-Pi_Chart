import { AccountingLog } from "./accounting.ts";
import { assemble as defaultAssemble, type Pack } from "./assembler.ts";
import { loadConfig, type Config } from "./config.ts";
import type { ContextSnapshot, HarnessMessage, Turn } from "./messages.ts";
import type { ExtensionAPI, HandlerContext } from "./harness.ts";
import { reconstructTurns } from "./turns.ts";

export interface Recorder {
	recordPack(
		conversationId: string,
		callIndex: number,
		pack: Pack,
	): Promise<void>;
	recordMeasurements(
		conversationId: string,
		snapshots: ContextSnapshot[],
		firstCallIndex: number,
	): Promise<void>;
}

export interface Dependencies {
	config: Config;
	assemble: (turns: Turn[], config: { tailTurns: number }) => Pack;
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
		try {
			const turns = reconstructTurns(event.messages ?? []);
			const pack = deps.assemble(turns, { tailTurns: deps.config.tailTurns });

			// Derived from the session, not counted in this process: a resumed
			// conversation must not restart at zero and overwrite its own history.
			const callIndex = snapshotsOf(ctx).length;

			// A call's reported size only exists once the provider has answered,
			// which may be after this process's last agent_end. Sweeping here too
			// means the next turn — or the next process — still records it.
			await reconcile(conversationId, snapshotsOf(ctx));

			try {
				await deps.accounting.recordPack(conversationId, callIndex, pack);
			} catch (error) {
				deps.report(`Accounting was not recorded: ${describe(error)}`);
			}

			return { messages: pack.messages };
		} catch (error) {
			// Fails open, toward the accumulating window this exists to prevent,
			// so every occurrence is reported rather than logged once.
			deps.report(`Assembly failed, turn left unassembled: ${describe(error)}`);
			return undefined;
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		await reconcile(conversationOf(ctx), snapshotsOf(ctx));
	});

	/** Writes any reported window size this process has not written yet. */
	async function reconcile(
		conversationId: string,
		snapshots: ContextSnapshot[],
	): Promise<void> {
		const already = measuredByConversation.get(conversationId) ?? 0;
		const fresh = snapshots.slice(already);
		if (fresh.length === 0) return;

		try {
			await deps.accounting.recordMeasurements(conversationId, fresh, already);
			measuredByConversation.set(conversationId, snapshots.length);
		} catch (error) {
			deps.report(`Measurements were not recorded: ${describe(error)}`);
		}
	}
}

function conversationOf(ctx: HandlerContext): string {
	return ctx.sessionManager?.getSessionId?.() ?? UNKNOWN_CONVERSATION;
}

/** Every window size the harness has reported for this conversation, in order. */
function snapshotsOf(ctx: HandlerContext): ContextSnapshot[] {
	const snapshots: ContextSnapshot[] = [];
	for (const entry of ctx.sessionManager?.getBranch?.() ?? []) {
		const snapshot = entry.message?.contextSnapshot;
		if (snapshot) snapshots.push(snapshot);
	}
	return snapshots;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export default function contextManager(pi: ExtensionAPI): void {
	const config = loadConfig(process.env);
	register(pi, {
		config,
		assemble: defaultAssemble,
		accounting: new AccountingLog(config.accountingDir),
		report: (message) => {
			process.stderr.write(`[context-manager] ${message}\n`);
		},
	});
}

export type { HarnessMessage };
