// Live seam. These exercise the three claims that are only true if the
// harness and the provider agree: that a pack reaches the model, that the
// journal keeps what the model never saw, and that window sizes are reported.
// They call a real model, so they run only under CM_LIVE=1.

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Accounting } from "../src/accounting.ts";
import { journalText, runHeadless } from "./harness.ts";

const live = process.env.CM_LIVE === "1";
const describeLive = live ? describe : describe.skip;

const EXTENSION = new URL("../src/extension.ts", import.meta.url).pathname;
const CODEWORD = "falcon";
const TIMEOUT = 240_000;

/** A two-turn conversation whose second turn cannot see the first. */
async function forgetfulConversation() {
	const cwd = await mkdtemp(join(tmpdir(), "cm-live-"));
	const accountingDir = await mkdtemp(join(tmpdir(), "cm-live-acct-"));
	const env = { CM_TAIL_TURNS: "0", CM_ACCOUNTING_DIR: accountingDir };

	const first = await runHeadless({
		cwd,
		prompt: `Remember this codeword: ${CODEWORD}. Reply with just: ok`,
		extensions: [EXTENSION],
		env,
	});
	const second = await runHeadless({
		cwd,
		continueSession: true,
		prompt:
			"What was the codeword I gave you? If you do not know it, reply with exactly: UNKNOWN",
		extensions: [EXTENSION],
		env,
	});

	return { first, second, accountingDir };
}

describeLive("the harness helper", () => {
	test(
		"round-trips a prompt and captures the journal",
		async () => {
			const run = await runHeadless({ prompt: "Reply with just the word: pear" });

			expect(run.exitCode).toBe(0);
			expect(run.stdout.toLowerCase()).toContain("pear");
			expect(journalText(run, "user").join()).toContain("pear");
			expect(journalText(run, "assistant").length).toBeGreaterThan(0);
		},
		TIMEOUT,
	);
});

describeLive("assembly against a live model", () => {
	test(
		"content outside the pack never reaches the model, but the journal keeps it",
		async () => {
			const { first, second } = await forgetfulConversation();

			expect(first.stdout.toLowerCase()).toContain("ok");

			// The model was given only the current turn, so the codeword is gone.
			expect(second.stdout).toContain("UNKNOWN");
			expect(second.stdout.toLowerCase()).not.toContain(CODEWORD);

			// The journal still holds the turn the model never saw.
			expect(journalText(second, "user").join(" ")).toContain(CODEWORD);
		},
		TIMEOUT,
	);
});

describeLive("accounting against a live model", () => {
	test(
		"records a non-zero floor for a trivially small pack",
		async () => {
			const { second, accountingDir } = await forgetfulConversation();

			const conversationId = second.journalPath
				.split("/")
				.pop()
				?.replace(/\.jsonl$/, "")
				.split("_")
				.pop();
			expect(conversationId).toBeTruthy();

			const turns = await new Accounting(accountingDir).read(
				conversationId ?? "",
			);

			expect(turns.length).toBeGreaterThan(0);
			const measured = turns.filter((turn) => turn.floorTokens !== undefined);
			expect(measured.length).toBeGreaterThan(0);
			for (const turn of measured) {
				expect(turn.floorTokens).toBeGreaterThan(0);
				expect(turn.packTokens).toBeLessThan(turn.floorTokens ?? 0);
			}
		},
		TIMEOUT,
	);
});
