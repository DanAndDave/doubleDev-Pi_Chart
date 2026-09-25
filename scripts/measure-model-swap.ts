/**
 * Measures what changing the embedding model does to curated knowledge:
 * what a search returns while the Concept index still holds the previous
 * model's vectors, what it would return if those vectors were ranked
 * anyway, and what the next indexing pass costs to repair them.
 *
 * Two real models of the same width — `Xenova/bge-small-en-v1.5` (pinned)
 * and `Xenova/all-MiniLM-L6-v2`, both 384 dimensions — because a width
 * check cannot tell them apart and a swap between them is the case that
 * used to go unnoticed. The corpus is the vendored `okf-acme-retail`
 * bundle, searched with one question its Concepts answer.
 *
 * The "ranked anyway" line is this script's own statement, not the Store's:
 * it is what `searchConcepts` did before it recorded provenance, kept here
 * so the figure that motivated the change stays reproducible.
 *
 * Needs a Postgres with pgvector, and truncates the Concept index it points
 * at, so point it at a scratch database rather than one holding anything:
 *
 *     PICHART_BUN=$(which bun) PICHART_DATABASE_URL=postgresql://... \
 *         bun scripts/measure-model-swap.ts
 */
import { SQL } from "bun";

import { readBundle } from "../src/doc-store.ts";
import { LocalEmbedder, PINNED_MODEL } from "../src/embedder.ts";
import { PostgresStore } from "../src/postgres-store.ts";

const OTHER_MODEL = "Xenova/all-MiniLM-L6-v2";
const BUNDLE = new URL("../test/fixtures/okf-acme-retail", import.meta.url)
	.pathname;
const QUERY = "how is gross margin calculated for a period";
const LIMIT = 5;
const MAX_DISTANCE = 0.6;

const url = process.env.PICHART_DATABASE_URL;
if (!url) throw new Error("set PICHART_DATABASE_URL to a scratch database");

/**
 * One model in one process: the embedder's worker reads `PICHART_EMBED_MODEL`
 * when it loads, which is also how an operator changes it.
 */
async function withModel<T>(
	model: string,
	work: (store: PostgresStore, embedder: LocalEmbedder) => Promise<T>,
): Promise<T> {
	if (process.env.PICHART_EMBED_MODEL !== model) {
		const child = Bun.spawn(
			[process.execPath, import.meta.path, ...process.argv.slice(2)],
			{ env: { ...process.env, PICHART_EMBED_MODEL: model }, stdio: ["inherit", "inherit", "inherit"] },
		);
		process.exit(await child.exited);
	}
	const embedder = new LocalEmbedder(process.env.PICHART_BUN);
	const store = PostgresStore.connect(url ?? "", embedder);
	try {
		return await work(store, embedder);
	} finally {
		await store.close();
		await embedder.close();
	}
}

function report(label: string, found: Awaited<ReturnType<PostgresStore["searchConcepts"]>>): void {
	console.log(
		`${label}\n  ${found.hits.length} hits, ${found.rejected} rejected, ` +
			`${found.unsearched} unsearched`,
	);
	for (const hit of found.hits) {
		console.log(`    hit    ${hit.distance.toFixed(3)}  ${hit.conceptId}`);
	}
	for (const miss of found.misses.slice(0, 3)) {
		console.log(`    miss   ${miss.distance.toFixed(3)}  ${miss.conceptId}`);
	}
}

const stage = process.argv[2];

if (stage === undefined) {
	// Each stage is its own process because the model is chosen when the
	// embedder's worker loads, not when a search runs.
	for (const next of ["index", "swap", "back"]) {
		const child = Bun.spawn([process.execPath, import.meta.path, next], {
			env: process.env,
			stdio: ["inherit", "inherit", "inherit"],
		});
		const code = await child.exited;
		if (code !== 0) process.exit(code);
	}
} else if (stage === "index") {
	await withModel(PINNED_MODEL, async (store) => {
		await store.migrate();
		await store.truncate();
		const concepts = (await readBundle(BUNDLE)) ?? [];
		const started = Bun.nanoseconds();
		const { embedded } = await store.indexConcepts(concepts);
		const seconds = (Bun.nanoseconds() - started) / 1e9;
		console.log(
			`indexed ${concepts.length} concepts, ${embedded} sections under ` +
				`${PINNED_MODEL} in ${seconds.toFixed(1)}s`,
		);
		report(`\nthe pinned model searching its own vectors:`, await store.searchConcepts(QUERY, LIMIT, MAX_DISTANCE));
	});
} else if (stage === "swap") {
	await withModel(OTHER_MODEL, async (store, embedder) => {
		report(
			`\n${OTHER_MODEL} searching ${PINNED_MODEL}'s vectors:`,
			await store.searchConcepts(QUERY, LIMIT, MAX_DISTANCE),
		);

		// What the same query returned before provenance was recorded:
		// every vector ranked, whoever made it.
		const [vector] = await embedder.embed([QUERY]);
		const sql = new SQL(url ?? "");
		const ranked = (await sql`
			SELECT concept_id, min(embedding <=> ${JSON.stringify(vector)}::vector) AS distance
			FROM concept_sections
			WHERE embedding IS NOT NULL AND status <> 'deprecated'
			GROUP BY concept_id
			ORDER BY distance ASC`) as { concept_id: string; distance: number }[];
		await sql.close();
		const refused = ranked.filter((row) => row.distance > MAX_DISTANCE).length;
		console.log(
			`\n  ranked anyway, as the old code did: ` +
				`${ranked.length - refused} carried, ${refused} reported as too distant`,
		);
		for (const row of ranked.slice(0, LIMIT)) {
			console.log(
				`    ${row.distance.toFixed(3)}  ${row.concept_id}` +
					`  ${row.distance <= MAX_DISTANCE ? "(carried)" : "(too distant)"}`,
			);
		}

		const started = Bun.nanoseconds();
		const { embedded } = await store.indexConcepts((await readBundle(BUNDLE)) ?? []);
		const seconds = (Bun.nanoseconds() - started) / 1e9;
		console.log(`\nthe next indexing pass re-embedded ${embedded} sections in ${seconds.toFixed(1)}s`);
		report(`\n${OTHER_MODEL} searching its own vectors:`, await store.searchConcepts(QUERY, LIMIT, MAX_DISTANCE));
	});
} else if (stage === "back") {
	await withModel(PINNED_MODEL, async (store) => {
		const started = Bun.nanoseconds();
		const { embedded } = await store.indexConcepts((await readBundle(BUNDLE)) ?? []);
		const seconds = (Bun.nanoseconds() - started) / 1e9;
		console.log(`\nswapping back re-embedded ${embedded} sections in ${seconds.toFixed(1)}s`);
		report(`the pinned model again:`, await store.searchConcepts(QUERY, LIMIT, MAX_DISTANCE));
	});
} else {
	throw new Error(`unknown stage: ${stage}`);
}
