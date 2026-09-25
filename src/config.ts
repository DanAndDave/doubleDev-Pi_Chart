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
	 * Thread Store connection. Defaults to what `docker compose up` in this
	 * project serves, so a working setup needs no setting; an unreachable
	 * one degrades to the harness's own history, which `/pack` reports.
	 */
	databaseUrl?: string;
	/** Where the machine-wide Doc Store bundle lives. */
	docBundle: string;
	/**
	 * Size Budgets in estimated tokens, beside the counts above. A part is
	 * trimmed to whichever binds first, and `packTokens` bounds the whole
	 * Context Pack however the parts divide it.
	 *
	 * Derived from measurement, not taste: the estimate runs ~1.15× low
	 * against the harness's reported figures at the median and 1.447× at the
	 * p90, so the ceiling is `(200,000 window − 28,000 measured Floor) / 1.5`.
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
 * The environment keeps the pairs because that is what it is — `CM_TAIL_TURNS`
 * and `CM_TAIL_TOKENS` are two variables, and `pack budget` names nine of
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
 * What `compose.yaml` serves, on the port it was told to serve. `CM_PG_PORT`
 * is honoured by the Compose file, so the extension has to dial the same
 * port or setup's two halves disagree about which store exists.
 */
export const DEFAULT_PG_PORT = 55432;
export function defaultDatabaseUrl(port: number = DEFAULT_PG_PORT): string {
	return `postgres://context_manager:context_manager@localhost:${port}/thread_store`;
}
export const DEFAULT_TAIL_TOKENS = 25_000;
export const DEFAULT_RECALL_TOKENS = 8_000;
export const DEFAULT_DOC_TOKENS = 5_000;
export const DEFAULT_GRAPH_TOKENS = 3_000;
/**
 * `(200,000 − 28,000) / 1.5`: a window the operator is likely to have, less
 * the Floor this project measures, divided by the estimator's measured p90
 * bias. The parts default to 41,000 together, which leaves the current Turn
 * 69,000 before the ceiling touches it — enough for 97.4% of real Turns.
 */
export const DEFAULT_PACK_TOKENS = 110_000;
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

export function loadConfig(env: Record<string, string | undefined>): Config {
	const problems: string[] = [];
	return {
		problems,
		tailTurns: count(env.CM_TAIL_TURNS, DEFAULT_TAIL_TURNS),
		recallTurns: count(env.CM_RECALL_TURNS, DEFAULT_RECALL_TURNS),
		recallMaxDistance: distance(
			env.CM_RECALL_MAX_DISTANCE,
			DEFAULT_RECALL_MAX_DISTANCE,
		),
		docConcepts: count(env.CM_DOC_CONCEPTS, DEFAULT_DOC_CONCEPTS),
		graphSymbols: count(env.CM_GRAPH_SYMBOLS, DEFAULT_GRAPH_SYMBOLS),
		graphExtract: env.CM_GRAPH === "on",
		specsVerify: env.CM_SPECS !== "off",
		docMaxDistance: distance(env.CM_DOC_MAX_DISTANCE, DEFAULT_DOC_MAX_DISTANCE),
		databaseUrl:
			env.CM_DATABASE_URL ??
			defaultDatabaseUrl(count(env.CM_PG_PORT, DEFAULT_PG_PORT)),
		docBundle:
			env.CM_DOC_BUNDLE ?? join(homedir(), ".context-manager", "bundle"),
		tailTokens: count(env.CM_TAIL_TOKENS, DEFAULT_TAIL_TOKENS),
		recallTokens: count(env.CM_RECALL_TOKENS, DEFAULT_RECALL_TOKENS),
		docTokens: count(env.CM_DOC_TOKENS, DEFAULT_DOC_TOKENS),
		graphTokens: count(env.CM_GRAPH_TOKENS, DEFAULT_GRAPH_TOKENS),
		packTokens: count(env.CM_PACK_TOKENS, DEFAULT_PACK_TOKENS),
		explainCandidates: count(
			env.CM_EXPLAIN_CANDIDATES,
			DEFAULT_EXPLAIN_CANDIDATES,
		),
		packWarnShare: share(env.CM_PACK_WARN_SHARE, DEFAULT_PACK_WARN_SHARE),
		tailDeadlineMs: count(env.CM_TAIL_DEADLINE_MS, DEFAULT_TAIL_DEADLINE_MS),
		recallDeadlineMs: count(
			env.CM_RECALL_DEADLINE_MS,
			DEFAULT_RETRIEVAL_DEADLINE_MS,
		),
		docDeadlineMs: count(env.CM_DOC_DEADLINE_MS, DEFAULT_RETRIEVAL_DEADLINE_MS),
		graphDeadlineMs: count(
			env.CM_GRAPH_DEADLINE_MS,
			DEFAULT_RETRIEVAL_DEADLINE_MS,
		),
		retainDays: days(env.CM_RETAIN_DAYS, problems),
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
			`CM_RETAIN_DAYS is "${raw}", which is not a number of days above zero. ` +
				`Retention stays off.`,
		);
		return undefined;
	}
	return parsed;
}
