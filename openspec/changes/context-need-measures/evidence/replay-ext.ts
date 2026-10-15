// Throwaway (ticket 04, "Can a Call be replayed"). Loaded with `-e` beside
// pi-chart or alone. Wraps `globalThis.fetch`, below omp's own OAuth body
// patch, so what it sees is the exact body that leaves the process.
//
// omp 18.10 sends Anthropic Calls through its own node:https transport and
// reaches `globalThis.fetch` only when a proxy is configured, so this needs
// PI_PROXY_ANTHROPIC set (to anything: the proxy is stripped before a
// request is forwarded, and in stub mode nothing is forwarded). Without it,
// a stub run would talk to the real model; the extension refuses to load.
//
//   REPLAY_MODE=record  forward each Call to Anthropic; keep its request.
//   REPLAY_MODE=stub    answer Call k with the Journal's k-th assistant
//                       message and give every tool call the Journal's
//                       recorded result; keep the request omp built.
//
// Both modes also ask Anthropic's token-counting endpoint (free) to count the
// request as sent, with the request's own headers, and keep the count.
// REPLAY_DIR receives call-NNN.json; REPLAY_JOURNAL names the Journal to stub
// from. Credentials are never written: auth headers are dropped before saving.
//
// REPLAY_SESSION_ID (stub, optional): the original Conversation's id, put back
// into `metadata.user_id` before omp computes the body's billing hash (`cch`
// in the first system block): the two fields a replay's new session changes.
// REPLAY_TODAY (stub, optional): the original Run's local date, YYYY-MM-DD.
// omp puts "Today: <date>" in the first user message; a replay on another
// day changes that prefix, and the server then drops every thinking block
// bound to the old prefix.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Block {
	type: string;
	text?: string;
	thinking?: string;
	thinkingSignature?: string;
	id?: string;
	name?: string;
	arguments?: unknown;
}

interface JournalMessage {
	role: string;
	content: Block[] | string;
	usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
	stopReason?: string;
	toolCallId?: string;
	details?: unknown;
	isError?: boolean;
	model?: string;
	/** What the provider reported changing in the request, kept on the message by omp. */
	inputTransformations?: unknown[];
	[field: string]: unknown;
}

/**
 * What omp writes on an assistant message from the response and the clock,
 * not from the request. pi-chart sizes a Turn over every field the Journal
 * keeps but `usage`/`timestamp`/…, so a replay that left the replay's own
 * values here would size Turns differently and evict the tail elsewhere.
 */
const OBSERVED = ["timestamp", "responseId", "duration", "ttft", "completedAt", "inputTransformations"];

interface Api {
	on(event: string, handler: (event: Record<string, unknown>) => unknown): void;
}

const MODE = process.env.REPLAY_MODE;
const DIR = process.env.REPLAY_DIR ?? "";
const SECRET = /^(authorization|x-api-key|cookie)$/i;
/** Fields the token-counting endpoint takes; the rest of a Call's body it rejects. */
const COUNTED = ["model", "messages", "system", "tools", "tool_choice", "thinking", "context_management"];

function journalMessages(): JournalMessage[] {
	const out: JournalMessage[] = [];
	for (const line of readFileSync(process.env.REPLAY_JOURNAL ?? "", "utf8").split("\n")) {
		if (!line.trim()) continue;
		const entry = JSON.parse(line) as { type?: string; message?: JournalMessage };
		if (entry.type === "message" && entry.message) out.push(entry.message);
	}
	return out;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	new Headers(init?.headers).forEach((value, key) => {
		out[key] = value;
	});
	return out;
}

function bodyText(body: BodyInit | null | undefined): string {
	if (typeof body === "string") return body;
	if (body instanceof Uint8Array) return new TextDecoder().decode(body);
	if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
	throw new Error(`replay-ext: unexpected request body ${Object.prototype.toString.call(body)}`);
}

async function count(
	real: typeof fetch,
	url: URL,
	headers: Record<string, string>,
	body: Record<string, unknown>,
): Promise<{ input_tokens?: number; error?: string }> {
	const counted: Record<string, unknown> = {};
	for (const key of COUNTED) if (key in body) counted[key] = body[key];
	const target = new URL(url);
	target.pathname = "/v1/messages/count_tokens";
	const sent = { ...headers };
	delete sent["content-length"];
	sent.accept = "application/json";
	for (let attempt = 0; attempt < 5; attempt++) {
		const res = await real(target, { method: "POST", headers: sent, body: JSON.stringify(counted) });
		const text = await res.text();
		if (res.ok) return JSON.parse(text) as { input_tokens: number };
		if (res.status !== 429 && res.status < 500) return { error: `${res.status} ${text.slice(0, 400)}` };
		await Bun.sleep(2000 * (attempt + 1));
	}
	return { error: "count_tokens kept failing" };
}

function sse(message: JournalMessage, wire: (name: string) => string): string {
	const events: string[] = [];
	const emit = (type: string, data: Record<string, unknown>) =>
		events.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	const usage = message.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	emit("message_start", {
		message: {
			id: `msg_replay_${Date.now()}`,
			type: "message",
			role: "assistant",
			model: message.model,
			content: [],
			// Echoed as the provider sent them: omp keeps them on the message,
			// where pi-chart's Turn sizes (the tail's eviction input) count them.
			...(message.inputTransformations ? { input_transformations: message.inputTransformations } : {}),
			stop_reason: null,
			stop_sequence: null,
			usage: {
				input_tokens: usage.input,
				cache_creation_input_tokens: usage.cacheWrite,
				cache_read_input_tokens: usage.cacheRead,
				output_tokens: 1,
			},
		},
	});
	const blocks = Array.isArray(message.content) ? message.content : [];
	blocks.forEach((block, index) => {
		if (block.type === "thinking") {
			emit("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
			emit("content_block_delta", { index, delta: { type: "thinking_delta", thinking: block.thinking ?? "" } });
			emit("content_block_delta", {
				index,
				delta: { type: "signature_delta", signature: block.thinkingSignature ?? "" },
			});
		} else if (block.type === "text") {
			emit("content_block_start", { index, content_block: { type: "text", text: "" } });
			emit("content_block_delta", { index, delta: { type: "text_delta", text: block.text ?? "" } });
		} else if (block.type === "toolCall") {
			emit("content_block_start", {
				index,
				content_block: { type: "tool_use", id: block.id, name: wire(block.name ?? ""), input: {} },
			});
			emit("content_block_delta", {
				index,
				delta: { type: "input_json_delta", partial_json: JSON.stringify(block.arguments ?? {}) },
			});
		} else {
			throw new Error(`replay-ext: no stub for a ${block.type} block`);
		}
		emit("content_block_stop", { index });
	});
	const stop = { toolUse: "tool_use", stop: "end_turn", length: "max_tokens" }[message.stopReason ?? "stop"];
	emit("message_delta", { delta: { stop_reason: stop ?? "end_turn", stop_sequence: null }, usage: { output_tokens: usage.output } });
	emit("message_stop", {});
	return events.join("");
}

export default function replay(pi: Api): void {
	if (MODE !== "record" && MODE !== "stub") return;
	if (!process.env.PI_PROXY_ANTHROPIC) {
		throw new Error("replay-ext: set PI_PROXY_ANTHROPIC, or omp bypasses globalThis.fetch");
	}
	mkdirSync(DIR, { recursive: true });
	const journal = MODE === "stub" ? journalMessages() : [];
	const replies = journal.filter((m) => m.role === "assistant");
	const results = new Map(journal.filter((m) => m.role === "toolResult").map((m) => [m.toolCallId, m]));
	const real = globalThis.fetch.bind(globalThis);

	const wrapped = async (input: RequestInfo | URL, given?: RequestInit): Promise<Response> => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		// Bun's fetch honours `proxy`; the one omp adds names nothing real.
		const { proxy: _proxy, ...init } = (given ?? {}) as RequestInit & { proxy?: string };
		const isCall =
			url.hostname === "api.anthropic.com" && url.pathname === "/v1/messages" && (init?.method ?? "GET") === "POST";
		if (!isCall) {
			if (MODE === "stub" && url.hostname === "api.anthropic.com") {
				throw new Error(`replay-ext: unexpected request to ${url} while stubbing`);
			}
			return real(input, init);
		}
		const index = readdirSync(DIR).filter((name) => /^call-\d+\.json$/.test(name)).length;
		const raw = bodyText(init.body);
		const body = JSON.parse(raw) as Record<string, unknown>;
		const headers = headersOf(init);
		const tokens = await count(real, url, headers, body);
		const saved = Object.fromEntries(Object.entries(headers).filter(([key]) => !SECRET.test(key)));
		const file = join(DIR, `call-${String(index).padStart(3, "0")}.json`);
		const record: Record<string, unknown> = { index, url: String(url), headers: saved, body: raw, count: tokens };
		writeFileSync(file, JSON.stringify(record));

		if (MODE === "record") {
			const res = await real(input, init);
			record.status = res.status;
			writeFileSync(file, JSON.stringify(record));
			return res;
		}
		const reply = replies[index];
		if (!reply) throw new Error(`replay-ext: the Journal has no Call ${index}`);
		const tools = (body.tools as { name: string }[] | undefined) ?? [];
		const wire = (name: string): string =>
			tools.find((tool) => tool.name === name)?.name ??
			tools.find((tool) => tool.name.toLowerCase() === name.toLowerCase())?.name ??
			tools.find((tool) => tool.name.toLowerCase().endsWith(`_${name.toLowerCase()}`))?.name ??
			name;
		return new Response(sse(reply, wire), {
			status: 200,
			headers: { "content-type": "text/event-stream", "request-id": `req_replay_${index}` },
		});
	};
	globalThis.fetch = Object.assign(wrapped, real) as typeof fetch;

	if (MODE === "stub") {
		let settled = 0;
		pi.on("message_end", (event) => {
			const message = event.message as Record<string, unknown> | undefined;
			if (message?.role !== "assistant") return undefined;
			const recorded = replies[settled++];
			if (!recorded) return undefined;
			for (const field of OBSERVED) {
				if (recorded[field] === undefined) delete message[field];
				else message[field] = recorded[field];
			}
			return undefined;
		});
		pi.on("tool_result", (event) => {
			const recorded = results.get(event.toolCallId as string);
			if (!recorded) throw new Error(`replay-ext: no recorded result for ${String(event.toolCallId)}`);
			return { content: recorded.content, details: recorded.details, isError: recorded.isError === true };
		});
		const original = process.env.REPLAY_SESSION_ID;
		const today = process.env.REPLAY_TODAY;
		pi.on("before_provider_request", (event) => {
			let payload = event.payload as { metadata?: { user_id?: string } };
			if (today) {
				const text = JSON.stringify(payload).replace(/Today: \d{4}-\d{2}-\d{2};/g, `Today: ${today};`);
				payload = JSON.parse(text);
			}
			const raw = payload.metadata?.user_id;
			if (original && raw) {
				const user = JSON.parse(raw) as Record<string, unknown>;
				user.session_id = original;
				payload.metadata = { ...payload.metadata, user_id: JSON.stringify(user) };
			}
			return payload;
		});
	}
}
