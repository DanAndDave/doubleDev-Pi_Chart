import { afterEach, describe, expect, test } from "bun:test";

import { findBun, forgetBun } from "../src/bun-runtime.ts";

afterEach(() => {
	forgetBun();
});

describe("finding a bun to run the embedder", () => {
	test("finds one on this machine without being told", async () => {
		// The whole point: `CM_BUN` was a setting everyone had to get right,
		// and getting it wrong silenced recall rather than failing.
		expect(await findBun({ HOME: process.env.HOME })).toBeDefined();
	});

	test("what it finds actually runs as bun", async () => {
		const found = await findBun({ HOME: process.env.HOME });
		if (!found) throw new Error("no bun found");

		const spawned = Bun.spawn([found, "--version"], { stdout: "pipe" });
		const version = await new Response(spawned.stdout).text();

		expect(version.trim()).toMatch(/^\d+\.\d+/);
	});

	test("a configured runtime wins when it works", async () => {
		const real = await findBun({ HOME: process.env.HOME });
		forgetBun();

		expect(await findBun({ CM_BUN: real, HOME: process.env.HOME })).toBe(
			real ?? "",
		);
	});

	test("a configured runtime that does not work is passed over", async () => {
		// Which is what a version-manager shim does outside a directory it
		// knows: it exits non-zero rather than being absent.
		const found = await findBun({
			CM_BUN: "/nonexistent/bun",
			HOME: process.env.HOME,
		});

		expect(found).toBeDefined();
		expect(found).not.toBe("/nonexistent/bun");
	});

	test("the answer is resolved once", async () => {
		const first = findBun({ HOME: process.env.HOME });
		const second = findBun({ HOME: process.env.HOME });

		// Every batch would otherwise pay for the search.
		expect(first).toBe(second);
	});
});
