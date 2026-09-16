import { messageText, type HarnessMessage, type Turn } from "./messages.ts";

/**
 * Groups a flat harness message array into Turns: each user prompt together
 * with the agent output, tool calls, and tool results that answer it.
 *
 * The tail of a Context Pack is measured in Turns rather than messages so a
 * tool call is never separated from its result.
 */
export function reconstructTurns(messages: HarnessMessage[]): Turn[] {
	const turns: Turn[] = [];

	for (const message of messages) {
		const startsTurn = message.role === "user";
		const current = turns[turns.length - 1];

		if (startsTurn || current === undefined) {
			turns.push({
				prompt: startsTurn ? messageText(message) : "",
				messages: [message],
				inProgress: true,
			});
			continue;
		}

		current.messages.push(message);
	}

	for (const turn of turns) {
		const last = turn.messages[turn.messages.length - 1];
		turn.inProgress =
			last === undefined ||
			last.role === "user" ||
			last.role === "toolResult" ||
			hasPendingToolCall(turn.messages);
	}

	return turns;
}

/** True when a tool call in this turn has no matching result yet. */
function hasPendingToolCall(messages: HarnessMessage[]): boolean {
	const answered = new Set<string>();
	for (const message of messages) {
		if (message.role === "toolResult" && typeof message.toolCallId === "string") {
			answered.add(message.toolCallId);
		}
	}
	for (const message of messages) {
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (block.type !== "toolCall") continue;
			const id = "id" in block ? block.id : undefined;
			if (typeof id === "string" && !answered.has(id)) return true;
		}
	}
	return false;
}
