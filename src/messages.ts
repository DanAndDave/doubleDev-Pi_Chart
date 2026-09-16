// Structural view of the messages the harness hands to the `context` event.
// Deliberately tolerant: unknown roles, block types, and extra fields are
// carried through untouched rather than rejected, because this shape belongs
// to the harness and will change without us.

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	arguments?: unknown;
	intent?: string;
}

export type ContentBlock = TextBlock | ToolCallBlock | { type: string };

/** What the harness reports about the window it actually sent. */
export interface ContextSnapshot {
	promptTokens: number;
	nonMessageTokens: number;
	compactionEpoch?: number;
}

export interface HarnessMessage {
	role: string;
	content?: string | ContentBlock[];
	attribution?: string;
	timestamp?: number;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	usage?: { totalTokens?: number; [key: string]: unknown };
	contextSnapshot?: ContextSnapshot;
	[key: string]: unknown;
}

/** A user prompt and everything the agent produced in response to it. */
export interface Turn {
	/** The prompt's text, for identification and testing. */
	prompt: string;
	/** Every message belonging to this turn, prompt first, in order. */
	messages: HarnessMessage[];
}

export function messageText(message: HarnessMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block.type === "text" && "text" in block && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}
