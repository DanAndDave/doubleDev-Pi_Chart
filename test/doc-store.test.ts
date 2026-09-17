import { describe, expect, test } from "bun:test";
import { chmod, cp, mkdtemp, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IDENTITY_KEY } from "../src/concept.ts";
import { DocStore, readBundle } from "../src/doc-store.ts";

const BUNDLE = new URL("./fixtures/bundle", import.meta.url).pathname;
/** The vendored reference bundle, whose levels carry their own listings. */
const VENDORED = new URL("./fixtures/okf-acme-retail", import.meta.url).pathname;
const AT = new Date("2026-09-16T00:00:00Z");

function store(path = BUNDLE): DocStore {
	return new DocStore(path, { now: () => AT });
}

/** The identity path writes, so those tests work on a copy. */
async function writableBundle(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "cm-bundle-"));
	await cp(BUNDLE, directory, { recursive: true });
	return directory;
}

describe("reading a bundle", () => {
	test("lists every concept, addressed by path without the extension", async () => {
		const concepts = await store().concepts();

		expect(concepts.map((concept) => concept.id).sort()).toEqual([
			"decisions/broken",
			"decisions/extended",
			"decisions/minimal",
			"decisions/untyped",
			"standards/naming",
			"standards/testing",
		]);
	});

	test("reserved files are not concepts", async () => {
		const concepts = await store().concepts();

		const ids = concepts.map((concept) => concept.id);
		expect(ids).not.toContain("index");
		expect(ids).not.toContain("log");
		expect(ids).not.toContain("standards/index");
	});

	test("a malformed concept is named and the rest still read", async () => {
		const concepts = await store().concepts();

		const broken = concepts.find((concept) => concept.id === "decisions/broken");
		expect(broken?.conformant).toBe(false);
		expect(broken?.problem).toBeTruthy();
		expect(concepts.filter((concept) => concept.conformant)).toHaveLength(4);
	});

	test("trust and freshness come back with each concept", async () => {
		const concepts = await store().concepts();
		const testing = concepts.find((c) => c.id === "standards/testing");
		const naming = concepts.find((c) => c.id === "standards/naming");

		expect(testing?.trust).toBe("human-reviewed");
		expect(testing?.stale).toBe(false);
		expect(naming?.trust).toBe("machine-confirmed");
		expect(naming?.stale).toBe(true);
	});

	test("a bundle that does not exist yields no concepts and no error", async () => {
		expect(await store("/nonexistent/bundle").concepts()).toEqual([]);
	});

	test("a bundle that exists but holds no concepts is empty, not an error", async () => {
		const directory = await mkdtemp(join(tmpdir(), "cm-empty-bundle-"));

		expect(await new DocStore(directory, { now: () => AT }).concepts()).toEqual([]);
	});

	test("a concept that cannot be read is reported, not dropped", async () => {
		const directory = await writableBundle();
		// Present to the scan, unreadable when opened — distinct from missing.
		await chmod(join(directory, "decisions/minimal.md"), 0o000);

		const concepts = await new DocStore(directory, { now: () => AT }).concepts();

		const unreadable = concepts.find((c) => c.id === "decisions/minimal");
		expect(unreadable?.conformant).toBe(false);
		expect(unreadable?.problem).toBeTruthy();
	});

	test("provenance is read when the concept records it", async () => {
		const concepts = await store().concepts();

		const testing = concepts.find((c) => c.id === "standards/testing");
		expect(testing?.generated?.by).toBe("reference_agent/gemini-2.5-pro");
	});
});

describe("walking a level", () => {
	test("lists the concepts and sub-levels directly beneath it", async () => {
		const level = await store().list("");

		expect(level?.levels).toEqual(["decisions", "empty-level", "standards"]);
		expect(level?.concepts).toEqual([]);
	});

	test("a curated listing supplies the order and wording its author chose", async () => {
		// standards/index.md lists testing before naming; the filesystem is the
		// other way round, so an alphabetical result would mean it was ignored.
		const level = await store().list("standards");

		expect(level?.curated).toBe(true);
		expect(level?.concepts.map((entry) => entry.id)).toEqual([
			"standards/testing",
			"standards/naming",
		]);
		expect(level?.concepts[0]?.description).toBe("when a test earns its place");
	});

	test("a level with no listing file of its own is synthesised", async () => {
		// decisions/ has no index.md in the fixture bundle.
		const level = await store().list("decisions");

		expect(level?.curated).toBe(false);
		expect(level?.concepts.map((entry) => entry.id).sort()).toEqual([
			"decisions/broken",
			"decisions/extended",
			"decisions/minimal",
			"decisions/untyped",
		]);
	});

	test("a synthesised listing carries each concept's own description", async () => {
		const level = await store().list("decisions");

		expect(
			level?.concepts.find((entry) => entry.id === "decisions/extended")?.description,
		).toBe("Carries keys the reader has no meaning for.");
	});

	test("a sub-level holding no concepts of its own is still walkable", async () => {
		const level = await store().list("");

		// empty-level/ contains only a listing file; progressive disclosure
		// must not dead-end there.
		expect(level?.levels).toContain("empty-level");
	});

	test("listing a level does not read concepts deeper in the tree", async () => {
		const opened: string[] = [];
		const watched = new DocStore(BUNDLE, { now: () => AT, onRead: (path: string) => opened.push(path) });

		await watched.list("");

		expect(opened.some((path) => path.includes("standards/testing.md"))).toBe(false);
	});
});

describe("concept identity", () => {
	test("a concept with no identity is given one, persisted to the file", async () => {
		const directory = await writableBundle();

		const [concept] = await new DocStore(directory, { now: () => AT }).ensureIdentities();

		expect(concept?.identity).toBeTruthy();
		const onDisk = await readFile(join(directory, "decisions/extended.md"), "utf8");
		expect(onDisk).toContain(IDENTITY_KEY);
	});

	test("assigning identity leaves the rest of the frontmatter alone", async () => {
		const directory = await writableBundle();

		await new DocStore(directory, { now: () => AT }).ensureIdentities();

		const reread = await new DocStore(directory, { now: () => AT }).concepts();
		const extended = reread.find((c) => c.id === "decisions/extended");
		expect(extended?.type).toBe("Some Type Nobody Has Seen");
		expect(extended?.frontmatter.house_rule).toBe("keep it boring");
		expect(extended?.conformant).toBe(true);
	});

	test("identity is assigned once, not rewritten on every read", async () => {
		const directory = await writableBundle();
		const docs = new DocStore(directory, { now: () => AT });
		await docs.ensureIdentities();
		const first = (await docs.concepts()).find((c) => c.id === "standards/testing");

		await docs.ensureIdentities();

		const second = (await docs.concepts()).find((c) => c.id === "standards/testing");
		expect(second?.identity).toBe(first?.identity ?? "");
	});

	test("a moved concept is still the same concept, at a new path", async () => {
		const directory = await writableBundle();
		const docs = new DocStore(directory, { now: () => AT });
		await docs.ensureIdentities();
		const before = (await docs.concepts()).find((c) => c.id === "standards/testing");

		await rename(
			join(directory, "standards/testing.md"),
			join(directory, "decisions/testing.md"),
		);

		// Resolved through the store's own lookup, not by the test joining on
		// identity itself, so a caller can genuinely follow a moved Concept.
		const after = await docs.byIdentity(before?.identity ?? "");
		expect(after).toBeTruthy();
		expect(after?.id).toBe("decisions/testing");
		expect(after?.id).not.toBe(before?.id);
	});
});

describe("a level's own listing", () => {
	test("is used below the root, in the author's order", async () => {
		// Written `[Revenue](revenue.md)`, not `metrics/revenue.md`: a
		// listing links to its neighbours the way an author writes them.
		const level = await store(VENDORED).list("metrics");

		expect(level?.curated).toBe(true);
		expect(level?.concepts.map((entry) => entry.id)).toEqual([
			"metrics/revenue",
			"metrics/gross-margin",
			"metrics/gross-margin-legacy",
		]);
	});

	test("carries the author's descriptions, not the concepts' own", async () => {
		const level = await store(VENDORED).list("policies");

		expect(level?.curated).toBe(true);
		expect(level?.concepts[0]?.description).toBeTruthy();
	});
});

describe("reading a bundle for indexing", () => {
	test("a path that does not exist is nothing to index, not an error", async () => {
		// Distinct from an empty list: indexing an empty corpus prunes every
		// Concept the index holds, so a mistyped path must not look like a
		// bundle whose Concepts were all deleted.
		expect(await readBundle("/nonexistent/cm-bundle")).toBeUndefined();
	});

	test("a bundle that is there yields its concepts, with identities", async () => {
		const directory = await writableBundle();

		const concepts = await readBundle(directory);

		expect(concepts?.length).toBeGreaterThan(0);
		expect(
			concepts?.every((concept) => !concept.conformant || concept.identity),
		).toBe(true);
	});
});
