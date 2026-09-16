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
			});
			continue;
		}

		current.messages.push(message);
	}

	return turns;
}
