// Throwaway: appends a custom entry from inside the context hook on every Call.
interface Api {
	appendEntry?: (customType: string, data: unknown) => void;
	on(event: "context", handler: (event: { messages?: unknown[] }) => Promise<undefined>): void;
}

export default function probe(pi: Api): void {
	pi.on("context", async (event) => {
		pi.appendEntry?.("probe.block", { messages: event.messages?.length ?? 0 });
		return undefined;
	});
}
