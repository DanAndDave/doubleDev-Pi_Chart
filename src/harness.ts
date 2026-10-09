// Structural view of the harness extension API. Only the surface this
// extension uses is declared; the adapter is the one place that touches
// harness types, so a change to them is confined here.

import type {
	CallUsage,
	ContextSnapshot,
	HarnessMessage,
} from "./messages.ts";

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
	id?: string;
	type?: string;
	/** An extension's own `custom` entry: its namespaced name. */
	customType?: string;
	/** An extension's own `custom` entry: what it holds. */
	data?: unknown;
	message?: {
		role?: string;
		content?: HarnessMessage["content"];
		contextSnapshot?: ContextSnapshot;
		/** What the provider charged for the Call this entry answered. */
		usage?: CallUsage;
	};
}

/**
 * The harness's UI, where a session has one. Every method is optional:
 * headless and print runs supply no-ops, and RPC a subset.
 */
export interface HarnessUI {
	notify?: (message: string, level: string) => void;
	/** A footer status under `key`; `undefined` clears it. */
	setStatus?: (key: string, text: string | undefined) => void;
	/** A multi-line editor: the submitted text, or `undefined` if cancelled. */
	editor?: (title: string, prefill?: string) => Promise<string | undefined>;
}

export interface SessionView {
	getSessionId?: () => string | undefined;
	/** The path from the root to `fromId`, or to the current leaf. */
	getBranch?: (fromId?: string) => BranchEntry[];
	/** Every entry of the current session file, in the order written. */
	getEntries?: () => BranchEntry[];
}

export interface HandlerContext {
	sessionManager?: SessionView;
	memory?: { status?: () => Promise<MemoryStatus> | MemoryStatus };
	ui?: HarnessUI;
	/**
	 * The host's credential resolution: environment, every `.env` it loads,
	 * and `/login`. Optional because it is outside the documented extension
	 * surface; its absence means no key, which is the unjudged search.
	 */
	modelRegistry?: {
		getApiKeyForProvider?: (
			provider: string,
			sessionId?: string,
		) => Promise<string | undefined> | string | undefined;
	};
}

export type ContextHandler = (
	event: ContextEvent,
	ctx: HandlerContext,
) => Promise<ContextResult | undefined>;

export type LifecycleHandler = (
	event: unknown,
	ctx: HandlerContext,
) => Promise<void>;

/** A move of the leaf inside the Conversation's tree, by `/tree` or `/branch`. */
export interface SessionTreeEvent {
	/** Where the branch ended before the move; absent at the session root. */
	oldLeafId?: string | null;
}

export type SessionTreeHandler = (
	event: SessionTreeEvent,
	ctx: HandlerContext,
) => Promise<void>;

/**
 * The session moved to another file. `new` and `resume` open another
 * Conversation; `fork` copies every entry of the current file into a new one.
 */
export interface SessionSwitchEvent {
	reason?: string;
	previousSessionFile?: string;
}

export type SessionSwitchHandler = (
	event: SessionSwitchEvent,
	ctx: HandlerContext,
) => Promise<void>;

/**
 * The session moved to a new file holding only the root-to-leaf path of
 * the old one: `branch`, `fork` at an entry, or `btw` promotion.
 */
export interface SessionBranchEvent {
	reason?: string;
	previousSessionFile?: string;
}

export type SessionBranchHandler = (
	event: SessionBranchEvent,
	ctx: HandlerContext,
) => Promise<void>;

/** Why the harness started compacting on its own, in its own words. */
export interface CompactionStartEvent {
	/** `threshold`, `idle`, `overflow`, `incomplete`, or whatever it adds. */
	reason?: string;
}

export type CompactionStartHandler = (
	event: CompactionStartEvent,
	ctx: HandlerContext,
) => Promise<void>;

/** What a `session_before_compact` handler may answer; absent lets it run. */
export interface CompactionDecision {
	cancel: boolean;
}

export type BeforeCompactHandler = (
	event: unknown,
	ctx: HandlerContext,
) => Promise<CompactionDecision | undefined>;

export interface CommandContext {
	ui?: HarnessUI;
	sessionManager?: SessionView;
	/** Whether the runner has a real UI rather than no-op methods. */
	hasUI?: boolean;
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

/**
 * The harness's shared file logger. An extension's diagnostics belong here,
 * not on stdout/stderr, which the TUI renders into the composer. Only the
 * levels this extension emits are declared.
 */
export interface Logger {
	info(message: string): void;
	warn(message: string): void;
}

export interface ExtensionAPI {
	on(event: "context", handler: ContextHandler): void;
	on(
		event: "session_start" | "agent_end" | "session_shutdown",
		handler: LifecycleHandler,
	): void;
	on(event: "session_tree", handler: SessionTreeHandler): void;
	on(event: "session_switch", handler: SessionSwitchHandler): void;
	on(event: "session_branch", handler: SessionBranchHandler): void;
	on(event: "auto_compaction_start", handler: CompactionStartHandler): void;
	on(event: "auto_compaction_end", handler: LifecycleHandler): void;
	on(event: "session_before_compact", handler: BeforeCompactHandler): void;
	registerCommand?: (name: string, command: CommandDefinition) => void;
	registerTool?: (tool: ToolDefinition) => void;
	/**
	 * Appends an extension-owned `custom` entry to the Journal at the
	 * current leaf. The harness never sends one to the model.
	 */
	appendEntry?: (customType: string, data: unknown) => void;
	/** Schema builder the harness injects; tool parameters are built with it. */
	zod?: SchemaBuilder;
	/** The shared file logger; where this extension's reports are written. */
	logger: Logger;
}
