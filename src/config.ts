import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
	/** Completed Turns carried verbatim ahead of the current one. */
	tailTurns: number;
	/** How many recalled Turns a pack may carry. Zero disables recall. */
	recallTurns: number;
	/**
	 * How distant a Turn may be and still be worth recalling, as cosine
	 * distance. Measured, not chosen: genuine hits land at 0.30-0.39 and
	 * unrelated prompts at 0.51 and above on the pinned model.
	 */
	recallMaxDistance: number;
	/** Thread Store connection. Absent means run without a store. */
	databaseUrl?: string;
	/** Where the machine-wide Doc Store bundle lives. */
	docBundle: string;
}

export const DEFAULT_TAIL_TURNS = 8;
export const DEFAULT_RECALL_TURNS = 4;
export const DEFAULT_RECALL_MAX_DISTANCE = 0.5;

export function loadConfig(env: Record<string, string | undefined>): Config {
	return {
		tailTurns: count(env.CM_TAIL_TURNS, DEFAULT_TAIL_TURNS),
		recallTurns: count(env.CM_RECALL_TURNS, DEFAULT_RECALL_TURNS),
		recallMaxDistance: distance(
			env.CM_RECALL_MAX_DISTANCE,
			DEFAULT_RECALL_MAX_DISTANCE,
		),
		databaseUrl: env.CM_DATABASE_URL,
		docBundle:
			env.CM_DOC_BUNDLE ?? join(homedir(), ".context-manager", "bundle"),
	};
}

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
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== value.trim()) {
		return { ok: false, reason: `"${value}" is not a count` };
	}

	if (name === "tail") {
		config.tailTurns = parsed;
		return { ok: true, budget: parsed };
	}
	if (name === "recall") {
		config.recallTurns = parsed;
		return { ok: true, budget: parsed };
	}
	return { ok: false, reason: `unknown budget "${name}"; expected tail or recall` };
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
