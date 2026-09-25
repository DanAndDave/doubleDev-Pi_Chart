import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openPglite } from "../src/pglite-sql.ts";
import { bunSql, type Sql } from "../src/sql.ts";

const url = process.env.PICHART_DATABASE_URL;

/**
 * Where a store-backed suite keeps its data. With `PICHART_DATABASE_URL` set
 * the suites run against that server; without it they run against an embedded
 * store in a per-suite temporary directory, so the contract is exercised on
 * every machine with no server to stand up.
 *
 * A location opens more than once: a second `open()` stands a second
 * connection in for a later process, which on the embedded store is a second
 * handle onto the same directory.
 */
export interface StoreLocation {
	/** A fresh handle onto this location. */
	open(): Sql;
	/** Release the location — removes the embedded directory; a no-op for a server. */
	dispose(): void;
}

export function storeLocation(): StoreLocation {
	if (url !== undefined && url !== "") {
		return { open: () => bunSql(url), dispose: () => undefined };
	}
	const base = mkdtempSync(join(tmpdir(), "pi-store-"));
	// A nested subpath whose parents do not exist yet, so every store-backed
	// suite exercises the embedded store creating its data directory — the
	// `~/.pi-chart/store` case a fresh install hits on first run.
	const dir = join(base, "nested", "store");
	return {
		open: () => openPglite(dir),
		dispose: () => rmSync(base, { recursive: true, force: true }),
	};
}
