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

/**
 * What the provider charged for a Call, in the three parts that add up to
 * the window it was sent: tokens read from the prompt cache, tokens written
 * into it, and tokens neither — `input + cacheRead + cacheWrite` equals
 * `promptTokens`. Asserted on every Call of the captured Journal in
 * `test/extension.test.ts`, and checked across a machine's whole corpus by
 * `scripts/measure-pack-cache.ts --journals`.
 *
 * Named rather than carried whole: `totalTokens` is redundant against the
 * three, and `cost` is provider pricing, which is not what a Context Window
 * is measured in.
 */
export interface CallUsage {
	input?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	[key: string]: unknown;
}

export interface HarnessMessage {
	role: string;
	content?: string | ContentBlock[];
	attribution?: string;
	timestamp?: number;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	usage?: CallUsage;
	contextSnapshot?: ContextSnapshot;
	[key: string]: unknown;
}

/** A user prompt and everything the agent produced in response to it. */
export interface Turn {
	/**
	 * Where this Turn sits in its Conversation, when it came from the Thread
	 * Store. Absent for a Turn reconstructed from the live message array,
	 * which has no durable identity yet.
	 */
	index?: number;
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

/**
 * The harness's messages with any compaction it made reduced to its prose.
 *
 * A compaction summary's `providerPayload` is a provider-native block that
 * stands in for the history it summarised, and the provider refuses it
 * anywhere but the head of the conversation. A Pack carries that history
 * from the Thread Store ahead of the current Turn, so the block is misplaced
 * by construction. Without the payload the harness sends the summary as
 * text, which can sit anywhere. Payloads on other messages mean other things
 * and are left alone.
 */
export function withoutNativeCompaction(messages: HarnessMessage[]): HarnessMessage[] {
	return messages.map((message) => {
		if (message.role !== "compactionSummary" || !("providerPayload" in message)) {
			return message;
		}
		const { providerPayload: _native, ...prose } = message;
		return prose as HarnessMessage;
	});
}

/**
 * Whether a content block is a tool call, narrowing it to one.
 *
 * A guard rather than a cast at each use: `ContentBlock` admits blocks this
 * project does not know, so `type === "toolCall"` alone narrows to "a
 * toolCall or something unknown that says it is one".
 */
export function isToolCall(block: ContentBlock): block is ToolCallBlock {
	return block.type === "toolCall" && "name" in block;
}

/**
 * A tool call as text, in the pieces a shortener needs: what names it, what
 * it passed, and what closes it.
 *
 * Split because only the arguments may give way. A call's name is what says
 * the Turn did something; the file it wrote can be a Budget's worth of text
 * on its own.
 */
export function toolCallText(call: ToolCallBlock): {
	head: string;
	passed: string;
	tail: string;
} {
	return {
		head: `${call.name}(`,
		passed: JSON.stringify(call.arguments ?? {}),
		tail: ")",
	};
}

/**
 * How a tool call reads as text: the name it was made with and the arguments
 * it carried.
 *
 * One rendering, because two places need a call to read the same way — the
 * text a Turn is embedded as, and the recollection an agent reads. A call
 * rendered one way in the vector and another in the Pack would be findable
 * by words it is never shown with.
 */
export function renderToolCall(call: ToolCallBlock): string {
	const { head, passed, tail } = toolCallText(call);
	return `${head}${passed}${tail}`;
}
