// Throwaway: after every user prompt, insert a deterministic turn-scoped
// developer message, so the same bytes land at the same position on every Call.
interface Message {
	role: string;
	content?: unknown;
	timestamp?: number;
}

interface ContextEvent {
	messages?: Message[];
}

interface Api {
	on(event: "context", handler: (event: ContextEvent) => Promise<{ messages: Message[] }>): void;
}

function promptText(m: Message): string {
	if (typeof m.content === "string") return m.content;
	if (!Array.isArray(m.content)) return "";
	return m.content
		.map((b: unknown) =>
			typeof b === "object" && b !== null && "text" in b && typeof b.text === "string" ? b.text : "",
		)
		.join("");
}

export default function probe(pi: Api): void {
	pi.on("context", async (event) => {
		const out: Message[] = [];
		for (const m of event.messages ?? []) {
			out.push(m);
			if (m.role !== "user") continue;
			const prompt = promptText(m);
			out.push({
				role: "developer",
				content: [
					{
						type: "text",
						text: `[probe background for the prompt "${prompt.slice(0, 40)}": the secret word is HERON]`,
					},
				],
				providerPayload: { type: "anthropicMessage", clearAt: "next_user_message" },
				timestamp: m.timestamp,
			} as Message);
		}
		return { messages: out };
	});
}
