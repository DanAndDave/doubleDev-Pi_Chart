// Store-backed: the index lives in Postgres and the lifecycle ordering is
// SQL, so a fake would only prove our arithmetic.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseConcept, type Concept } from "../src/concept.ts";
import { DocStore } from "../src/doc-store.ts";
import { SQL } from "bun";

import { LocalEmbedder, StubEmbedder } from "../src/embedder.ts";
import { PostgresStore } from "../src/postgres-store.ts";

const databaseUrl = process.env.CM_DATABASE_URL;
const describeStore = databaseUrl ? describe : describe.skip;
// The stub embedder shares tokens, so under it "by meaning" and "by wording"
// are the same claim. Only the real model can tell them apart.
const describeModel =
	databaseUrl && process.env.CM_EMBED === "1" ? describe : describe.skip;
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
	let sql: SQL;

	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
		sql = new SQL(databaseUrl ?? "");
	});

	afterAll(async () => {
		await store?.close();
		await sql?.close();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	test("an indexed concept is findable, and an unrelated one is not", async () => {
		await store.indexConcepts([CACHING, BANNER]);

		// The threshold the product ships with: a wider one would return the
		// whole corpus and prove only that rows exist.
		const found = await store.searchConcepts("parsed configuration memory", 5, 0.5);

		expect(found.map((hit) => hit.conceptId)).toEqual(["decisions/caching"]);
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
		expect(before.length).toBeGreaterThan(0);

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
		expect((await store.indexConcepts([CACHING, BANNER])).embedded).toBeGreaterThan(0);

		expect((await store.indexConcepts([CACHING, BANNER])).embedded).toBe(0);
	});

	test("an edited concept is findable by its new content", async () => {
		await store.indexConcepts([CACHING]);
		const edited = concept(
			"decisions/caching",
			"id-caching",
			"## Decision\n\nWe now reload configuration on every request instead.",
			"type: Decision\ntitle: Caching parsed configuration",
		);

		expect((await store.indexConcepts([edited])).embedded).toBeGreaterThan(0);

		const found = await store.searchConcepts("reload every request", 5, 2);
		expect(found[0]?.text).toContain("reload configuration on every request");
	});

	test("a concept removed from the bundle leaves the index", async () => {
		await store.indexConcepts([CACHING, BANNER]);

		await store.indexConcepts([CACHING]);

		const found = await store.searchConcepts("muted green banner", 5, 2);
		expect(found.map((hit) => hit.conceptId)).not.toContain("standards/banner");
	});

	test("a concept edited into nothing leaves the index", async () => {
		await store.indexConcepts([CACHING]);
		const emptied = concept("decisions/caching", "id-caching", "", "type: Decision");

		await store.indexConcepts([emptied]);

		const found = await store.searchConcepts("parsed configuration", 5, 2);
		expect(found.map((hit) => hit.conceptId)).not.toContain("decisions/caching");
	});

	test("a section that lost its vector is embedded again", async () => {
		await store.indexConcepts([CACHING]);
		// The state an interrupted index leaves behind: text and hash
		// current, vector gone.
		await sql`UPDATE concept_sections SET embedding = NULL`;

		const { embedded } = await store.indexConcepts([CACHING]);

		expect(embedded).toBeGreaterThan(0);
		const found = await store.searchConcepts("parsed configuration memory", 5, 0.5);
		expect(found.map((hit) => hit.conceptId)).toContain("decisions/caching");
	});

	test("a concept that has been deprecated leaves the index", async () => {
		await store.indexConcepts([CACHING]);
		const superseded = concept(
			"decisions/caching",
			"id-caching",
			CACHING.body,
			"type: Decision\ntitle: Caching\nstatus: deprecated",
		);

		await store.indexConcepts([superseded]);

		// Not merely filtered at query time: a superseded Concept still in
		// the index would fill the candidate window ahead of its successor.
		const rows = (await sql`
			SELECT count(*)::int AS count FROM concept_sections`) as {
			count: number;
		}[];
		expect(rows[0]?.count).toBe(0);
	});

	test("a concept that copied another's identity is named, not swallowed", async () => {
		const copy = concept(
			"decisions/caching-copy",
			"id-caching",
			"## Decision\n\nA copy that never had its identity replaced.",
			"type: Decision\ntitle: Caching copy",
		);

		const { contested } = await store.indexConcepts([CACHING, copy]);

		expect(contested).toEqual(["decisions/caching-copy"]);
	});

	test("sections an edit removed leave the index", async () => {
		await store.indexConcepts([CACHING]);
		const shortened = concept(
			"decisions/caching",
			"id-caching",
			"## Decision\n\nWe keep parsed configuration in memory rather than re-reading it.",
			"type: Decision\ntitle: Caching parsed configuration",
		);

		// The section is retrievable before the edit, so its absence after
		// can only be the deletion.
		const query = "rolling restarts drain connections";
		expect(await store.searchConcepts(query, 5, 0.6)).not.toEqual([]);

		await store.indexConcepts([shortened]);

		expect(await store.searchConcepts(query, 5, 0.6)).toEqual([]);
	});
});

/**
 * The query this file's ranking tests search with, and the vectors `place`
 * positions around it. Distances are set directly because no wording puts
 * two Concepts a chosen distance apart.
 */
const PROBE = "anchor";

async function place(
	sql: SQL,
	rows: { conceptId: string; distance: number; stale: boolean }[],
): Promise<void> {
	const [probe] = await new StubEmbedder().embed([PROBE]);
	if (!probe) throw new Error("no probe vector");
	// A vector at cosine distance d from the probe: rotate towards an axis
	// the probe does not use.
	const axis = probe.map((_, index) => (index === probe.length - 1 ? 1 : 0));
	for (const [index, row] of rows.entries()) {
		const cos = 1 - row.distance;
		const sin = Math.sqrt(1 - cos * cos);
		const vector = probe.map(
			(value, at) => value * cos + (axis[at] ?? 0) * sin,
		);
		await sql`
			INSERT INTO concept_sections
				(identity, section_index, concept_id, status, trust, stale, hash,
				 text, embedding)
			VALUES (
				${`id-${index}`}, 0, ${row.conceptId}, 'stable', 'unverified',
				${row.stale}, ${`hash-${index}`}, ${`text for ${row.conceptId}`},
				${JSON.stringify(vector)}::vector
			)`;
	}
}

describeStore("lifecycle and trust in retrieval", () => {
	let store: PostgresStore;
	let sql: SQL;

	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
		// Its own connection: placing vectors by hand is a fixture concern,
		// not something the Store's interface should expose.
		sql = new SQL(databaseUrl ?? "");
	});

	afterAll(async () => {
		await store?.close();
		await sql?.close();
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

	test("a nearer but stale concept still loses to a comparable current one", async () => {
		// Near but not equal — 0.047 apart, inside the band — so only a band
		// of comparable relevance, not an exact tie, can let trust decide.
		const LONG =
			"Retries use exponential backoff capped at thirty seconds, jittered " +
			"to avoid a thundering herd.";
		const stale = concept(
			"decisions/a-retries",
			"id-stale",
			`${LONG} Jitter is uniform.`,
			"type: Decision\ntitle: Retries\nstale_after: 2020-01-01T00:00:00Z",
		);
		const current = concept(
			"decisions/z-retries",
			"id-current",
			`${LONG} Jitter is uniform and bounded.`,
			"type: Decision\ntitle: Retries",
		);
		await store.indexConcepts([stale, current]);

		const found = await store.searchConcepts(
			`Retries\n\n${LONG} Jitter is uniform.`,
			5,
			2,
		);

		expect(found[0]?.conceptId).toBe("decisions/z-retries");
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

	test("a distant concept never outranks a nearer one on trust alone", async () => {
		// Placed by hand at 0.10, 0.20 and 0.50 from the query: crafting
		// those distances through text is not possible, and the ordering is
		// exactly what this checks. The nearest is current, the middle one
		// stale, the furthest current — so any rule that lets trust outrank
		// relevance puts the furthest second.
		await place(sql, [
			{ conceptId: "decisions/nearest", distance: 0.1, stale: false },
			{ conceptId: "decisions/middle", distance: 0.2, stale: true },
			{ conceptId: "decisions/furthest", distance: 0.5, stale: false },
		]);

		const found = await store.searchConcepts(PROBE, 3, 2);

		expect(found.map((hit) => hit.conceptId)).toEqual([
			"decisions/nearest",
			"decisions/middle",
			"decisions/furthest",
		]);
	});

	test("within the band, trust outranks a slightly better match", async () => {
		// 0.02 apart — inside the band — so the fresher Concept wins even
		// though the stale one matches marginally better.
		await place(sql, [
			{ conceptId: "decisions/stale-best", distance: 0.2, stale: true },
			{ conceptId: "decisions/current", distance: 0.22, stale: false },
		]);

		const found = await store.searchConcepts(PROBE, 2, 2);

		expect(found.map((hit) => hit.conceptId)).toEqual([
			"decisions/current",
			"decisions/stale-best",
		]);
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

		const { embedded } = await store.indexConcepts(await bundle.concepts());

		expect(embedded).toBeGreaterThan(0);
	});
});

describeModel("retrieval under the real model", () => {
	test(
		"a concept is found by a query that shares its meaning, not its words",
		async () => {
			const embedder = new LocalEmbedder(process.env.CM_BUN ?? "bun");
			const store = PostgresStore.connect(databaseUrl ?? "", embedder);
			try {
				await store.migrate();
				await store.truncate();
				await store.indexConcepts([
					concept(
						"decisions/sharding",
						"id-sharding",
						"## Decision\n\nThe payments ledger is split across shards by " +
							"merchant identifier, so one merchant's history stays on one " +
							"shard and reconciliation is a local scan.",
						"type: Decision\ntitle: Ledger sharding",
					),
					BANNER,
				]);

				// No content word in common with the Concept: not "shard",
				// "merchant", "ledger" or "reconciliation".
				const found = await store.searchConcepts(
					"how is the payments table partitioned across servers",
					2,
					0.5,
				);

				expect(found.map((hit) => hit.conceptId)).toEqual([
					"decisions/sharding",
				]);
			} finally {
				await store.close();
				await embedder.close();
			}
		},
		300_000,
	);
});
