import { afterAll, beforeAll, describe } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PostgresStore } from "../src/postgres-store.ts";
import { bunSql, type Sql } from "../src/sql.ts";
import { openPglite } from "./pglite-sql.ts";

const url = process.env.PICHART_DATABASE_URL;

/** The server `PICHART_DATABASE_URL` names, or none when it is unset or empty. */
export const serverUrl = url !== undefined && url !== "" ? url : undefined;

/**
 * `describe` for a suite only a real server can stand for, such as one
 * counting a pool's connections, and `describe.skip` without a server.
 */
export const describeServer = serverUrl ? describe : describe.skip;

/**
 * Where a store-backed suite keeps its data. With `PICHART_DATABASE_URL` set
 * the suites run against that server; without it they run against PGlite,
 * an in-process Postgres, in a per-suite temporary directory, so the contract
 * is exercised on every machine with no server to stand up.
 *
 * A location opens more than once: a second `open()` stands a second
 * connection in for a later process, which on PGlite is a second handle onto
 * the same directory.
 */
export interface StoreLocation {
	/** A fresh handle onto this location. */
	open(): Sql;
	/** Release the location — removes PGlite's directory; a no-op for a server. */
	dispose(): void;
}

export function storeLocation(): StoreLocation {
	if (serverUrl !== undefined) {
		return { open: () => bunSql(serverUrl), dispose: () => undefined };
	}
	const base = mkdtempSync(join(tmpdir(), "pi-store-"));
	// A nested subpath whose parents do not exist yet, so the directory PGlite
	// is opened at is created rather than assumed.
	const dir = join(base, "nested", "store");
	return {
		open: () => openPglite(dir),
		dispose: () => rmSync(base, { recursive: true, force: true }),
	};
}

/** How often a scratch database's connections are sampled, in milliseconds. */
export const SAMPLE_MS = 20;

/** A migrated database of a suite's own on the server, for counting what connects to it. */
export interface ScratchDatabase {
	/** Where it is; set once the suite's `beforeAll` has created it. */
	readonly url: string;
	/** The backends connected to it right now. */
	connections(): Promise<number>;
	/**
	 * The count once it settles at `expected`, or the last count seen
	 * after a second. A real wait: a closed connection's backend leaves
	 * `pg_stat_activity` a moment after the client lets go, and the
	 * server sends no signal to await.
	 */
	settlesAt(expected: number): Promise<number>;
}

/**
 * Creates and migrates `<name>_<pid>` on the server before the enclosing
 * suite's tests, and drops it after them. Call it inside a `describeServer`.
 */
export function scratchDatabase(name: string): ScratchDatabase {
	const database = `${name}_${process.pid}`;
	let admin: Sql | undefined;
	let at = "";

	async function connections(): Promise<number> {
		if (!admin) throw new Error(`${database} is used before its suite created it`);
		const [row] = await admin<{ n: number }>`
			SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = ${database}`;
		return row?.n ?? 0;
	}

	beforeAll(async () => {
		const server = serverUrl as string;
		admin = bunSql(server);
		await admin.unsafe(`CREATE DATABASE ${database}`);
		const scratch = new URL(server);
		scratch.pathname = `/${database}`;
		at = scratch.toString();
		// Migrated ahead, so each store's own migration only confirms it.
		const migrator = PostgresStore.connect(at);
		await migrator.migrate();
		await migrator.close();
	});

	afterAll(async () => {
		await admin?.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
		await admin?.end();
	});

	return {
		get url() {
			return at;
		},
		connections,
		async settlesAt(expected) {
			let seen = await connections();
			for (let tries = 0; seen !== expected && tries < 50; tries++) {
				await Bun.sleep(SAMPLE_MS);
				seen = await connections();
			}
			return seen;
		},
	};
}
