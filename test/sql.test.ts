import { describe, expect, test } from "bun:test";

import { connectionOptions } from "../src/sql.ts";

describe("connecting from a saved url", () => {
	test("a TCP url is handed over as it is", () => {
		const url = "postgres://pi_chart:pi_chart@localhost:55432/thread_store";
		expect(connectionOptions(url)).toBe(url);
	});

	test("a socket directory becomes the socket path Bun dials", () => {
		// Bun's client refuses every socket url form, and accepts a path.
		expect(
			connectionOptions("postgres://me@localhost:5433/pi_chart?host=/run/postgresql"),
		).toEqual({
			path: "/run/postgresql/.s.PGSQL.5433",
			username: "me",
			password: undefined,
			database: "pi_chart",
		});
	});

	test("the socket's port defaults to Postgres's own", () => {
		expect(
			connectionOptions("postgres://me:p%40ss@localhost/pi_chart?host=%2Ftmp"),
		).toEqual({
			path: "/tmp/.s.PGSQL.5432",
			username: "me",
			password: "p@ss",
			database: "pi_chart",
		});
	});

	test("a host that names a machine, not a directory, stays a url", () => {
		const url = "postgres://me@localhost/pi_chart?host=db.example";
		expect(connectionOptions(url)).toBe(url);
	});
});
