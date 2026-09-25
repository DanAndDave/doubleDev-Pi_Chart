import type { HarnessMessage } from "./messages.ts";

/**
 * Deterministic stand-in for a tokenizer: the serialized message over four.
 *
 * Over the whole message, not its `content` alone: `details`, `toolName` and
 * `toolCallId` are sent with it and are comparable in size to `content` on a
 * real tool result. Measured against the harness's own reported figures over
 * 27 Calls of linear Journals, content-only ran 1.35× low at the median and
 * whole-message runs 1.15×, which is why the ceiling's default carries the
 * p90 of that residual as headroom.
 *
 * Fields the harness records but does not send onward are excluded, so the
 * estimate tracks what a provider is billed for rather than what a Journal
 * happens to keep.
 */
export function approximateTokens(messages: HarnessMessage[]): number {
	let characters = 0;
	for (const message of messages) characters += serialized(message).length;
	return Math.ceil(characters / 4);
}

/** Recorded by the harness, never sent to the model. */
const UNSENT: Record<string, true> = {
	contextSnapshot: true,
	usage: true,
	timestamp: true,
	api: true,
	provider: true,
	model: true,
	stopReason: true,
};

function serialized(message: HarnessMessage): string {
	const sent: Record<string, unknown> = {};
	// Key order follows the message's own, so the estimate is a function of
	// the message and not of insertion history.
	for (const [key, value] of Object.entries(message)) {
		if (UNSENT[key] === true || value === undefined) continue;
		sent[key] = value;
	}
	return JSON.stringify(sent);
}
