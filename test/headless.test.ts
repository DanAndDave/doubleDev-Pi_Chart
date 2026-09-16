// Live seam. These exercise the three claims that are only true if the
// harness and the provider agree: that a pack reaches the model, that the
// journal keeps what the model never saw, and that window sizes are reported.
// They call a real model, so they run only under CM_LIVE=1.

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readBundle } from "../src/doc-store.ts";
import { LocalEmbedder } from "../src/embedder.ts";
import { inspectConversation } from "../src/inspection.ts";
import { PostgresStore } from "../src/postgres-store.ts";
import { journalText, runHeadless } from "./harness.ts";

const live = process.env.CM_LIVE === "1";
const databaseUrl = process.env.CM_DATABASE_URL;
const describeLive = live ? describe : describe.skip;
// Accounting now lives in the Thread Store, so reading it back needs both a
// real model and a real database.
const describeStore = live && databaseUrl ? describe : describe.skip;

const EXTENSION = new URL("../src/extension.ts", import.meta.url).pathname;
const CODEWORD = "falcon";
const TIMEOUT = 240_000;

/**
 * A two-turn conversation whose second turn cannot see the first.
 *
 * Recall is switched off deliberately: it exists to bring exactly this
 * content back, so leaving it on would test the opposite of the claim here,
 * which is that content the pack omits does not reach the model.
 */
async function forgetfulConversation() {
	const cwd = await mkdtemp(join(tmpdir(), "cm-live-"));
	const env: Record<string, string> = {
		CM_TAIL_TURNS: "0",
		CM_RECALL_TURNS: "0",
	};
	if (databaseUrl) env.CM_DATABASE_URL = databaseUrl;

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

	return { first, second };
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

describeStore("accounting against a live model and a real store", () => {
	test(
		"records a non-zero floor for a trivially small pack",
		async () => {
			const { second } = await forgetfulConversation();

			const conversationId = second.journalPath
				.split("/")
				.pop()
				?.replace(/\.jsonl$/, "")
				.split("_")
				.pop();
			expect(conversationId).toBeTruthy();

			const store = PostgresStore.connect(databaseUrl ?? "");
			try {
				const turns = await store.readAccounting(conversationId ?? "");

				expect(turns.length).toBeGreaterThan(0);
				const measured = turns.filter((turn) => turn.floorTokens !== undefined);
				expect(measured.length).toBeGreaterThan(0);
				for (const turn of measured) {
					expect(turn.floorTokens).toBeGreaterThan(0);
					expect(turn.packTokens).toBeLessThan(turn.floorTokens ?? 0);
				}
			} finally {
				await store.close();
			}
		},
		TIMEOUT,
	);
});

/**
 * A bundle holding one Concept with a fact no model can guess, written into
 * a temporary directory so the test never touches the user's own bundle.
 */
async function secretBundle(secret: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "cm-live-bundle-"));
	await Bun.write(
		join(root, "decisions", "0001-settlement-window.md"),
		[
			"---",
			"type: Decision",
			"title: When the settlement window closes",
			"description: The nightly settlement cutoff.",
			"status: stable",
			"verified:",
			"  - { by: human:test, at: 2026-09-16T00:00:00Z }",
			"---",
			"",
			"# Decision",
			"",
			"The nightly settlement window closes at the value recorded in",
			`configuration as SETTLEMENT_CLOSE = "${secret}".`,
			"",
			"# Rationale",
			"",
			"Card networks deliver their final files shortly after midnight, and",
			"closing on the hour lost a day of settlements whenever one was late.",
			"",
		].join("\n"),
	);
	return root;
}

describeStore("curated knowledge against a live model", () => {
	test(
		"a concept answers a question in a codebase that has never seen it",
		async () => {
			const secret = `tapir-${Math.floor(Math.random() * 9000) + 1000}`;
			const bundle = await secretBundle(secret);
			const question =
				`What is the value of SETTLEMENT_CLOSE? Answer with just the value, ` +
				`or exactly UNKNOWN if you do not know.`;
			const env: Record<string, string> = {
				CM_DATABASE_URL: databaseUrl ?? "",
				CM_DOC_BUNDLE: bundle,
				CM_RECALL_TURNS: "0",
			};
			if (process.env.CM_BUN) env.CM_BUN = process.env.CM_BUN;

			// Indexed here, awaited, so the runs below measure retrieval
			// rather than whether background indexing happened to finish.
			const embedder = new LocalEmbedder(process.env.CM_BUN);
			const indexer = PostgresStore.connect(databaseUrl ?? "", embedder);
			try {
				await indexer.migrate();
				const concepts = await readBundle(bundle);
				await indexer.indexConcepts(concepts ?? []);
			} finally {
				await indexer.close();
				await embedder.close();
			}

			// Control first, in its own empty Codebase: without the Doc Store
			// the fact is unreachable, so the answer below can only come from
			// the bundle.
			const withoutDocs = await runHeadless({
				prompt: question,
				extensions: [EXTENSION],
				env: { ...env, CM_DOC_CONCEPTS: "0" },
			});
			expect(withoutDocs.stdout).not.toContain(secret);

			const withDocs = await runHeadless({
				prompt: question,
				extensions: [EXTENSION],
				env,
			});

			expect(withDocs.stdout).toContain(secret);

			// And the Call says where it came from: the curated part, named,
			// inside its Budget.
			const conversationId = withDocs.journalPath
				.split("/")
				.pop()
				?.replace(/\.jsonl$/, "")
				.split("_")
				.pop();
			const store = PostgresStore.connect(databaseUrl ?? "");
			try {
				const calls = inspectConversation(
					await store.readAccounting(conversationId ?? ""),
				);
				const curated = calls
					.flatMap((call) => call.parts)
					.filter((part) => part.source === "curated");

				expect(curated.length).toBeGreaterThan(0);
				expect(curated[0]?.conceptIds).toContain(
					"decisions/0001-settlement-window",
				);
				expect(curated[0]?.carried).toBeLessThanOrEqual(curated[0]?.budget ?? 0);
			} finally {
				await store.close();
			}
		},
		TIMEOUT,
	);
});
