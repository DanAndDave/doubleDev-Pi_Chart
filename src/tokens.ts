import type { HarnessMessage } from "./messages.ts";

/**
 * Deterministic stand-in for a tokenizer: the serialized message over four.
 *
 * Over the whole message, not its `content` alone: `toolName`, `toolCallId`
 * and `isError` travel with a tool result, and a tool call's arguments with
 * the assistant message that made it.
 *
 * What the harness records but no provider is sent is excluded, so the
 * estimate tracks what a provider charges as input rather than what a
 * Journal happens to keep. That covers a tool result's `details` (every
 * provider builds the result from its content and call id alone) and the
 * harness's record of the response. A thinking block's signature is sent but
 * not charged: over the gate-v1 vanilla Journals the reported prompt grew by
 * 39,000 tokens more than the rest of what was added, against 76,000
 * estimated for the signatures and 13,000 for the thinking text. So the
 * signature is excluded and the text is counted.
 *
 * Measured against the harness's reported window, less its non-message
 * figure, over 624 Calls of those Journals, the window runs 1.57× this
 * estimate at the median and 1.84× at the p90, which is why the ceiling's
 * default carries 1.85 as headroom.
 */
export function approximateTokens(messages: HarnessMessage[]): number {
	let characters = 0;
	for (const message of messages) characters += serialized(message).length;
	return Math.ceil(characters / 4);
}

/** Recorded on a message by the harness or pi-chart, never sent to a provider. */
const UNSENT: Record<string, true> = {
	contextSnapshot: true,
	usage: true,
	timestamp: true,
	api: true,
	provider: true,
	model: true,
	stopReason: true,
	details: true,
	inputTransformations: true,
	requestControls: true,
	responseId: true,
	duration: true,
	ttft: true,
	completedAt: true,
	credentialId: true,
	errorMessage: true,
	errorId: true,
	errorStatus: true,
	retryRecovery: true,
	attribution: true,
	synthetic: true,
	userInitiated: true,
	prunedAt: true,
	useless: true,
	piChartShortened: true,
};

/**
 * Recorded on a content block but not charged as input: a thinking block's
 * signature, and the copy of a tool call's arguments' `i` the harness keeps
 * beside them.
 */
const UNSENT_IN_BLOCK: Record<string, true> = {
	thinkingSignature: true,
	intent: true,
};

function serialized(message: HarnessMessage): string {
	const sent: Record<string, unknown> = {};
	// Key order follows the message's own, so the estimate is a function of
	// the message and not of insertion history.
	for (const [key, value] of Object.entries(message)) {
		if (UNSENT[key] === true || value === undefined) continue;
		sent[key] = key === "content" ? sentContent(value) : value;
	}
	return JSON.stringify(sent);
}

/**
 * The content as sent. The estimate runs inside shrinking loops, so the array
 * is rebuilt only when a block carries an unsent key, and only those blocks
 * are copied.
 */
function sentContent(content: unknown): unknown {
	if (!Array.isArray(content)) return content;
	let rebuilt: unknown[] | undefined;
	for (let index = 0; index < content.length; index++) {
		const block: unknown = content[index];
		if (!carriesUnsent(block)) continue;
		rebuilt ??= content.slice();
		rebuilt[index] = withoutUnsent(block);
	}
	return rebuilt ?? content;
}

function carriesUnsent(block: unknown): block is Record<string, unknown> {
	if (typeof block !== "object" || block === null) return false;
	for (const key in block) if (UNSENT_IN_BLOCK[key] === true) return true;
	return false;
}

function withoutUnsent(block: Record<string, unknown>): Record<string, unknown> {
	const sent: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(block)) {
		if (UNSENT_IN_BLOCK[key] !== true) sent[key] = value;
	}
	return sent;
}
