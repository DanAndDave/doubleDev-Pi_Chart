// Store-backed: the index lives in Postgres and the lifecycle ordering is
// SQL, so a fake would only prove our arithmetic.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseConcept, type Concept } from "../src/concept.ts";
import { DocStore } from "../src/doc-store.ts";
import { SQL } from "bun";

import {
	LocalEmbedder,
	PINNED_DIMENSIONS,
	StubEmbedder,
} from "../src/embedder.ts";
import { PostgresStore } from "../src/postgres-store.ts";

const databaseUrl = process.env.PICHART_DATABASE_URL;
const describeStore = databaseUrl ? describe : describe.skip;
// The stub embedder shares tokens, so under it "by meaning" and "by wording"
// are the same claim. Only the real model can tell them apart.
const describeModel =
	databaseUrl && process.env.PICHART_EMBED === "1" ? describe : describe.skip;
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
		const found = (await store.searchConcepts("parsed configuration memory", 5, 0.5))
			.hits;

		expect(found.map((hit) => hit.conceptId)).toEqual(["decisions/caching"]);
	});

	test("a query matching one section retrieves its concept", async () => {
		await store.indexConcepts([CACHING]);

		// "Deployment" is the second section; the first is about caching.
		const found = (await store.searchConcepts("rolling restarts drain", 5, 2)).hits;

		expect(found[0]?.conceptId).toBe("decisions/caching");
		expect(found[0]?.text).toContain("Rolling restarts");
	});

	test("a concept appears once however many sections match", async () => {
		await store.indexConcepts([CACHING]);

		const found = (await store.searchConcepts("configuration", 10, 2)).hits;

		const caching = found.filter((hit) => hit.conceptId === "decisions/caching");
		expect(caching).toHaveLength(1);
	});

	test("emptying the index and indexing again finds the same concepts", async () => {
		await store.indexConcepts([CACHING, BANNER]);
		const before = (await store.searchConcepts("parsed configuration", 5, 2)).hits;
		expect(before.length).toBeGreaterThan(0);

		await store.truncate();
		await store.indexConcepts([CACHING, BANNER]);
		const after = (await store.searchConcepts("parsed configuration", 5, 2)).hits;

		expect(after.map((hit) => hit.conceptId)).toEqual(
			before.map((hit) => hit.conceptId),
		);
	});

	test("a non-conformant concept is skipped and the rest are indexed", async () => {
		const broken = parseConcept("decisions/broken", "no frontmatter", AT);

		await store.indexConcepts([CACHING, broken]);

		const found = (await store.searchConcepts("parsed configuration", 5, 2)).hits;
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

		const found = (await store.searchConcepts("reload every request", 5, 2)).hits;
		expect(found[0]?.text).toContain("reload configuration on every request");
	});

	test("a concept removed from the bundle leaves the index", async () => {
		await store.indexConcepts([CACHING, BANNER]);

		await store.indexConcepts([CACHING]);

		const found = (await store.searchConcepts("muted green banner", 5, 2)).hits;
		expect(found.map((hit) => hit.conceptId)).not.toContain("standards/banner");
	});

	test("a concept edited into nothing leaves the index", async () => {
		await store.indexConcepts([CACHING]);
		const emptied = concept("decisions/caching", "id-caching", "", "type: Decision");

		await store.indexConcepts([emptied]);

		const found = (await store.searchConcepts("parsed configuration", 5, 2)).hits;
		expect(found.map((hit) => hit.conceptId)).not.toContain("decisions/caching");
	});

	test("a section that lost its vector is embedded again", async () => {
		await store.indexConcepts([CACHING]);
		// The state an interrupted index leaves behind: text and hash
		// current, vector gone.
		await sql`UPDATE concept_sections SET embedding = NULL`;

		const { embedded } = await store.indexConcepts([CACHING]);

		expect(embedded).toBeGreaterThan(0);
		const found = (await store.searchConcepts("parsed configuration memory", 5, 0.5))
			.hits;
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
		expect((await store.searchConcepts(query, 5, 0.6)).hits).not.toEqual([]);

		await store.indexConcepts([shortened]);

		expect((await store.searchConcepts(query, 5, 0.6)).hits).toEqual([]);
	});
});

describeStore("bringing one concept's index in line", () => {
	let store: PostgresStore;
	let embedded: string[][];

	beforeAll(async () => {
		const counting = new StubEmbedder();
		embedded = [];
		store = PostgresStore.connect(databaseUrl ?? "", {
			identity: () => counting.identity(),
			embed: (texts) => {
				embedded.push(texts);
				return counting.embed(texts);
			},
			embedQuery: (texts) => counting.embedQuery(texts),
		});
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
	});

	beforeEach(async () => {
		await store.truncate();
		embedded.length = 0;
	});

	test("the rest of the index survives a scoped pass", async () => {
		await store.indexConcepts([CACHING, BANNER]);

		// A one-section Concept, revised. The pass must reach inside its own
		// identity only: pruning by section position alone would take the
		// second section of every other Concept with it, and handing the
		// whole-bundle pass one Concept would empty the corpus outright.
		await store.indexConcept(
			concept(
				"standards/banner",
				"id-banner",
				"The banner is a muted green, and never competes with the primary action or its label.",
				"type: Standard\ntitle: Banner colour",
			),
		);

		const survives = async (query: string) =>
			(await store.searchConcepts(query, 5, 0.6)).hits.map(
				(hit) => hit.conceptId,
			);
		expect(await survives("parsed configuration memory")).toEqual([
			"decisions/caching",
		]);
		expect(await survives("rolling restarts drain connections")).toEqual([
			"decisions/caching",
		]);
	});

	test("a scoped pass embeds the sections that moved and nothing else", async () => {
		await store.indexConcepts([CACHING, BANNER]);
		embedded.length = 0;

		const { embedded: count } = await store.indexConcept(
			concept(
				"decisions/caching",
				"id-caching",
				"## Decision\n\nWe keep parsed configuration in memory rather than re-reading it.\n\n" +
					"## Deployment\n\nRolling restarts drain connections, then stop the node.",
				"type: Decision\ntitle: Caching parsed configuration",
			),
		);

		// One section changed. The Concept's untouched section, and every
		// section of every other Concept, keep the vectors they had.
		expect(count).toBe(1);
		expect(embedded.flat()).toHaveLength(1);
		expect(embedded.flat()[0]).toContain("stop the node");
	});

	test("a revision is findable by what it says and not by what it removed", async () => {
		await store.indexConcepts([CACHING]);

		await store.indexConcept(
			concept(
				"decisions/caching",
				"id-caching",
				"## Decision\n\nWe read configuration from disk on every request.",
				"type: Decision\ntitle: Caching parsed configuration",
			),
		);

		expect(
			(await store.searchConcepts("configuration read from disk", 5, 0.6)).hits,
		).not.toEqual([]);
		expect(
			(await store.searchConcepts("rolling restarts drain connections", 5, 0.6))
				.hits,
		).toEqual([]);
	});

	test("a concept revised into unreadability leaves retrieval", async () => {
		await store.indexConcepts([CACHING, BANNER]);

		await store.indexConcept(
			parseConcept("decisions/caching", "no frontmatter at all\n", AT),
		);

		expect(
			(await store.searchConcepts("parsed configuration memory", 5, 0.6)).hits,
		).toEqual([]);
		// And the corpus around it is untouched.
		expect(
			(await store.searchConcepts("muted green banner", 5, 0.6)).hits,
		).not.toEqual([]);
	});

	test("what a concept declares it is not is carried by its hits", async () => {
		await store.indexConcept(
			concept(
				"metrics/gross-margin",
				"id-margin",
				"## Definition\n\nRevenue less full cost of goods sold.",
				"type: Metric\ntitle: Gross margin\nnot:\n  - term: revenue minus product cost only\n    why: that is the pre-FY2026 definition",
			),
		);

		const [hit] = (await store.searchConcepts("revenue less full cost", 5, 0.6))
			.hits;

		expect(hit?.exclusions?.[0]?.term).toBe("revenue minus product cost only");
		expect(hit?.sectionIndex).toBe(0);
		expect(hit?.sectionCount).toBe(1);
	});

	test("a hit from a many-part concept says which part it is", async () => {
		await store.indexConcepts([CACHING]);

		const [hit] = (
			await store.searchConcepts("rolling restarts drain connections", 5, 0.6)
		).hits;

		// Two sections; the second matched. A pack heads a fragment with
		// this, so "part 2 of 2" has to come from the index.
		expect(hit?.sectionIndex).toBe(1);
		expect(hit?.sectionCount).toBe(2);
	});

	test("a concept written now is retrievable now", async () => {
		const root = await mkdtemp(join(tmpdir(), "cm-written-"));
		const bundle = new DocStore(root);
		await store.indexConcepts([BANNER]);

		const { written } = await bundle.write({
			id: "decisions/elision",
			mode: "create",
			type: "Decision",
			title: "Elision",
			summary: "What replaces the middle of a payload too large to carry whole.",
			body: "## Decision\n\nThe head and the tail survive with a marker naming what went.",
		});
		await store.indexConcept(written ?? BANNER);

		// Nothing restarted, no whole-bundle pass: the Conversation that
		// wrote it can retrieve it.
		const found = (
			await store.searchConcepts("head and tail survive with a marker", 5, 0.6)
		).hits;
		expect(found.map((hit) => hit.conceptId)).toContain("decisions/elision");
	});
});

describeStore("a concept vector and the model that made it", () => {
	let store: PostgresStore;
	let swapped: PostgresStore;

	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		// Same width, different model: the case a width check cannot catch.
		swapped = PostgresStore.connect(
			databaseUrl ?? "",
			new StubEmbedder(PINNED_DIMENSIONS, "stub-two"),
		);
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
		await swapped?.close();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	test("a vector from another model is never a hit", async () => {
		await store.indexConcepts([CACHING, BANNER]);

		const query = "parsed configuration memory";
		expect(
			(await store.searchConcepts(query, 5, 0.6)).hits.map((hit) => hit.conceptId),
		).toEqual(["decisions/caching"]);
		const underSwap = await swapped.searchConcepts(query, 5, 0.6);

		// The stub is deterministic, so this is the same query against the
		// same rows: what changes is who made the vectors they hold.
		expect(underSwap.hits).toEqual([]);
		// Not refused for distance — never searched at all, and said so.
		expect(underSwap.misses).toEqual([]);
		expect(underSwap.rejected).toBe(0);
		expect(underSwap.unsearched).toBe(2);
	});

	test("a model change is repaired by the next pass, text or no text change", async () => {
		await store.indexConcepts([CACHING, BANNER]);

		const { embedded } = await swapped.indexConcepts([CACHING, BANNER]);

		// Every section, though not one word of the bundle moved.
		expect(embedded).toBe(3);
		const found = await swapped.searchConcepts("parsed configuration memory", 5, 0.6);
		expect(found.hits.map((hit) => hit.conceptId)).toEqual(["decisions/caching"]);
		expect(found.unsearched).toBe(0);
	});

	test("the scoped pass repairs one concept the same way", async () => {
		await store.indexConcepts([CACHING, BANNER]);

		const { embedded } = await swapped.indexConcept(CACHING);

		expect(embedded).toBe(2);
		// The Concept it was not given keeps the vectors it had, so it is
		// still unsearchable under the new model rather than silently ranked.
		expect((await swapped.searchConcepts("muted green banner", 5, 0.6)).hits).toEqual(
			[],
		);
		expect(
			(await swapped.searchConcepts("parsed configuration memory", 5, 0.6)).hits,
		).not.toEqual([]);
	});

	test("a concept part-way through a repair counts as seen, not as unseen", async () => {
		await store.indexConcepts([CACHING]);
		// One section still held by the previous model, as a background
		// pass writing section by section leaves it.
		await store["sql"]`
			UPDATE concept_sections SET embedding_model = 'stub-two'
			WHERE section_index = 1`;

		const found = await store.searchConcepts("parsed configuration memory", 5, 0.6);

		// The search can rank this Concept, so reporting it as one the
		// search could not see would contradict the hit beside it.
		expect(found.hits.map((hit) => hit.conceptId)).toEqual(["decisions/caching"]);
		expect(found.unsearched).toBe(0);
	});

	test("a section indexed before provenance existed is re-embedded", async () => {
		await store.indexConcepts([CACHING]);
		// A row as an earlier version wrote it: a vector with no model.
		await store["sql"]`UPDATE concept_sections SET embedding_model = NULL`;

		expect((await store.searchConcepts("parsed configuration memory", 5, 0.6)).hits)
			.toEqual([]);
		expect((await store.indexConcepts([CACHING])).embedded).toBe(2);
		expect(
			(await store.searchConcepts("parsed configuration memory", 5, 0.6)).hits,
		).not.toEqual([]);
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
				 text, embedding, embedding_model)
			VALUES (
				${`id-${index}`}, 0, ${row.conceptId}, 'stable', 'unverified',
				${row.stale}, ${`hash-${index}`}, ${`text for ${row.conceptId}`},
				${JSON.stringify(vector)}::vector, 'stub'
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

		const found = (
			await store.searchConcepts(
				"We keep parsed configuration in memory rather than re-reading it.",
				5,
				2,
			)
		).hits;

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

		const found = (await store.searchConcepts(BODY, 5, 2)).hits;

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

		const found = (await store.searchConcepts(BODY, 5, 2)).hits;

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

		const found = (
			await store.searchConcepts(`Retries\n\n${LONG} Jitter is uniform.`, 5, 2)
		).hits;

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

		const found = (await store.searchConcepts(BODY, 5, 2)).hits;

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

		const found = (await store.searchConcepts(PROBE, 3, 2)).hits;

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

		const found = (await store.searchConcepts(PROBE, 2, 2)).hits;

		expect(found.map((hit) => hit.conceptId)).toEqual([
			"decisions/current",
			"decisions/stale-best",
		]);
	});

	test("nothing relevant returns nothing", async () => {
		await store.indexConcepts([CACHING]);

		expect((await store.searchConcepts("parsed configuration", 5, 0.01)).hits).toEqual(
			[],
		);
	});

	test("an unindexed bundle returns nothing rather than raising", async () => {
		expect((await store.searchConcepts("anything at all", 5, 2)).hits).toEqual([]);
	});
});

describeStore("what the concept index refused", () => {
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

	test("a hit carries the distance it was found at", async () => {
		await place(sql, [{ conceptId: "decisions/near", distance: 0.2, stale: false }]);

		const { hits } = await store.searchConcepts(PROBE, 2, 0.5);

		expect(hits[0]?.distance).toBeCloseTo(0.2, 3);
	});

	test("a tight threshold returns no hits, a count, and the near misses", async () => {
		await place(sql, [
			{ conceptId: "decisions/far", distance: 0.6, stale: false },
			{ conceptId: "decisions/nearer", distance: 0.45, stale: false },
		]);

		const { hits, rejected, misses } = await store.searchConcepts(PROBE, 2, 0.3);

		expect(hits).toEqual([]);
		expect(rejected).toBe(2);
		// Nearest first, so the one to loosen the threshold for leads.
		expect(misses.map((miss) => miss.conceptId)).toEqual([
			"decisions/nearer",
			"decisions/far",
		]);
		expect(misses[0]?.distance).toBeCloseTo(0.45, 3);
	});

	test("a concept that was carried is not also reported as refused", async () => {
		await place(sql, [
			{ conceptId: "decisions/near", distance: 0.2, stale: false },
			{ conceptId: "decisions/far", distance: 0.6, stale: false },
		]);

		const { hits, misses } = await store.searchConcepts(PROBE, 2, 0.5);

		expect(hits.map((hit) => hit.conceptId)).toEqual(["decisions/near"]);
		expect(misses.map((miss) => miss.conceptId)).toEqual(["decisions/far"]);
	});

	test("a deprecated concept is not reported as a near miss", async () => {
		const superseded = concept(
			"decisions/old-caching",
			"id-old",
			"We keep parsed configuration in memory rather than re-reading it.",
			"type: Decision\ntitle: Caching\nstatus: deprecated",
		);
		await store.indexConcepts([superseded]);

		// Lifecycle withheld it, not distance: reporting it as refused
		// would invite loosening a threshold that never kept it out.
		const { rejected, misses } = await store.searchConcepts(
			"We keep parsed configuration in memory rather than re-reading it.",
			5,
			0.01,
		);

		expect(rejected).toBe(0);
		expect(misses).toEqual([]);
	});

	test("the refused come from the candidate window, not the whole bundle", async () => {
		// Thirty sections, a candidate window of ten: the near misses are
		// what the one nearest-neighbour query already looked at, so the
		// furthest are not reported at all.
		await place(
			sql,
			Array.from({ length: 30 }, (_, index) => ({
				conceptId: `decisions/c${index}`,
				distance: 0.3 + index * 0.01,
				stale: false,
			})),
		);

		const { misses } = await store.searchConcepts(PROBE, 1, 0.1);

		expect(misses).toHaveLength(10);
		expect(misses.map((miss) => miss.conceptId)).not.toContain("decisions/c29");
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
			const embedder = new LocalEmbedder(process.env.PICHART_BUN ?? "bun");
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
				const found = (
					await store.searchConcepts(
						"how is the payments table partitioned across servers",
						2,
						0.5,
					)
				).hits;

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

	test(
		"the concept that states its subject beats the one that leaves it implicit",
		async () => {
			const embedder = new LocalEmbedder(process.env.PICHART_BUN ?? "bun");
			const store = PostgresStore.connect(databaseUrl ?? "", embedder);
			const body =
				"## Decision\n\n`retain_days` defaults to 90. The sweep runs " +
				"`DELETE FROM turns WHERE ingested_at < now() - $1`, then `VACUUM`.";
			try {
				await store.migrate();
				await store.truncate();
				// The same body twice. One Concept says what it is about; the
				// other leaves it to the reader. Nothing else differs, so the
				// ordering between them is the summary and nothing else — and
				// alphabetically the summarised one loses, so a tie would put
				// it second.
				await store.indexConcepts([
					concept(
						"decisions/a-implicit",
						"id-implicit",
						body,
						"type: Decision\ntitle: Retention",
					),
					concept(
						"decisions/b-stated",
						"id-stated",
						body,
						"type: Decision\ntitle: Retention\ndescription: How long the " +
							"record of what happened is kept, and what is thrown away first.",
					),
				]);

				// A paraphrase of the subject using none of the body's
				// wording: not "retain_days", "sweep", "turns" or "vacuum".
				const found = (
					await store.searchConcepts(
						"what do we throw away first when the past piles up",
						2,
						0.5,
					)
				).hits;

				expect(found[0]?.conceptId).toBe("decisions/b-stated");
				expect(found[0]?.distance).toBeLessThan(found[1]?.distance ?? 1);
			} finally {
				await store.close();
				await embedder.close();
			}
		},
		300_000,
	);

	test(
		"the part of a concept a query is about is the part retrieved",
		async () => {
			const embedder = new LocalEmbedder(process.env.PICHART_BUN ?? "bun");
			const store = PostgresStore.connect(databaseUrl ?? "", embedder);
			try {
				await store.migrate();
				await store.truncate();
				await store.indexConcepts([
					concept(
						"decisions/retention",
						"id-retention",
						"## Decision\n\nRows are removed once their age passes the " +
							"configured limit, and their accounting is kept.\n\n" +
							"## Operation\n\nThe sweep runs at shutdown, never on the " +
							"path a model waits on.",
						"type: Decision\ntitle: Retention\n" +
							"description: How long the record of what happened is kept, and what is thrown away first.",
					),
				]);

				// One summary repeated across sections draws them together;
				// what must survive is that the section's own text still
				// decides which part comes back.
				const [hit] = (
					await store.searchConcepts("when does the sweep run", 2, 0.6)
				).hits;

				expect(hit?.sectionIndex).toBe(1);
				expect(hit?.sectionCount).toBe(2);
			} finally {
				await store.close();
				await embedder.close();
			}
		},
		300_000,
	);
});

describeStore("a candidate set nothing can reorder", () => {
	let store: PostgresStore;
	let sql: SQL;

	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
		sql = new SQL(databaseUrl ?? "");
	});

	afterAll(async () => {
		await store?.close();
		await sql?.end();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	/**
	 * More Concepts than the candidate set admits, all saying the same
	 * thing: the candidate window then cuts through a run of ties, which is
	 * where an approximate index decides for itself unless something else
	 * does.
	 */
	const TIED = Array.from({ length: 60 }, (_, index) =>
		concept(
			`decisions/tied-${String(index).padStart(2, "0")}`,
			`id-tied-${String(index).padStart(2, "0")}`,
			"## Decision\n\nWe keep parsed configuration in memory rather than re-reading it.",
			"type: Decision\ntitle: Caching parsed configuration",
		),
	);

	test("the same query selects the same concepts, twice and after a rebuild", async () => {
		await store.indexConcepts(TIED);

		const first = (await store.searchConcepts("caching parsed configuration", 4, 2))
			.hits;
		const again = (await store.searchConcepts("caching parsed configuration", 4, 2))
			.hits;
		// The index is discarded and rebuilt from unchanged Concepts, which
		// is what reshuffles an approximate graph.
		await sql`REINDEX INDEX concept_sections_embedding_idx`;
		const rebuilt = (await store.searchConcepts("caching parsed configuration", 4, 2))
			.hits;

		const ids = (hits: { conceptId: string }[]) => hits.map((hit) => hit.conceptId);
		expect(ids(first)).toHaveLength(4);
		expect(ids(again)).toEqual(ids(first));
		expect(ids(rebuilt)).toEqual(ids(first));
	});
});
