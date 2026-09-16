import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
	/** Completed Turns carried verbatim ahead of the current one. */
	tailTurns: number;
	/** Thread Store connection. Absent means run without a store. */
	databaseUrl?: string;
	/** Where the machine-wide Doc Store bundle lives. */
	docBundle: string;
}

export const DEFAULT_TAIL_TURNS = 8;

export function loadConfig(env: Record<string, string | undefined>): Config {
	const raw = env.CM_TAIL_TURNS;
	const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
	return {
		tailTurns:
			Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TAIL_TURNS,
		databaseUrl: env.CM_DATABASE_URL,
		docBundle:
			env.CM_DOC_BUNDLE ?? join(homedir(), ".context-manager", "bundle"),
	};
}
