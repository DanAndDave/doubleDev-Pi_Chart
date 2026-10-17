/**
 * The replay's half inside omp, loaded with `-e` beside pi-chart or alone by
 * `scripts/replay.ts`. It wraps `globalThis.fetch`, below omp's own OAuth body
 * patch, so what it sees is the exact body that leaves the process, and
 * answers every Call from the recorded Journal instead of the model.
 *
 * omp sends Anthropic Calls through its own transport and reaches
 * `globalThis.fetch` only when a proxy is configured, so this needs
 * `PI_PROXY_ANTHROPIC` set (to anything: the proxy is stripped before a
 * request goes out). Without it a replay would talk to the model, so the
 * extension refuses to load.
 *
 * Call k is answered with the Journal's k-th assistant message, and every
 * tool call is given the result the Journal recorded. Each Call's request is
 * counted by the token-counting endpoint, with the request's own headers, and
 * `REPLAY_DIR/call-NNN.json` gets the count and the Call's `usage` input
 * total. Credentials are never written.
 *
 * A Call the plan names is ablated before it is answered (design §2): the
 * faithful gate, locating the unit, the sham, cut and unit-alone counts and
 * the count check, then 4 shams (one, then three at once), the stability
 * gate, and 4 cut resends, or 4 second shams for a null unit. Every send
 * goes to the model with omp's own headers, the cap checked before it, and
 * is priced at the plan's rates; the draw's result joins the Call's file.
 * Only the token-counting endpoint is reached for an unplanned Call, or in a
 * dry run, which stops each draw after the count check.
 *
 *   REPLAY_MODE=stub      required; anything else leaves omp untouched
 *   REPLAY_DIR            where call-NNN.json go
 *   REPLAY_JOURNAL        the recorded main Journal
 *   REPLAY_SESSION_ID     the original Conversation's id, put back into
 *                         `metadata.user_id` before omp hashes the body (`cch`)
 *   REPLAY_TODAY          the original Run's local date, YYYY-MM-DD, for omp's
 *                         "Today:" line; another date changes the prefix, and
 *                         the server then drops every thinking block signed
 *                         against the old one
 *   REPLAY_BODIES=1       also keep each rebuilt request body
 *   REPLAY_PLAN           an Ablation plan (`Plan`), from `scripts/ablate.ts`
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	actionOf,
	alone,
	countCheck,
	cut,
	duplicated,
	locate,
	locationLabel,
	matches,
	priceOf,
	probeMatches,
	sham,
	stability,
	type Action,
	type Condition,
	type Counts,
	type Fate,
	type Rates,
	type RequestBody,
	type Resend,
	type Unit,
	type Usage,
} from "./ablation.ts";
import type { RunRecord } from "./measures.ts";
import { isToolCall, type ContentBlock } from "../src/messages.ts";

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
	usage?: Usage;
	stopReason?: string;
	toolCallId?: string;
	details?: unknown;
	isError?: boolean;
	model?: string;
	inputTransformations?: unknown[];
	[field: string]: unknown;
}

/** One draw the plan makes at Call `call`: the unit to cut, and what the resends are compared with. */
export interface PlannedDraw {
	/** The global main-Call ordinal: the stub's k. */
	call: number;
	turn: number;
	condition: Condition;
	unit: Unit;
	/** The recorded reply's next action. */
	original: Action;
	/** On a Probe Call: the probed Plants, and whether the recorded reply scored each right, in the same order. */
	probe?: { plants: RunRecord["plants"]; verdicts: boolean[] };
}

/** `REPLAY_PLAN`: what `scripts/ablate.ts` asks of one replay pass. */
export interface Plan {
	draws: PlannedDraw[];
	/** The faithful band: count − `usage` input total on byte-identical requests. */
	band: [number, number];
	/** USD per token by kind, from the Run's own Journal. */
	rates: Rates;
	/** USD this pass may spend: the Run's cap less what its earlier passes spent. */
	cap: number;
	/** Stop every draw after the count check: no send. */
	dryRun: boolean;
}

/** One resend as it came back: its reply's text and tool calls, under the harness's tool names. */
export interface Sent {
	condition: Resend["condition"];
	content: ContentBlock[];
	usage: Usage;
	match: boolean;
	spend: number;
}

/** What became of one planned draw at its Call. */
export interface DrawResult {
	/** Its index in the plan's `draws`. */
	draw: number;
	/** Absent when a dry run passed the count check, or when `error` stopped the draw. */
	fate?: Fate;
	counts?: Counts;
	duplicated?: boolean;
	location?: string;
	resends: Sent[];
	spend: number;
	/** A count or send that kept failing; the draw stopped there. */
	error?: string;
}

/** One rebuilt Call, as `scripts/replay.ts` reads it back. */
export interface CallFile {
	index: number;
	/** The endpoint's count of the rebuilt, unchanged request. */
	count?: number;
	error?: string;
	/** The recorded Call's `usage` input total: input + cache read + cache write. */
	usage: number;
	body?: string;
	/** The plan's draws at this Call, in plan order. */
	draws?: DrawResult[];
}

/**
 * What omp writes on an assistant message from the response and the clock,
 * not from the request. pi-chart sizes a Turn over every field the Journal
 * keeps, so a replay that left its own values here would size Turns
 * differently and shorten or evict the tail elsewhere. `usage` is among
 * them: the provider's cache-lifetime breakdown (`cttl`) and the cost it
 * implies are not in the stream a stub can send.
 */
const OBSERVED = ["timestamp", "responseId", "duration", "ttft", "completedAt", "inputTransformations", "usage"];

interface Api {
	on(event: string, handler: (event: Record<string, unknown>) => unknown): void;
}

const DIR = process.env.REPLAY_DIR ?? "";
/** Fields the token-counting endpoint takes; the rest of a Call's body it rejects. */
const COUNTED = ["model", "messages", "system", "tools", "tool_choice", "thinking", "context_management"];
/** Sends per batch: the first writes the cache the rest read. */
const BATCHES = [1, 3];
const ATTEMPTS = 5;

/**
 * omp 18.11.0's request attestation, from its binary: `cch=` in the billing
 * header of system block 0 holds the low 20 bits, in hex, of the xxHash64 of
 * the body sent with `cch=00000` there. A sham or cut is a body omp did not
 * build, so it is attested here the same way.
 */
const ATTEST_SEED = 0x4d659218e32a3268n;
const ATTEST_ANCHOR = Buffer.from('"system":[{"type":"text","text":"x-anthropic-billing-header:');
/** How far past the anchor omp looks for `cch=`. */
const ATTEST_REACH = 150;

/** The Journal's messages in file order: the stub's numbering of Calls. */
export function journalMessages(path: string): JournalMessage[] {
	const out: JournalMessage[] = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line.trim()) continue;
		const entry = JSON.parse(line) as { type?: string; message?: JournalMessage };
		if (entry.type === "message" && entry.message) out.push(entry.message);
	}
	return out;
}

/**
 * The replay's Journal text with each message entry set as the original's
 * k-th message entry has it in the observed fields (an assistant message),
 * `useless` (a tool result) and `timestamp`. omp 18.11 persists a message
 * before the `message_end` and `tool_result` handlers change it, and each
 * Turn resumes from this file, so without this pi-chart would size the
 * replay's earlier Turns by the replay's own values.
 */
export function restoredJournal(text: string, original: JournalMessage[]): string {
	let k = 0;
	return text
		.split("\n")
		.map((line) => {
			if (!line.trim()) return line;
			const entry = JSON.parse(line) as { type?: string; message?: Record<string, unknown> };
			const message = entry.message;
			if (entry.type !== "message" || !message) return line;
			const recorded = original[k] as Record<string, unknown> | undefined;
			if (!recorded || recorded.role !== message.role) {
				throw new Error(`replay-ext: the replay's message ${k} is ${String(message.role)}, the original's ${String(recorded?.role ?? "absent")}`);
			}
			k++;
			const fields = message.role === "assistant" ? OBSERVED : message.role === "toolResult" ? ["timestamp", "useless"] : ["timestamp"];
			for (const field of fields) {
				if (recorded[field] === undefined) delete message[field];
				else message[field] = recorded[field];
			}
			return JSON.stringify(entry);
		})
		.join("\n");
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	new Headers(init?.headers).forEach((value, key) => {
		out[key] = value;
	});
	return out;
}

function bodyText(body: RequestInit["body"]): string {
	if (typeof body === "string") return body;
	if (body instanceof Uint8Array) return new TextDecoder().decode(body);
	if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
	throw new Error(`replay-ext: unexpected request body ${Object.prototype.toString.call(body)}`);
}

/** The endpoint's count of `body`, sent with the Call's own headers; retried on 429 and 5xx. */
export async function countTokens(
	real: typeof fetch,
	url: URL,
	headers: Record<string, string>,
	body: Record<string, unknown>,
): Promise<{ count?: number; error?: string }> {
	const counted: Record<string, unknown> = {};
	for (const key of COUNTED) if (key in body) counted[key] = body[key];
	const target = new URL(url);
	target.pathname = "/v1/messages/count_tokens";
	const sent = { ...headers };
	delete sent["content-length"];
	sent.accept = "application/json";
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const res = await real(target, { method: "POST", headers: sent, body: JSON.stringify(counted) });
		const text = await res.text();
		if (res.ok) return { count: (JSON.parse(text) as { input_tokens: number }).input_tokens };
		if (res.status !== 429 && res.status < 500) return { error: `${res.status} ${text.slice(0, 400)}` };
		await Bun.sleep(2000 * (attempt + 1));
	}
	return { error: "count_tokens kept failing" };
}

/** `body` serialised and attested as omp attests the bodies it builds. */
function attested(body: RequestBody): Uint8Array {
	const bytes = new TextEncoder().encode(JSON.stringify(body));
	const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const anchor = buffer.indexOf(ATTEST_ANCHOR);
	if (anchor === -1) return bytes;
	const start = anchor + ATTEST_ANCHOR.length;
	const at = buffer.indexOf("cch=", start);
	if (at === -1 || at - start > ATTEST_REACH) return bytes;
	buffer.write("00000", at + 4, "latin1");
	const hash = (Bun.hash.xxHash64(bytes, ATTEST_SEED) & 0xfffffn).toString(16).padStart(5, "0");
	buffer.write(hash, at + 4, "latin1");
	return bytes;
}

/** A content block of the provider's reply, as the stream builds it. */
interface WireBlock {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: unknown;
	json?: string;
}

/** A send that failed; `retry` when the provider said to try again. */
class Retryable extends Error {
	constructor(
		message: string,
		readonly retry: boolean,
	) {
		super(message);
	}
}

/** A model reply read off its event stream: its content blocks and what it was billed. */
function readStream(text: string): { blocks: WireBlock[]; usage: Usage } {
	const blocks: WireBlock[] = [];
	const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const bill = (given: Record<string, number | undefined> | undefined) => {
		if (!given) return;
		if (given.input_tokens !== undefined) usage.input = given.input_tokens;
		if (given.output_tokens !== undefined) usage.output = given.output_tokens;
		if (given.cache_read_input_tokens !== undefined) usage.cacheRead = given.cache_read_input_tokens;
		if (given.cache_creation_input_tokens !== undefined) usage.cacheWrite = given.cache_creation_input_tokens;
	};
	for (const chunk of text.split("\n\n")) {
		const data = chunk
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice("data:".length).trim())
			.join("");
		if (!data) continue;
		const event = JSON.parse(data) as {
			type: string;
			index?: number;
			message?: { usage?: Record<string, number> };
			content_block?: WireBlock;
			delta?: { type?: string; text?: string; partial_json?: string };
			usage?: Record<string, number>;
			error?: { type?: string; message?: string };
		};
		if (event.type === "error") throw new Retryable(`${event.error?.type}: ${event.error?.message}`, event.error?.type !== "invalid_request_error");
		if (event.type === "message_start") bill(event.message?.usage);
		if (event.type === "message_delta") bill(event.usage);
		if (event.type === "content_block_start" && event.content_block && event.index !== undefined) {
			blocks[event.index] = { ...event.content_block, json: "" };
		}
		const block = event.index === undefined ? undefined : blocks[event.index];
		if (event.type === "content_block_delta" && block) {
			if (event.delta?.type === "text_delta") block.text = (block.text ?? "") + (event.delta.text ?? "");
			if (event.delta?.type === "input_json_delta") block.json += event.delta.partial_json ?? "";
		}
	}
	return { blocks: blocks.filter(Boolean), usage };
}

/** The roster's spelling of a harness tool name: exact, then case-folded, then as a prefixed wire name. */
function wireName(tools: { name: string }[], name: string): string {
	const lower = name.toLowerCase();
	return (
		tools.find((tool) => tool.name === name)?.name ??
		tools.find((tool) => tool.name.toLowerCase() === lower)?.name ??
		tools.find((tool) => tool.name.toLowerCase().endsWith(`_${lower}`))?.name ??
		name
	);
}

/** Everything a planned Call's draws share. */
interface Ablating {
	real: typeof fetch;
	url: URL;
	headers: Record<string, string>;
	body: RequestBody;
	plan: Plan;
	/** The unchanged request's count, or why it has none. */
	counted: { count?: number; error?: string };
	/** The recorded Call's `usage` input total. */
	usage: number;
	/** The harness's tool names the Journal used, to read a reply's wire names back. */
	known: string[];
	/** USD spent this pass, across Calls; checked against `plan.cap` before every send. */
	budget: { spent: number };
}

/** The endpoint's count of `body`; throws when it keeps failing. */
async function count(at: Ablating, body: Record<string, unknown>): Promise<number> {
	const { count: tokens, error } = await countTokens(at.real, at.url, at.headers, body);
	if (tokens === undefined) throw new Error(`count_tokens: ${error}`);
	return tokens;
}

/** Sends `body` to the model with omp's headers; the reply's content under harness tool names, and its usage. */
async function send(at: Ablating, body: RequestBody): Promise<{ content: ContentBlock[]; usage: Usage }> {
	const headers = { ...at.headers };
	delete headers["content-length"];
	if ("x-client-request-id" in headers) headers["x-client-request-id"] = crypto.randomUUID();
	const tools = (body.tools ?? []) as { name: string }[];
	let failure = "";
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		if (attempt > 0) await Bun.sleep(5000 * attempt);
		const res = await at.real(at.url, { method: "POST", headers, body: attested(body) });
		const text = await res.text();
		if (!res.ok) {
			failure = `${res.status} ${text.slice(0, 400)}`;
			if (res.status === 429 || res.status >= 500) continue;
			throw new Error(`send: ${failure}`);
		}
		try {
			const { blocks, usage } = readStream(text);
			const content = blocks.flatMap((block): ContentBlock[] => {
				if (block.type === "text") return [{ type: "text", text: block.text ?? "" }];
				if (block.type !== "tool_use" && block.type !== "server_tool_use") return [];
				const name = at.known.find((each) => wireName(tools, each) === block.name) ?? block.name ?? "";
				const input = block.json ? JSON.parse(block.json) : (block.input ?? {});
				return [{ type: "toolCall", id: block.id ?? "", name, arguments: input }];
			});
			return { content, usage };
		} catch (error) {
			if (!(error instanceof Retryable) || !error.retry) throw error;
			failure = error.message;
		}
	}
	throw new Error(`send kept failing: ${failure}`);
}

/**
 * One planned draw at its Call (design §2, steps 2–7); its result, with the
 * fate it reached. A failing count or send stops the draw with `error`.
 */
async function ablate(at: Ablating, draw: number, planned: PlannedDraw): Promise<DrawResult> {
	const result: DrawResult = { draw, resends: [], spend: 0 };
	try {
		if (at.counted.count === undefined) throw new Error(`count_tokens: ${at.counted.error}`);
		const offset = at.counted.count - at.usage;
		result.counts = { offset };
		const [low, high] = at.plan.band;
		if (offset < low || offset > high) return { ...result, fate: "unfaithful" };
		const location = locate(at.body, planned.unit);
		if (!location) return { ...result, fate: "unlocated" };
		result.location = locationLabel(location);
		result.duplicated = duplicated(at.body, location, planned.unit);
		const shamBody = sham(at.body, location);
		const cutBody = cut(at.body, location);
		// The unit alone (design §6): two requests whose counts differ by it.
		const { unit, placeholder } = alone(at.body, location, planned.unit);
		const [shamCount, cutCount, unitCount, emptyCount] = await Promise.all([
			count(at, shamBody),
			count(at, cutBody),
			count(at, unit),
			count(at, placeholder),
		]);
		result.counts = { offset, sham: shamCount, cut: cutCount, alone: unitCount - emptyCount };
		if (!countCheck(shamCount, cutCount, unitCount - emptyCount)) return { ...result, fate: "miscounted" };
		if (at.plan.dryRun) return result;

		/** Four sends of `body`, one then three; false when the cap stopped them. */
		const four = async (condition: Sent["condition"], body: RequestBody): Promise<boolean> => {
			for (const width of BATCHES) {
				if (at.budget.spent >= at.plan.cap) return false;
				const settled = await Promise.allSettled(Array.from({ length: width }, () => send(at, body)));
				for (const each of settled) {
					if (each.status !== "fulfilled") continue;
					const { content, usage } = each.value;
					const action = actionOf(content.filter(isToolCall));
					const match = planned.probe
						? probeMatches(planned.probe.plants, planned.probe.verdicts, { role: "assistant", content })
						: matches(planned.original, action);
					const spend = priceOf(usage, at.plan.rates);
					result.resends.push({ condition, content, usage, match, spend });
					result.spend += spend;
					at.budget.spent += spend;
				}
				const failed = settled.find((each) => each.status === "rejected");
				if (failed) throw failed.reason;
			}
			return true;
		};
		if (!(await four("sham", shamBody))) return { ...result, fate: "capped" };
		if (!stability(result.resends.map((resend) => resend.match))) return { ...result, fate: "unstable" };
		const judged = planned.condition === "null" ? await four("sham2", shamBody) : await four("cut", cutBody);
		return { ...result, fate: judged ? "judged" : "capped" };
	} catch (error) {
		return { ...result, error: error instanceof Error ? error.message : String(error) };
	}
}

/** The recorded reply as the provider's event stream, tool names as the request's roster spells them. */
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
			// where pi-chart's Turn sizes count them.
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
			emit("content_block_delta", { index, delta: { type: "signature_delta", signature: block.thinkingSignature ?? "" } });
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

/** A call file's name: `call-NNN.json`, NNN the Call's index. */
export const CALL_FILE = /^call-\d+\.json$/;

/** The names of the call files written so far this pass, in order. */
function callNames(): string[] {
	return readdirSync(DIR)
		.filter((name) => CALL_FILE.test(name))
		.sort();
}

export default function replay(pi: Api): void {
	if (process.env.REPLAY_MODE !== "stub") return;
	if (!process.env.PI_PROXY_ANTHROPIC) {
		throw new Error("replay-ext: set PI_PROXY_ANTHROPIC, or omp bypasses globalThis.fetch and reaches the model");
	}
	mkdirSync(DIR, { recursive: true });
	const journal = journalMessages(process.env.REPLAY_JOURNAL ?? "");
	const replies = journal.filter((m) => m.role === "assistant");
	const results = new Map(journal.filter((m) => m.role === "toolResult").map((m) => [m.toolCallId, m]));
	const known = [
		...new Set(replies.flatMap((m) => (Array.isArray(m.content) ? m.content : []).flatMap((block) => (block.type === "toolCall" && block.name ? [block.name] : [])))),
	];
	const keepBodies = process.env.REPLAY_BODIES === "1";
	const plan = process.env.REPLAY_PLAN ? (JSON.parse(readFileSync(process.env.REPLAY_PLAN, "utf8")) as Plan) : undefined;
	const real = globalThis.fetch.bind(globalThis);

	const wrapped = async (input: Request | string | URL, given?: RequestInit): Promise<Response> => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		// Bun's fetch honours `proxy`; the one omp adds names nothing real.
		const { proxy: _proxy, ...init } = (given ?? {}) as RequestInit & { proxy?: string };
		const isCall =
			url.hostname === "api.anthropic.com" && url.pathname === "/v1/messages" && (init.method ?? "GET") === "POST";
		if (!isCall) {
			if (url.hostname === "api.anthropic.com") throw new Error(`replay-ext: unexpected request to ${url}`);
			return real(input, init);
		}
		// Calls are sequential across the Run's omp processes, so the files so far number this one.
		const names = callNames();
		const index = names.length;
		const reply = replies[index];
		if (!reply) throw new Error(`replay-ext: the Journal has no Call ${index}`);
		const raw = bodyText(init.body);
		const body = JSON.parse(raw) as RequestBody;
		const usage = reply.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		const headers = headersOf(init);
		const counted = await countTokens(real, url, headers, body);
		const total = usage.input + usage.cacheRead + usage.cacheWrite;
		const planned = (plan?.draws ?? []).flatMap((draw, at) => (draw.call === index ? [{ draw, at }] : []));
		let draws: DrawResult[] | undefined;
		if (plan && planned.length > 0) {
			const ablating: Ablating = {
				real,
				url,
				headers,
				body,
				plan,
				counted,
				usage: total,
				known,
				budget: {
					spent: names
						.flatMap((name) => {
							const file: CallFile = JSON.parse(readFileSync(join(DIR, name), "utf8"));
							return file.draws ?? [];
						})
						.reduce((sum, result) => sum + result.spend, 0),
				},
			};
			draws = [];
			for (const { draw, at } of planned) draws.push(await ablate(ablating, at, draw));
		}
		const file: CallFile = {
			index,
			...counted,
			usage: total,
			...(keepBodies ? { body: raw } : {}),
			...(draws ? { draws } : {}),
		};
		writeFileSync(join(DIR, `call-${String(index).padStart(3, "0")}.json`), JSON.stringify(file));
		const tools = body.tools ?? [];
		return new Response(
			sse(reply, (name) => wireName(tools as { name: string }[], name)),
			{ status: 200, headers: { "content-type": "text/event-stream", "request-id": `req_replay_${index}` } },
		);
	};
	globalThis.fetch = Object.assign(wrapped, real) as typeof fetch;

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
		// `useless` is the tool's own verdict on its result, and omp prunes such results from later requests.
		return {
			content: recorded.content,
			details: recorded.details,
			isError: recorded.isError === true,
			...(recorded.useless === true ? { useless: true } : {}),
		};
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
