// Live seam. These exercise the three claims that are only true if the
// harness and the provider agree: that a pack reaches the model, that the
// journal keeps what the model never saw, and that window sizes are reported.
// They call a real model, so they run only under PICHART_LIVE=1.

import { describe, expect, test } from "bun:test";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readBundle } from "../src/doc-store.ts";
import { LocalEmbedder } from "../src/embedder.ts";
import { GraphStore } from "../src/graph-store.ts";
import { inspectConversation } from "../src/inspection.ts";
import { PostgresStore } from "../src/postgres-store.ts";
import { journalText, runHeadless } from "./harness.ts";

const live = process.env.PICHART_LIVE === "1";
const databaseUrl = process.env.PICHART_DATABASE_URL;
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
		PICHART_TAIL_TURNS: "0",
		PICHART_RECALL_TURNS: "0",
	};
	if (databaseUrl) env.PICHART_DATABASE_URL = databaseUrl;

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
				PICHART_DATABASE_URL: databaseUrl ?? "",
				PICHART_DOC_BUNDLE: bundle,
				PICHART_RECALL_TURNS: "0",
			};
			if (process.env.PICHART_BUN) env.PICHART_BUN = process.env.PICHART_BUN;

			// Indexed here, awaited, so the runs below measure retrieval
			// rather than whether background indexing happened to finish.
			const embedder = new LocalEmbedder(process.env.PICHART_BUN);
			const indexer = PostgresStore.connect(databaseUrl ?? "", embedder);
			try {
				await indexer.migrate();
				const concepts = await readBundle(bundle);
				await indexer.indexConcepts(concepts ?? []);
			} finally {
				await indexer.close();
				await embedder.close();
			}

			// Control first, in its own empty Codebase, with both routes to
			// the bundle closed: the Budget at zero and no bundle to walk.
			// Walking is deliberately unbudgeted, so closing only the Budget
			// would leave the agent a second way in — which it took.
			const withoutDocs = await runHeadless({
				prompt: question,
				extensions: [EXTENSION],
				env: {
					...env,
					PICHART_DOC_CONCEPTS: "0",
					PICHART_DOC_BUNDLE: await mkdtemp(join(tmpdir(), "cm-live-nobundle-")),
				},
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
				expect(curated[0]?.carried).toBeLessThanOrEqual(curated[0]?.budget?.count ?? 0);
			} finally {
				await store.close();
			}
		},
		TIMEOUT,
	);
});

/**
 * A Codebase the agent has never seen, holding this project's own source, so
 * the only way to answer a structural question is the graph.
 */
async function freshCodebase(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "cm-live-graph-"));
	await cp(new URL("../src", import.meta.url).pathname, join(root, "src"), {
		recursive: true,
	});
	return root;
}

const describeGraph =
	live && databaseUrl && process.env.PICHART_GRAPHIFY === "1"
		? describe
		: describe.skip;

describeGraph("codebase structure against a live model", () => {
	test(
		"a caller question is answered from the graph, with no file read",
		async () => {
			const cwd = await freshCodebase();
			const env: Record<string, string> = {
				PICHART_DATABASE_URL: databaseUrl ?? "",
				PICHART_RECALL_TURNS: "0",
				PICHART_DOC_CONCEPTS: "0",
			};
			if (process.env.PICHART_BUN) env.PICHART_BUN = process.env.PICHART_BUN;

			// Extracted here and awaited, so the run measures retrieval
			// rather than whether background extraction finished in time.
			await new GraphStore().refresh(cwd);

			const run = await runHeadless({
				cwd,
				prompt:
					"Which functions call parseConcept, and in which file do they live? " +
					"Answer only from what is already in your context: do not read, " +
					"grep, or list any files. If context does not say, reply UNKNOWN.",
				extensions: [EXTENSION],
				env,
			});

			// Both callers, from src/doc-store.ts, are edges a parser
			// established — and nothing else in the Turn could supply them.
			expect(run.stdout).toContain("ensureIdentities");
			expect(run.stdout).toContain("doc-store.ts");
			expect(run.stdout).not.toContain("UNKNOWN");

			const conversationId = run.journalPath
				.split("/")
				.pop()
				?.replace(/\.jsonl$/, "")
				.split("_")
				.pop();
			const store = PostgresStore.connect(databaseUrl ?? "");
			try {
				const structure = inspectConversation(
					await store.readAccounting(conversationId ?? ""),
				)
					.flatMap((call) => call.parts)
					.filter((part) => part.source === "structure");

				expect(structure.length).toBeGreaterThan(0);
				expect(structure[0]?.symbols?.join(" ")).toContain(
					"parseConcept() (src/concept.ts",
				);
				expect(structure[0]?.carried).toBeLessThanOrEqual(
					structure[0]?.budget?.count ?? 0,
				);
			} finally {
				await store.close();
			}
		},
		TIMEOUT,
	);
});
