/**
 * Measures what a Context Pack costs at the prompt cache, so the audit's
 * inference about the order of its parts can be settled with figures.
 *
 * Two modes, because the question has two halves.
 *
 * **The baseline** (default) pairs consecutive Calls within one Turn over
 * governed Conversations — those whose Accounting records what each Pack
 * carried — and reports the cached share of the Pack against Call position,
 * against whether the leading parts changed between the two Calls, and
 * against whether the verbatim tail slid. It then applies the rule
 * `pack-order-cache/design.md` fixed before any figure was seen. Pairs
 * spaced wider than the cache lifetime are dropped: a cold cache says
 * nothing about the order that filled it.
 *
 *     CM_DATABASE_URL=… bun scripts/measure-pack-cache.ts
 *     CM_DATABASE_URL=… bun scripts/measure-pack-cache.ts --export window.json
 *     bun scripts/measure-pack-cache.ts window.json
 *
 * A scratch database is one `truncate` away from being the only copy of a
 * decision's evidence, so `--export` writes the window out and a window file
 * is read back in its place.
 *
 * **The corpus** (`--journals`) needs no store: every figure it reports comes
 * from `usage` and `contextSnapshot` on the Journal's own messages, which is
 * where both arms of a governed-versus-ungoverned comparison live — an
 * ungoverned Conversation has no Accounting by definition.
 *
 *     bun scripts/measure-pack-cache.ts --journals
 *     bun scripts/measure-pack-cache.ts --journals --group governed=cm-cache-run
 *
 * The share is derived against the Floor throughout, because the Floor is
 * most of a window and caches whatever the Pack does:
 * `max(0, cacheRead − floorTokens) / packTokens`.
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { SQL } from "bun";

import type { TurnAccounting } from "../src/accounting.ts";
import { inspectConversation, type CallView } from "../src/inspection.ts";
import { SESSION_ROOT } from "../src/journal.ts";
import type { CallUsage, ContextSnapshot } from "../src/messages.ts";
import { PostgresStore } from "../src/postgres-store.ts";

/** A collected window: every governed Conversation, as Accounting recorded it. */
interface Window {
	collected: string;
	conversations: {
		conversationId: string;
		turns: TurnAccounting[];
		/** When each Call was recorded, so the cache lifetime can be applied. */
		recordedAt: Record<string, number | undefined>;
	}[];
}

/** The cache lifetime the harness's own usage names, in milliseconds. */
const LIFETIME_MS = 60 * 60 * 1000;

/**
 * What the provider charges for a cached read and a cache write, against the
 * input rate. Stated rather than folded in, because prices drift and a
 * figure derived from them has to say what it assumed.
 */
const READ_RATE = 0.1;
const WRITE_RATE = 1.25;

const argv = process.argv.slice(2);
const exportTo = argv.includes("--export")
	? argv[argv.indexOf("--export") + 1]
	: undefined;
const from = argv.find(
	(argument) => argument.endsWith(".json") && argument !== exportTo,
);

function quantile(values: number[], q: number): number {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const at = (sorted.length - 1) * q;
	const low = Math.floor(at);
	const high = Math.ceil(at);
	return (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (at - low);
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

// ---------------------------------------------------------------- corpus --

interface JournalCall {
	journal: string;
	usage: CallUsage;
	snapshot: ContextSnapshot;
}

async function journalPaths(dir: string): Promise<string[]> {
	const paths: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) paths.push(...(await journalPaths(path)));
		else if (entry.name.endsWith(".jsonl")) paths.push(path);
	}
	return paths;
}

async function journalCalls(root: string): Promise<JournalCall[]> {
	const calls: JournalCall[] = [];
	for (const path of await journalPaths(root)) {
		let text: string;
		try {
			text = await readFile(path, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			let entry: { type?: string; message?: Record<string, unknown> };
			try {
				entry = JSON.parse(line) as typeof entry;
			} catch {
				continue;
			}
			if (entry.type !== "message") continue;
			const message = entry.message as
				| { usage?: CallUsage; contextSnapshot?: ContextSnapshot }
				| undefined;
			if (!message?.usage || !message.contextSnapshot) continue;
			calls.push({
				journal: path,
				usage: message.usage,
				snapshot: message.contextSnapshot,
			});
		}
	}
	return calls;
}

/** The cached share of one Call's Pack, or nothing where it has no Pack. */
function cachedShare(call: JournalCall): number | undefined {
	const pack = call.snapshot.promptTokens - call.snapshot.nonMessageTokens;
	if (pack <= 0) return undefined;
	const read = call.usage.cacheRead ?? 0;
	return Math.max(0, read - call.snapshot.nonMessageTokens) / pack;
}

function reportGroup(label: string, calls: JournalCall[]): void {
	if (calls.length === 0) {
		console.log(`${label.padEnd(12)} no calls`);
		return;
	}
	const shares = calls
		.map(cachedShare)
		.filter((share): share is number => share !== undefined);
	const input = calls.reduce((sum, call) => sum + (call.usage.input ?? 0), 0);
	const read = calls.reduce((sum, call) => sum + (call.usage.cacheRead ?? 0), 0);
	const write = calls.reduce((sum, call) => sum + (call.usage.cacheWrite ?? 0), 0);
	const charged = input + read + write;
	const effective = input + read * READ_RATE + write * WRITE_RATE;
	const pack = calls.reduce(
		(sum, call) =>
			sum + (call.snapshot.promptTokens - call.snapshot.nonMessageTokens),
		0,
	);
	const reads = new Set(calls.map((call) => call.usage.cacheRead ?? 0));
	console.log(
		`${label.padEnd(12)} calls=${calls.length} journals=${new Set(calls.map((c) => c.journal)).size} ` +
			`median cached pack ${pct(quantile(shares, 0.5))} ` +
			`p25 ${pct(quantile(shares, 0.25))} p75 ${pct(quantile(shares, 0.75))}`,
	);
	console.log(
		`${" ".repeat(12)} input=${input} read=${read} write=${write} ` +
			`(input is ${pct(input / Math.max(charged, 1))} of everything charged)`,
	);
	console.log(
		`${" ".repeat(12)} per call: ${Math.round(charged / calls.length)} charged, ` +
			`${Math.round(effective / calls.length)} at ${READ_RATE}/${WRITE_RATE} ` +
			`multipliers, pack ${Math.round(pack / calls.length)} tokens`,
	);
	console.log(
		`${" ".repeat(12)} calls with a cache write: ` +
			`${calls.filter((call) => (call.usage.cacheWrite ?? 0) > 0).length}; ` +
			`distinct cacheRead values: ${reads.size}` +
			(reads.size === 1 ? ` (${[...reads][0]})` : ""),
	);
}

async function reportCorpus(): Promise<void> {
	const root = argv.includes("--sessions")
		? (argv[argv.indexOf("--sessions") + 1] ?? SESSION_ROOT)
		: SESSION_ROOT;
	const calls = await journalCalls(root);
	const journals = new Set(calls.map((call) => call.journal)).size;

	// The identity the derived share rests on: everything charged for a
	// window is one of the three, so what `cacheRead` has above the Floor is
	// what the Pack was spared.
	let reconciles = 0;
	const offenders = new Set<string>();
	for (const call of calls) {
		const { input = 0, cacheRead = 0, cacheWrite = 0 } = call.usage;
		if (input + cacheRead + cacheWrite === call.snapshot.promptTokens) reconciles++;
		else offenders.add(call.journal);
	}
	console.log(`journals under ${root}: ${journals}; priced calls: ${calls.length}`);
	console.log(
		`input + cacheRead + cacheWrite = promptTokens on ${reconciles} of ${calls.length}` +
			(offenders.size === 0 ? "" : `; off in ${offenders.size} journals`),
	);

	const naive = calls
		.map((call) => {
			const { input = 0, cacheRead = 0, cacheWrite = 0 } = call.usage;
			const charged = input + cacheRead + cacheWrite;
			return charged > 0 ? cacheRead / charged : undefined;
		})
		.filter((rate): rate is number => rate !== undefined);
	const derived = calls
		.map(cachedShare)
		.filter((share): share is number => share !== undefined);
	const belowFloor = calls.filter(
		(call) => (call.usage.cacheRead ?? 0) < call.snapshot.nonMessageTokens,
	).length;
	console.log(
		`\ncacheRead / everything charged: median ${pct(quantile(naive, 0.5))} ` +
			`p25 ${pct(quantile(naive, 0.25))} p75 ${pct(quantile(naive, 0.75))}`,
	);
	console.log(
		`cached pack / pack size:       median ${pct(quantile(derived, 0.5))} ` +
			`p25 ${pct(quantile(derived, 0.25))} p75 ${pct(quantile(derived, 0.75))}`,
	);
	console.log(`calls whose cacheRead is below their own floor: ${belowFloor}`);

	const groups: string[] = [];
	for (const [index, argument] of argv.entries()) {
		if (argument !== "--group") continue;
		const value = argv[index + 1];
		if (value) groups.push(value);
	}
	if (groups.length === 0) return;
	console.log("");
	for (const group of groups) {
		const [label, match] = group.split("=");
		if (!label || !match) continue;
		reportGroup(
			label,
			calls.filter((call) => call.journal.includes(match)),
		);
	}
}

// -------------------------------------------------------------- baseline --

/** What a Call's leading parts carried, as one comparable string. */
function head(call: CallView): string {
	return call.parts
		.filter(
			(part) =>
				part.source === "recalled" ||
				part.source === "curated" ||
				part.source === "structure",
		)
		.map(
			(part) =>
				`${part.source}:${part.turnIndices.join(",")}|${part.conceptIds.join(",")}` +
				`|${part.symbols.join(",")}`,
		)
		.join(";");
}

/** Which Turns the verbatim tail carried. */
function tail(call: CallView): number[] {
	return call.parts.find((each) => each.source === "verbatim-tail")?.turnIndices ?? [];
}

/**
 * A slide is a Turn *leaving* the tail, not the tail growing: a tail that
 * gained a Turn keeps its prefix, and it is the prefix a cache reads.
 */
function slid(before: CallView, after: CallView): boolean {
	const kept = new Set(tail(after));
	return tail(before).some((turnIndex) => !kept.has(turnIndex));
}

async function collect(): Promise<Window> {
	if (from) return (await Bun.file(from).json()) as Window;

	const url = process.env.CM_DATABASE_URL;
	if (!url) throw new Error("CM_DATABASE_URL, or a window file to read, is required");
	const sql = new SQL(url);
	const store = PostgresStore.connect(url);
	try {
		const ids = (await sql`
			SELECT DISTINCT conversation_id FROM call_accounting
			ORDER BY conversation_id`) as { conversation_id: string }[];
		const conversations: Window["conversations"] = [];
		for (const { conversation_id: conversationId } of ids) {
			const recorded = (await sql`
				SELECT turn_index, call_index, recorded_at FROM call_accounting
				WHERE conversation_id = ${conversationId}`) as {
				turn_index: number;
				call_index: number;
				recorded_at: Date | null;
			}[];
			conversations.push({
				conversationId,
				turns: await store.readAccounting(conversationId),
				recordedAt: Object.fromEntries(
					recorded.map((row) => [
						`${row.turn_index}:${row.call_index}`,
						row.recorded_at?.getTime(),
					]),
				),
			});
		}
		return { collected: new Date().toISOString(), conversations };
	} finally {
		await store.close();
		await sql.close();
	}
}

interface Pair {
	conversationId: string;
	callIndex: number;
	headChanged: boolean;
	tailSlid: boolean;
	cachedPackShare: number;
	cacheWrite: number;
}

async function reportBaseline(): Promise<void> {
	const window = await collect();
	if (exportTo) {
		// Only what this script reads: the identities the head and the tail
		// are compared by, and the figures. A Pack's rejected candidates and
		// per-part reasons are the inspector's business, and carrying them
		// would make the evidence ten times the size of the finding.
		const slim: Window = {
			collected: window.collected,
			conversations: window.conversations.map((conversation) => ({
				...conversation,
				turns: conversation.turns.map((turn) => ({
					...turn,
					calls: turn.calls.map((call) => ({
						turnIndex: call.turnIndex,
						callIndex: call.callIndex,
						// Where the tail came from: a tail read back from the
						// Thread Store is the case where a cacheable prefix has
						// to survive a round trip through the database, and a
						// window that cannot tell it apart cannot say so.
						tailSource: call.tailSource,
						// How much of the Pack the harness supplied itself: the
						// prefix it can mark, and so the ceiling on what any
						// provider was ever offered to cache.
						leadingTokens: call.leadingTokens,
						packTokens: call.packTokens,
						floorTokens: call.floorTokens,
						cacheRead: call.cacheRead,
						cacheWrite: call.cacheWrite,
						inputTokens: call.inputTokens,
						parts: call.parts.map((part) => ({
							source: part.source,
							approximate: part.approximate,
							approximateTokens: part.approximateTokens,
							turnIndices: part.turnIndices,
							conceptIds: part.conceptIds,
							symbols: part.symbols,
						})),
					})),
				})),
			})),
		};
		await Bun.write(exportTo, `${JSON.stringify(slim, null, "\t")}\n`);
		console.log(`window written to ${exportTo}`);
	}

	const pairs: Pair[] = [];
	const positions = new Map<number, number[]>();
	let governedCalls = 0;
	let pricedCalls = 0;
	let tailSlidAcrossTurns = 0;
	let turnBoundaries = 0;
	let input = 0;
	let read = 0;
	let write = 0;
	let writingCalls = 0;
	const reads = new Set<number>();
	const byTailSource = new Map<string, number[]>();
	const byPrefix = new Map<string, number[]>();

	for (const conversation of window.conversations) {
		const calls = inspectConversation(conversation.turns);
		// Governed: the Pack was assembled by this system, which is what
		// having recorded parts means. An ungoverned Call was sent the
		// harness's own accumulating array, which caches by construction.
		const governed = calls.filter((call) => call.parts.length > 0);
		governedCalls += governed.length;
		pricedCalls += governed.filter(
			(call) => call.cachedPackShare !== undefined,
		).length;
		for (const call of governed) {
			input += call.inputTokens ?? 0;
			read += call.cacheRead ?? 0;
			write += call.cacheWrite ?? 0;
			if ((call.cacheWrite ?? 0) > 0) writingCalls++;
			if (call.cacheRead !== undefined) reads.add(call.cacheRead);
			if (call.cachedPackShare !== undefined) {
				// Bucketed by size as well as presence, so a prefix too small
				// to be worth a cache block would show as one: measured, it
				// does not — what separates a cached Call from an uncached
				// one is whether there was a prefix at all.
				const prefix =
					call.leadingTokens === undefined
						? "unrecorded"
						: call.leadingTokens === 0
							? "none"
							: call.leadingTokens < 1024
								? "under 1024 tokens"
								: "1024 tokens or more";
				byPrefix.set(prefix, [
					...(byPrefix.get(prefix) ?? []),
					call.cachedPackShare,
				]);
				const source = call.tailSource ?? "unrecorded";
				byTailSource.set(source, [
					...(byTailSource.get(source) ?? []),
					call.cachedPackShare,
				]);
			}
		}

		for (const [index, call] of governed.entries()) {
			const previous = governed[index - 1];
			if (!previous) continue;
			if (previous.turnIndex !== call.turnIndex) {
				// A Turn boundary: the only place a Turn can leave the tail.
				turnBoundaries++;
				if (slid(previous, call)) tailSlidAcrossTurns++;
				continue;
			}
			if (call.cachedPackShare === undefined) continue;
			const before = conversation.recordedAt[`${previous.turnIndex}:${previous.callIndex}`];
			const after = conversation.recordedAt[`${call.turnIndex}:${call.callIndex}`];
			if (before && after && after - before > LIFETIME_MS) continue;

			pairs.push({
				conversationId: conversation.conversationId,
				callIndex: call.callIndex,
				headChanged: head(previous) !== head(call),
				tailSlid: slid(previous, call),
				cachedPackShare: call.cachedPackShare,
				cacheWrite: call.cacheWrite ?? 0,
			});
			positions.set(call.callIndex, [
				...(positions.get(call.callIndex) ?? []),
				call.cachedPackShare,
			]);
		}
	}

	const withPairs = new Set(pairs.map((pair) => pair.conversationId));
	console.log(
		`conversations: ${window.conversations.length}; governed calls: ${governedCalls}; ` +
			`priced: ${pricedCalls}`,
	);
	console.log(
		`governed totals: input=${input} read=${read} write=${write}; ` +
			`calls with a cache write: ${writingCalls}; distinct cacheRead values: ${reads.size}` +
			(reads.size === 1 ? ` (${[...reads][0]})` : ""),
	);
	console.log(
		`qualifying pairs: ${pairs.length} across ${withPairs.size} conversations`,
	);

	const shares = pairs.map((pair) => pair.cachedPackShare);
	console.log(
		`\ncached pack share, all pairs: median ${pct(quantile(shares, 0.5))} ` +
			`p25 ${pct(quantile(shares, 0.25))} p75 ${pct(quantile(shares, 0.75))}`,
	);

	// The tail is the only part that can lead a Pack, so where it came from
	// is the one thing that can decide whether there was a prefix at all.
	console.log("\ncached pack share by where the tail came from:");
	for (const [source, bucket] of [...byTailSource].sort()) {
		console.log(
			`  ${source.padEnd(17)} n=${bucket.length} median ${pct(quantile(bucket, 0.5))}`,
		);
	}

	console.log("\ncached pack share by the prefix the harness could mark:");
	for (const [prefix, bucket] of [...byPrefix].sort()) {
		console.log(
			`  ${prefix.padEnd(19)} n=${bucket.length} median ${pct(quantile(bucket, 0.5))}`,
		);
	}

	console.log("\nby call position within a turn:");
	for (const [position, bucket] of [...positions].sort((a, b) => a[0] - b[0])) {
		console.log(
			`  call ${position}: n=${bucket.length} median ${pct(quantile(bucket, 0.5))}`,
		);
	}

	const changed = pairs.filter((pair) => pair.headChanged);
	const unchanged = pairs.filter((pair) => !pair.headChanged);
	console.log(
		`\nhead changed: n=${changed.length} ` +
			`median ${pct(quantile(changed.map((pair) => pair.cachedPackShare), 0.5))}`,
	);
	console.log(
		`head unchanged: n=${unchanged.length} ` +
			`median ${pct(quantile(unchanged.map((pair) => pair.cachedPackShare), 0.5))}`,
	);

	// The population the rule reads: the head changed and the tail did not.
	const deciding = pairs.filter((pair) => pair.headChanged && !pair.tailSlid);
	const decidingShares = deciding.map((pair) => pair.cachedPackShare);
	const writeShare =
		deciding.reduce((sum, pair) => sum + pair.cacheWrite, 0) / Math.max(input, 1);
	console.log(
		`\nhead changed, tail unchanged: n=${deciding.length} ` +
			`median ${pct(quantile(decidingShares, 0.5))}`,
	);
	console.log(
		`cacheWrite on those pairs as a share of governed input: ${pct(writeShare)}`,
	);
	console.log(
		`tail slid at ${tailSlidAcrossTurns} of ${turnBoundaries} turn boundaries; ` +
			`head changed on ${changed.length} of ${pairs.length} within-turn pairs`,
	);

	const median = quantile(decidingShares, 0.5);
	const enough = pairs.length >= 200 && withPairs.size >= 10;
	const verdict = !enough
		? "inconclusive (too few qualifying pairs)"
		: median < 0.25 && writeShare >= 0.1 && tailSlidAcrossTurns < changed.length
			? "reorder justified"
			: median > 0.75
				? "inference refused"
				: "inconclusive";
	console.log(`\nverdict: ${verdict}`);
}

if (argv.includes("--journals")) await reportCorpus();
else await reportBaseline();
