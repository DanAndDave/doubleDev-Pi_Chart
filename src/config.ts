import type { AssemblerConfig } from "./assembler.ts";

import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
	/**
	 * What the environment asked for and did not get, in words. Reported
	 * once at session start: a setting silently ignored is a setting
	 * someone believes is in force.
	 */
	problems: string[];
	/** Completed Turns carried verbatim ahead of the current one. */
	tailTurns: number;
	/** How many recalled Turns a pack may carry. Zero disables recall. */
	recallTurns: number;
	/**
	 * How distant a Turn may be and still be worth recalling, as cosine
	 * distance. Measured, not chosen: under the query derivation and the
	 * bounded embed text, a prompt asked in other words reaches its own Turn
	 * within 0.52 on 92% of 99 real Turns here, and nothing off-topic comes
	 * within it at all.
	 */
	recallMaxDistance: number;
	/** How many Concepts a pack may carry. Zero disables curated knowledge. */
	docConcepts: number;
	/** How many symbols' neighbourhoods a pack may carry. Zero disables them. */
	graphSymbols: number;
	/**
	 * Whether to derive a Codebase's graph. Off means read one if it is
	 * already there; extraction writes a directory into the Codebase, which
	 * is graphify's convention but still the user's repository — so it is
	 * asked for rather than assumed.
	 */
	graphExtract: boolean;
	/** Whether to check the Codebase's OpenSpec tree at all. */
	specsVerify: boolean;
	/**
	 * How distant a Concept may be and still be carried. Measured separately
	 * from recall on curated prose: genuine matches land at 0.24-0.42 and
	 * unrelated queries at 0.61 and above.
	 */
	docMaxDistance: number;
	/**
	 * A server-backed Thread Store the operator supplied by pointing
	 * `PICHART_DATABASE_URL` at it. Absent by default: with no setting the
	 * store is embedded (see `storeDir`), and an empty setting declines a
	 * store outright. Present only when `storeOrigin` is `supplied`.
	 */
	databaseUrl?: string;
	/**
	 * Where the Thread Store comes from. `own` is the embedded store this
	 * project runs in-process and persists under `storeDir`, needing no
	 * server; `supplied` is a pgvector Postgres the operator pointed
	 * `PICHART_DATABASE_URL` at — a system package, Postgres.app, or a hosted
	 * one; `declined` is an empty setting, a deliberate refusal. The store is
	 * embedded unless a setting says otherwise.
	 */
	storeOrigin: "own" | "supplied" | "declined";
	/**
	 * Where the embedded store keeps its data, so it outlives the process.
	 * Used only when `storeOrigin` is `own`; overridable with
	 * `PICHART_STORE_DIR`.
	 */
	storeDir: string;
	/** Where the machine-wide Doc Store bundle lives. */
	docBundle: string;
	/**
	 * Size Budgets in estimated tokens, beside the counts above. A part is
	 * trimmed to whichever binds first, and `packTokens` bounds the whole
	 * Context Pack however the parts divide it.
	 *
	 * Derived from measurement, not taste: the estimate runs ~1.15× low
	 * against the harness's reported figures at the median and 1.447× at the
	 * p90, so a ceiling presumes a reported window of `ceiling × 1.5 + 28,000`
	 * measured tokens — the derivation is on `DEFAULT_PACK_TOKENS`.
	 */
	tailTokens: number;
	recallTokens: number;
	docTokens: number;
	graphTokens: number;
	packTokens: number;
	/**
	 * How many excluded candidates each part of a Call records by identity,
	 * so an absence can be explained rather than counted. Measured: over
	 * 403 real Turns the Turn a user would ask about sat as deep as rank 12
	 * among the candidates, and a head of 5 would have named it in fewer
	 * than half the cases where it was reachable at all.
	 */
	explainCandidates: number;
	/**
	 * The share of the ceiling at which a Pack is reported as approaching it.
	 * 0.75 fires on 3.1% of real Turns measured here — a signal rather than
	 * a habit.
	 */
	packWarnShare: number;
	/**
	 * How long a Call may wait on each Store before its part is treated as
	 * absent, in milliseconds. Measured, not chosen: against this machine's
	 * 388-Turn store the tail's worst read was 47.9 ms and recall's 81.4 ms,
	 * of which most is embedding the query. The tail's is lower because it
	 * is one indexed read — anything slower is a Store in trouble rather
	 * than a Store working.
	 */
	tailDeadlineMs: number;
	recallDeadlineMs: number;
	docDeadlineMs: number;
	graphDeadlineMs: number;
	/**
	 * How old a Turn may be before retention retires it, in days. Unset
	 * means retention never runs: how long the Store keeps a Turn is
	 * their policy, not this project's default.
	 */
	retainDays?: number;
}

/**
 * The settings as the Assembler wants them: one Budget per part, rather
 * than the pairs the environment names.
 *
 * The environment keeps the pairs because that is what it is — `PICHART_TAIL_TURNS`
 * and `PICHART_TAIL_TOKENS` are two variables, and `pack budget` names nine of
 * them — so the two shapes meet here, once, instead of at every reader.
 */
export function assemblerConfig(config: Config): AssemblerConfig {
	return {
		tail: { count: config.tailTurns, tokens: config.tailTokens },
		recall: { count: config.recallTurns, tokens: config.recallTokens },
		docs: { count: config.docConcepts, tokens: config.docTokens },
		graph: { count: config.graphSymbols, tokens: config.graphTokens },
		packTokens: config.packTokens,
		recallMaxDistance: config.recallMaxDistance,
		docMaxDistance: config.docMaxDistance,
		explainCandidates: config.explainCandidates,
	};
}

export const DEFAULT_TAIL_TURNS = 8;
export const DEFAULT_RECALL_TURNS = 4;
/**
 * The relevance minimum, re-measured under the query derivation and the
 * bounded embed text (the old 0.50 was measured on a hand-written prompt and
 * paraphrase). Of 99 real Turns, 0.52 keeps 91 asked in other words and
 * admits none of an off-topic control; the bare prompt at the same distance
 * keeps 95 but admits 8, which is what the derivation buys.
 */
export const DEFAULT_RECALL_MAX_DISTANCE = 0.52;
export const DEFAULT_DOC_CONCEPTS = 2;
export const DEFAULT_GRAPH_SYMBOLS = 3;
export const DEFAULT_DOC_MAX_DISTANCE = 0.5;
/**
 * The connection string for the Postgres `compose.yaml` serves, on the port
 * it publishes. The extended default store is embedded and reads no port;
 * this exists so the operator can point `PICHART_DATABASE_URL` at the bundled
 * container when they want a server, and so a test can check the compose file
 * and this string still name the same store.
 */
export const DEFAULT_PG_PORT = 55432;
export function defaultDatabaseUrl(port: number = DEFAULT_PG_PORT): string {
	return `postgres://pi_chart:pi_chart@localhost:${port}/thread_store`;
}
export const DEFAULT_TAIL_TOKENS = 25_000;
export const DEFAULT_RECALL_TOKENS = 8_000;
export const DEFAULT_DOC_TOKENS = 5_000;
export const DEFAULT_GRAPH_TOKENS = 3_000;
/**
 * A ceiling for large-context models: 300,000 estimated tokens. Inverting
 * the estimator's measured 1.5× p90 bias and this project's ~28,000 Floor,
 * it presumes a reported window of `300,000 × 1.5 + 28,000 ≈ 478,000`
 * tokens, so an operator on a 200,000-token window MUST lower it with
 * `PICHART_PACK_TOKENS` or the pack will overrun the window it cannot see.
 * The parts default to 41,000 together, leaving the current Turn 259,000
 * before the ceiling touches it — beyond any real Turn measured here.
 */
export const DEFAULT_PACK_TOKENS = 300_000;
/**
 * The retained head of each part's excluded candidates. Twelve is recall's
 * own over-fetch — `recallTurns + tailTurns` — and so the widest candidate
 * set any part produces under the defaults.
 */
export const DEFAULT_EXPLAIN_CANDIDATES = 12;
export const DEFAULT_PACK_WARN_SHARE = 0.75;
/** Per-Store deadlines on the `context` path, in milliseconds. */
export const DEFAULT_TAIL_DEADLINE_MS = 1_500;
export const DEFAULT_RETRIEVAL_DEADLINE_MS = 5_000;

/**
 * Every setting this reads, by name, so a variable written for the old
 * name can be told whether it still has a home.
 *
 * Listed rather than derived, because a variable is read at the point it
 * is used and there is nowhere else to derive it from; `test/install.test.ts`
 * checks the list against what `src/` actually reads, so it cannot drift.
 */
export const SETTINGS: readonly string[] = [
	"PICHART_BUN",
	"PICHART_CAPTURE_FILE",
	"PICHART_DATABASE_URL",
	"PICHART_DOC_BUNDLE",
	"PICHART_DOC_CONCEPTS",
	"PICHART_DOC_DEADLINE_MS",
	"PICHART_DOC_MAX_DISTANCE",
	"PICHART_DOC_TOKENS",
	"PICHART_EMBED",
	"PICHART_EMBED_MODEL",
	"PICHART_EXPLAIN_CANDIDATES",
	"PICHART_GRAPH",
	"PICHART_GRAPHIFY",
	"PICHART_GRAPH_DEADLINE_MS",
	"PICHART_GRAPH_SYMBOLS",
	"PICHART_GRAPH_TOKENS",
	"PICHART_LIVE",
	"PICHART_OPENSPEC",
	"PICHART_PACK_TOKENS",
	"PICHART_PACK_WARN_SHARE",
	"PICHART_STORE_DIR",
	"PICHART_RECALL_DEADLINE_MS",
	"PICHART_RECALL_MAX_DISTANCE",
	"PICHART_RECALL_TOKENS",
	"PICHART_RECALL_TURNS",
	"PICHART_RETAIN_DAYS",
	"PICHART_SPECS",
	"PICHART_TAIL_DEADLINE_MS",
	"PICHART_TAIL_TOKENS",
	"PICHART_TAIL_TURNS",
];

export function loadConfig(env: Record<string, string | undefined>): Config {
	const problems: string[] = [];
	// Nothing reads a `CM_` variable. A session started with one would run
	// on defaults while looking configured, which is the undiagnosable
	// failure ADR-0003 forbids — so it is named, with what replaces it, and
	// it is said plainly that it does nothing.
	for (const name of Object.keys(env).sort()) {
		if (!name.startsWith("CM_")) continue;
		const replacement = `PICHART_${name.slice("CM_".length)}`;
		// Only where there is one to name: a variable nothing ever read is
		// told the prefix, not a setting that does not exist either.
		problems.push(
			SETTINGS.includes(replacement)
				? `${name} is not read: this is pi-chart now, and the setting is ${replacement}.`
				: `${name} is not read: this is pi-chart now, and its settings are named PICHART_*.`,
		);
	}
	return {
		problems,
		tailTurns: count(env.PICHART_TAIL_TURNS, DEFAULT_TAIL_TURNS),
		recallTurns: count(env.PICHART_RECALL_TURNS, DEFAULT_RECALL_TURNS),
		recallMaxDistance: distance(
			env.PICHART_RECALL_MAX_DISTANCE,
			DEFAULT_RECALL_MAX_DISTANCE,
		),
		docConcepts: count(env.PICHART_DOC_CONCEPTS, DEFAULT_DOC_CONCEPTS),
		graphSymbols: count(env.PICHART_GRAPH_SYMBOLS, DEFAULT_GRAPH_SYMBOLS),
		graphExtract: env.PICHART_GRAPH === "on",
		specsVerify: env.PICHART_SPECS !== "off",
		docMaxDistance: distance(env.PICHART_DOC_MAX_DISTANCE, DEFAULT_DOC_MAX_DISTANCE),
		databaseUrl:
			env.PICHART_DATABASE_URL === undefined || env.PICHART_DATABASE_URL === ""
				? undefined
				: env.PICHART_DATABASE_URL,
		storeOrigin:
			env.PICHART_DATABASE_URL === undefined
				? "own"
				: env.PICHART_DATABASE_URL === ""
					? "declined"
					: "supplied",
		storeDir: env.PICHART_STORE_DIR || join(homedir(), ".pi-chart", "store"),
		docBundle:
			env.PICHART_DOC_BUNDLE ?? join(homedir(), ".pi-chart", "bundle"),
		tailTokens: count(env.PICHART_TAIL_TOKENS, DEFAULT_TAIL_TOKENS),
		recallTokens: count(env.PICHART_RECALL_TOKENS, DEFAULT_RECALL_TOKENS),
		docTokens: count(env.PICHART_DOC_TOKENS, DEFAULT_DOC_TOKENS),
		graphTokens: count(env.PICHART_GRAPH_TOKENS, DEFAULT_GRAPH_TOKENS),
		packTokens: count(env.PICHART_PACK_TOKENS, DEFAULT_PACK_TOKENS),
		explainCandidates: count(
			env.PICHART_EXPLAIN_CANDIDATES,
			DEFAULT_EXPLAIN_CANDIDATES,
		),
		packWarnShare: share(env.PICHART_PACK_WARN_SHARE, DEFAULT_PACK_WARN_SHARE),
		tailDeadlineMs: count(env.PICHART_TAIL_DEADLINE_MS, DEFAULT_TAIL_DEADLINE_MS),
		recallDeadlineMs: count(
			env.PICHART_RECALL_DEADLINE_MS,
			DEFAULT_RETRIEVAL_DEADLINE_MS,
		),
		docDeadlineMs: count(env.PICHART_DOC_DEADLINE_MS, DEFAULT_RETRIEVAL_DEADLINE_MS),
		graphDeadlineMs: count(
			env.PICHART_GRAPH_DEADLINE_MS,
			DEFAULT_RETRIEVAL_DEADLINE_MS,
		),
		retainDays: days(env.PICHART_RETAIN_DAYS, problems),
	};
}

/** The `Config` fields that hold a number, which is every Budget. */
type NumericSetting = {
	[Field in keyof Config]: Config[Field] extends number ? Field : never;
}[keyof Config];

/**
 * Which field each Budget name sets. One table rather than a chain, because
 * the names are now the product of a part and a denomination and a chain of
 * ten branches stops being readable.
 *
 * Keyed to the numeric fields only, so a future entry naming `docBundle`
 * fails to compile rather than writing a number into a path.
 */
const BUDGET_FIELDS: Record<string, NumericSetting> = {
	tail: "tailTurns",
	recall: "recallTurns",
	docs: "docConcepts",
	graph: "graphSymbols",
	"tail-tokens": "tailTokens",
	"recall-tokens": "recallTokens",
	"docs-tokens": "docTokens",
	"graph-tokens": "graphTokens",
	pack: "packTokens",
};

/**
 * Applies a Budget change for the running session.
 *
 * Deliberately in memory only: tuning is an experiment you run for a few
 * Turns, and an experiment that silently persists into tomorrow's sessions
 * is a trap. The environment variables remain the way to set a default.
 */
export function setBudget(
	config: Config,
	name: string,
	value: string,
): { ok: true; budget: number } | { ok: false; reason: string } {
	const field = BUDGET_FIELDS[name];
	if (field === undefined) {
		return {
			ok: false,
			reason:
				`unknown budget "${name}"; expected tail, recall, docs, graph, ` +
				`tail-tokens, recall-tokens, docs-tokens, graph-tokens or pack`,
		};
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== value.trim()) {
		return { ok: false, reason: `"${value}" is not a count` };
	}

	config[field] = parsed;
	return { ok: true, budget: parsed };
}

/** A share in [0, 1], or the default when unset or unusable. */
function share(raw: string | undefined, fallback: number): number {
	const parsed = raw === undefined ? Number.NaN : Number.parseFloat(raw);
	return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

/** A cosine distance in [0, 2], or the default when unset or unusable. */
function distance(raw: string | undefined, fallback: number): number {
	const parsed = raw === undefined ? Number.NaN : Number.parseFloat(raw);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : fallback;
}

/** A non-negative count, or the default when unset or unusable. */
function count(raw: string | undefined, fallback: number): number {
	const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * A retention age in days, or nothing.
 *
 * Unset means retention is off, which is the default and not a problem. A
 * value that cannot be read is refused *and said aloud*: silently treating
 * it as unset would leave someone believing their Store is being bounded,
 * and silently treating it as a number would delete stored Turns on a typo.
 */
function days(
	raw: string | undefined,
	problems: string[],
): number | undefined {
	if (raw === undefined || raw.trim() === "") return undefined;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
		problems.push(
			`PICHART_RETAIN_DAYS is "${raw}", which is not a number of days above zero. ` +
				`Retention stays off.`,
		);
		return undefined;
	}
	return parsed;
}
