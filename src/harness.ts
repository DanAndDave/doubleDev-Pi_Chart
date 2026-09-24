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
	message?: {
		role?: string;
		content?: HarnessMessage["content"];
		contextSnapshot?: ContextSnapshot;
	};
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

export interface CommandContext {
	ui?: { notify?: (message: string, level: string) => void };
}

export interface CommandDefinition {
	description: string;
	handler: (args: string, ctx: CommandContext) => Promise<void> | void;
}

export interface ToolResult {
	content: { type: "text"; text: string }[];
	details?: Record<string, unknown>;
}

/** The sliver of the harness's schema builder this extension uses. */
export interface SchemaField {
	describe(text: string): SchemaField;
	optional(): SchemaField;
}

export interface SchemaBuilder {
	object(shape: Record<string, SchemaField>): unknown;
	string(): SchemaField;
	number(): SchemaField;
	/** For what a Concept declares it is not, and what it was drawn from. */
	array(of: unknown): SchemaField;
	/** For a choice the tool must make explicitly, such as create or revise. */
	enum(values: string[]): SchemaField;
	/** For an argument that is declared only so it can be refused by name. */
	unknown(): SchemaField;
}

export interface ToolDefinition {
	name: string;
	label: string;
	description: string;
	parameters: unknown;
	execute: (
		id: string,
		params: Record<string, unknown>,
	) => Promise<ToolResult>;
}

export interface ExtensionAPI {
	on(event: "context", handler: ContextHandler): void;
	on(
		event: "session_start" | "agent_end" | "session_shutdown",
		handler: LifecycleHandler,
	): void;
	registerCommand?: (name: string, command: CommandDefinition) => void;
	registerTool?: (tool: ToolDefinition) => void;
	/** Schema builder the harness injects; tool parameters are built with it. */
	zod?: SchemaBuilder;
}
