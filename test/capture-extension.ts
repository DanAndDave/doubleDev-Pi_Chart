// Development-time extension: records the message array the harness hands to
// the `context` event, so fixtures come from real sessions rather than from a
// guess at the shape. Writes to CM_CAPTURE_FILE and changes nothing.

import { appendFileSync } from "node:fs";

interface CaptureEvent {
	messages?: unknown[];
}

interface CaptureAPI {
	on(
		event: "context",
		handler: (event: CaptureEvent) => Promise<undefined>,
	): void;
}

export default function captureExtension(pi: CaptureAPI): void {
	const target = process.env.CM_CAPTURE_FILE;
	if (!target) return;

	pi.on("context", async (event) => {
		appendFileSync(target, JSON.stringify(event.messages ?? []) + "\n");
		return undefined;
	});
}
