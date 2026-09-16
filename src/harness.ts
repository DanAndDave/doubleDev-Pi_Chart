// Structural view of the harness extension API. Only the surface this
// extension uses is declared; the adapter is the one place that touches
// harness types, so a change to them is confined here.

import type { ContextSnapshot, HarnessMessage } from "./messages.ts";

export interface ContextEvent {
	messages?: HarnessMessage[];
}

export interface ContextResult {
	messages: HarnessMessage[];
}

export interface MemoryStatus {
	backend?: string;
	active?: boolean;
}

export interface BranchEntry {
	type?: string;
	message?: { role?: string; contextSnapshot?: ContextSnapshot };
}

export interface HandlerContext {
	sessionManager?: {
		getSessionId?: () => string | undefined;
		getBranch?: () => BranchEntry[];
	};
	memory?: { status?: () => Promise<MemoryStatus> | MemoryStatus };
	ui?: { notify?: (message: string, level: string) => void };
}

export type ContextHandler = (
	event: ContextEvent,
	ctx: HandlerContext,
) => Promise<ContextResult | undefined>;

export type LifecycleHandler = (
	event: unknown,
	ctx: HandlerContext,
) => Promise<void>;

export interface ExtensionAPI {
	on(event: "context", handler: ContextHandler): void;
	on(event: "session_start" | "agent_end", handler: LifecycleHandler): void;
}
