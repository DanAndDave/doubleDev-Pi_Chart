// Store-backed: the index lives in Postgres and the lifecycle ordering is
// SQL, so a fake would only prove our arithmetic.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseConcept, type Concept } from "../src/concept.ts";
import { DocStore } from "../src/doc-store.ts";
import { StubEmbedder } from "../src/embedder.ts";
import { PostgresStore } from "../src/postgres-store.ts";

const databaseUrl = process.env.CM_DATABASE_URL;
const describeStore = databaseUrl ? describe : describe.skip;
const AT = new Date("2026-09-16T00:00:00Z");

function concept(
	id: string,
	identity: string,
	body: string,
	frontmatter = "type: Decision",
): Concept {
	return parseConcept(
		id,
		`---\n${frontmatter}\ncm_identity: ${identity}\n---\n\n${body}\n`,
		AT,
	);
}

const CACHING = concept(
	"decisions/caching",
	"id-caching",
	"## Decision\n\nWe keep parsed configuration in memory rather than re-reading it.\n\n" +
		"## Deployment\n\nRolling restarts drain connections before stopping a node.",
	"type: Decision\ntitle: Caching parsed configuration",
);
const BANNER = concept(
	"standards/banner",
	"id-banner",
	"The banner is a muted green, and never competes with the primary action.",
	"type: Standard\ntitle: Banner colour",
);

describeStore("the concept index", () => {
	let store: PostgresStore;

	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	test("an indexed concept is findable by meaning", async () => {
		await store.indexConcepts([CACHING, BANNER]);

		const found = await store.searchConcepts("parsed configuration memory", 5, 2);

		expect(found.map((hit) => hit.conceptId)).toContain("decisions/caching");
	});

	test("a query matching one section retrieves its concept", async () => {
		await store.indexConcepts([CACHING]);

		// "Deployment" is the second section; the first is about caching.
		const found = await store.searchConcepts("rolling restarts drain", 5, 2);

		expect(found[0]?.conceptId).toBe("decisions/caching");
		expect(found[0]?.text).toContain("Rolling restarts");
	});

	test("a concept appears once however many sections match", async () => {
		await store.indexConcepts([CACHING]);

		const found = await store.searchConcepts("configuration", 10, 2);

		const caching = found.filter((hit) => hit.conceptId === "decisions/caching");
		expect(caching).toHaveLength(1);
	});

	test("emptying the index and indexing again finds the same concepts", async () => {
		await store.indexConcepts([CACHING, BANNER]);
		const before = await store.searchConcepts("parsed configuration", 5, 2);

		await store.truncate();
		await store.indexConcepts([CACHING, BANNER]);
		const after = await store.searchConcepts("parsed configuration", 5, 2);

		expect(after.map((hit) => hit.conceptId)).toEqual(
			before.map((hit) => hit.conceptId),
		);
	});

	test("a non-conformant concept is skipped and the rest are indexed", async () => {
		const broken = parseConcept("decisions/broken", "no frontmatter", AT);

		await store.indexConcepts([CACHING, broken]);

		const found = await store.searchConcepts("parsed configuration", 5, 2);
		expect(found.map((hit) => hit.conceptId)).not.toContain("decisions/broken");
		expect(found.map((hit) => hit.conceptId)).toContain("decisions/caching");
	});

	test("indexing an unchanged bundle embeds nothing the second time", async () => {
		expect(await store.indexConcepts([CACHING, BANNER])).toBeGreaterThan(0);

		expect(await store.indexConcepts([CACHING, BANNER])).toBe(0);
	});

	test("an edited concept is findable by its new content", async () => {
		await store.indexConcepts([CACHING]);
		const edited = concept(
			"decisions/caching",
			"id-caching",
			"## Decision\n\nWe now reload configuration on every request instead.",
			"type: Decision\ntitle: Caching parsed configuration",
		);

		expect(await store.indexConcepts([edited])).toBeGreaterThan(0);

		const found = await store.searchConcepts("reload every request", 5, 2);
		expect(found[0]?.text).toContain("reload configuration on every request");
	});

	test("a concept removed from the bundle leaves the index", async () => {
		await store.indexConcepts([CACHING, BANNER]);

		await store.indexConcepts([CACHING]);

		const found = await store.searchConcepts("muted green banner", 5, 2);
		expect(found.map((hit) => hit.conceptId)).not.toContain("standards/banner");
	});

	test("sections an edit removed leave the index", async () => {
		await store.indexConcepts([CACHING]);
		const shortened = concept(
			"decisions/caching",
			"id-caching",
			"## Decision\n\nWe keep parsed configuration in memory rather than re-reading it.",
			"type: Decision\ntitle: Caching parsed configuration",
		);

		await store.indexConcepts([shortened]);

		// Tight enough that only a section genuinely about deployment matches.
		const found = await store.searchConcepts("rolling restarts drain", 5, 0.5);
		expect(found).toEqual([]);
	});
});

describeStore("lifecycle and trust in retrieval", () => {
	let store: PostgresStore;

	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	test("a deprecated concept is withheld even when it matches best", async () => {
		const superseded = concept(
			"decisions/old-caching",
			"id-old",
			"We keep parsed configuration in memory rather than re-reading it.",
			"type: Decision\ntitle: Caching\nstatus: deprecated",
		);
		await store.indexConcepts([superseded]);

		const found = await store.searchConcepts(
			"We keep parsed configuration in memory rather than re-reading it.",
			5,
			2,
		);

		expect(found).toEqual([]);
	});

	// Rivals share their text, so distance cannot separate them, and the
	// current one is named so that alphabetical order would put it second.
	// Only the tie-break can produce the expected answer.
	const BODY = "Retries use exponential backoff capped at thirty seconds.";

	test("current knowledge comes before stale knowledge saying the same thing", async () => {
		const outdated = concept(
			"decisions/a-retries",
			"id-stale",
			BODY,
			"type: Decision\ntitle: Retries\nstale_after: 2020-01-01T00:00:00Z",
		);
		const current = concept(
			"decisions/z-retries",
			"id-current",
			BODY,
			"type: Decision\ntitle: Retries",
		);
		await store.indexConcepts([outdated, current]);

		const found = await store.searchConcepts(BODY, 5, 2);

		expect(found[0]?.conceptId).toBe("decisions/z-retries");
		expect(found[0]?.stale).toBe(false);
		expect(found[1]?.stale).toBe(true);
	});

	test("human-reviewed knowledge comes before unverified knowledge", async () => {
		const unverified = concept(
			"decisions/a-retries",
			"id-unverified",
			BODY,
			"type: Decision\ntitle: Retries",
		);
		const reviewed = concept(
			"decisions/z-retries",
			"id-reviewed",
			BODY,
			"type: Decision\ntitle: Retries\nverified:\n  - { by: human:zero, at: 2026-07-01T09:00:00Z }",
		);
		await store.indexConcepts([unverified, reviewed]);

		const found = await store.searchConcepts(BODY, 5, 2);

		expect(found[0]?.conceptId).toBe("decisions/z-retries");
		expect(found[0]?.trust).toBe("human-reviewed");
	});

	test("relevance still outranks trust", async () => {
		// A reviewed Concept about something else must not displace an
		// unverified Concept that actually answers the question.
		const offTopic = concept(
			"decisions/a-banner",
			"id-banner",
			"The banner is a muted green and never competes with the primary action.",
			"type: Decision\ntitle: Banner\nverified:\n  - { by: human:zero, at: 2026-07-01T09:00:00Z }",
		);
		const onTopic = concept(
			"decisions/z-retries",
			"id-retries",
			BODY,
			"type: Decision\ntitle: Retries",
		);
		await store.indexConcepts([offTopic, onTopic]);

		const found = await store.searchConcepts(BODY, 5, 2);

		expect(found[0]?.conceptId).toBe("decisions/z-retries");
	});

	test("nothing relevant returns nothing", async () => {
		await store.indexConcepts([CACHING]);

		expect(await store.searchConcepts("parsed configuration", 5, 0.01)).toEqual([]);
	});

	test("an unindexed bundle returns nothing rather than raising", async () => {
		expect(await store.searchConcepts("anything at all", 5, 2)).toEqual([]);
	});
});

describeStore("indexing a bundle from disk", () => {
	let store: PostgresStore;

	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
	});

	test("a bundle whose concepts have never been identified still indexes", async () => {
		await store.truncate();
		// The fixture bundle ships without identities, exactly as an author's
		// new bundle does. Indexing has to assign them, or nothing is
		// indexable and the Doc Store silently contributes nothing.
		const directory = await mkdtemp(join(tmpdir(), "cm-index-bundle-"));
		await cp(new URL("./fixtures/bundle", import.meta.url).pathname, directory, {
			recursive: true,
		});
		const bundle = new DocStore(directory);
		await bundle.ensureIdentities();

		const embedded = await store.indexConcepts(await bundle.concepts());

		expect(embedded).toBeGreaterThan(0);
	});
});
