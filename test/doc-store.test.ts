import { describe, expect, test } from "bun:test";
import {
	chmod,
	cp,
	mkdtemp,
	readdir,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IDENTITY_KEY } from "../src/concept.ts";
import { DocStore, readBundle } from "../src/doc-store.ts";

const BUNDLE = new URL("./fixtures/bundle", import.meta.url).pathname;
/** The vendored reference bundle, whose levels carry their own listings. */
const VENDORED = new URL("./fixtures/okf-acme-retail", import.meta.url).pathname;
const AT = new Date("2026-09-16T00:00:00Z");

/** Whether a path is there at all, for asserting nothing was written. */
async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function store(path = BUNDLE): DocStore {
	return new DocStore(path, { now: () => AT });
}

/** The identity path writes, so those tests work on a copy. */
async function writableBundle(): Promise<string> {
	const { bundle } = await writableBundleIn();
	return bundle;
}

/**
 * A copy of the fixture bundle one level inside a directory this test owns,
 * so a write that escapes the bundle lands somewhere the test can check and
 * nothing else shares. Asserting against the system temp directory made one
 * escaped write poison the assertion for every later run.
 */
async function writableBundleIn(): Promise<{ outside: string; bundle: string }> {
	const outside = await mkdtemp(join(tmpdir(), "cm-bundle-"));
	const bundle = join(outside, "bundle");
	await cp(BUNDLE, bundle, { recursive: true });
	return { outside, bundle };
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

describe("a listing reconciled against the level", () => {
	test("a concept the listing omits is still listed, marked", async () => {
		const directory = await writableBundle();
		await writeFile(
			join(directory, "standards/unlisted.md"),
			"---\ntype: Standard\ntitle: Unlisted\ndescription: Never named.\n---\n\n# Definition\n\nA concept no listing names.\n",
		);

		const level = await store(directory).list("standards");

		// The author's two entries first, in their order; the file nothing
		// names after them, said to be absent from the listing rather than
		// hidden by it.
		expect(level?.concepts.map((entry) => entry.id)).toEqual([
			"standards/testing",
			"standards/naming",
			"standards/unlisted",
		]);
		expect(level?.concepts[0]?.description).toBe("when a test earns its place");
		expect(level?.concepts[0]?.unlisted).toBeUndefined();
		expect(level?.concepts[2]?.unlisted).toBe(true);
	});

	test("a listing entry with nothing behind it is not invented", async () => {
		const directory = await writableBundle();
		await writeFile(
			join(directory, "standards/index.md"),
			"# Standards\n\n- [testing](/standards/testing.md): when a test earns its place\n- [gone](/standards/gone.md): deleted last year\n",
		);

		const level = await store(directory).list("standards");

		expect(level?.concepts.map((entry) => entry.id)).toEqual([
			"standards/testing",
			"standards/naming",
		]);
	});

	test("a level whose concept cannot be read still lists the rest", async () => {
		const level = await store().list("decisions");

		const broken = level?.concepts.find((entry) => entry.id === "decisions/broken");
		expect(level?.concepts).toHaveLength(4);
		expect(broken?.problem).toBeTruthy();
		expect(
			level?.concepts.find((entry) => entry.id === "decisions/minimal")?.problem,
		).toBeUndefined();
	});
});

describe("authoring a concept", () => {
	const draft = {
		id: "standards/elision",
		mode: "create" as const,
		type: "Standard",
		title: "Elision",
		summary: "What replaces the middle of a payload too large to carry whole.",
		body: "# Definition\n\nThe head and the tail survive with a marker naming what went.",
	};

	test("writes a readable concept with an identity and no leftovers", async () => {
		const directory = await writableBundle();

		const { written } = await store(directory).write(draft);

		expect(written?.conformant).toBe(true);
		expect(written?.identity).toBeTruthy();
		// Read back through the store, not from the return value: nothing
		// further may be required to make an authored Concept readable.
		const reopened = await store(directory).open("standards/elision");
		expect(reopened?.title).toBe("Elision");
		expect(reopened?.description).toBe(draft.summary);
		const left = await readdir(join(directory, "standards"));
		expect(left.some((name) => name.endsWith(".tmp"))).toBe(false);
	});

	test("creating over a concept that exists is refused, and changes nothing", async () => {
		const directory = await writableBundle();
		const before = await readFile(join(directory, "standards/testing.md"), "utf8");

		const outcome = await store(directory).write({ ...draft, id: "standards/testing" });

		expect(outcome.refused).toContain("already exists");
		expect(await readFile(join(directory, "standards/testing.md"), "utf8")).toBe(before);
	});

	test("revising a concept the bundle does not hold is refused", async () => {
		const directory = await writableBundle();

		const outcome = await store(directory).write({ ...draft, mode: "revise" });

		expect(outcome.refused).toContain("does not exist");
		expect(await store(directory).open("standards/elision")).toBeUndefined();
	});

	test("a body-only revision keeps everything it did not name", async () => {
		const directory = await writableBundle();
		await cp(join(VENDORED, "metrics/gross-margin.md"), join(directory, "standards/margin.md"));

		await store(directory).write({
			id: "standards/margin",
			mode: "revise",
			body: "# Definition\n\nRevenue minus full COGS, restated.",
		});

		const after = await store(directory).open("standards/margin");
		expect(after?.title).toBe("Gross Margin");
		expect(after?.description).toContain("Cost Allocation Standard");
		expect(after?.exclusions[0]?.term).toBe("revenue minus product cost only");
		expect(after?.sources).toHaveLength(2);
		expect(after?.body).toContain("restated");
	});

	test("a revision is a draft, and a deprecated concept stays deprecated", async () => {
		const directory = await writableBundle();
		await writeFile(
			join(directory, "standards/retired.md"),
			"---\ntype: Standard\ntitle: Retired\nstatus: deprecated\n---\n\n# Definition\n\nSuperseded.\n",
		);

		await store(directory).write({
			id: "standards/testing",
			mode: "revise",
			body: "# Definition\n\nA test earns its place when a plausible bug fails it.",
		});
		await store(directory).write({
			id: "standards/retired",
			mode: "revise",
			body: "# Definition\n\nStill superseded, more precisely.",
		});

		// The text is no longer the text a human reviewed, so the lifecycle
		// says draft — but a revision corrects what a superseded Concept
		// says, it does not put it back in service.
		expect((await store(directory).open("standards/testing"))?.status).toBe(
			"draft",
		);
		expect((await store(directory).open("standards/retired"))?.status).toBe(
			"deprecated",
		);
	});

	test("a revision keeps the author's own formatting and comments", async () => {
		const directory = await writableBundle();
		await writeFile(
			join(directory, "standards/styled.md"),
			"---\ntype: Standard # the kind\ntitle: Styled\ntags: [a, b]\n---\n\n# Definition\n\nOriginal.\n",
		);

		await store(directory).write({
			id: "standards/styled",
			mode: "revise",
			body: "# Definition\n\nRevised.",
		});

		// The bundle is the user's curated prose: a revision that silently
		// reformatted it would show up as a diff nobody asked for.
		const after = await readFile(join(directory, "standards/styled.md"), "utf8");
		expect(after).toContain("# the kind");
		expect(after).toContain("tags: [");
		expect(after).toContain("Revised.");
	});


	test("an identifier that leaves the bundle is refused", async () => {
		const { outside, bundle } = await writableBundleIn();

		const outcome = await store(bundle).write({ ...draft, id: "../escaped" });

		expect(outcome.refused).toContain("outside");
		// Checked one level up, inside what this test owns: a documentation
		// tool is not a file writer.
		expect(await exists(join(outside, "escaped.md"))).toBe(false);
		expect(await readdir(outside)).toEqual(["bundle"]);
	});

	test("a write that cannot complete leaves the concept as it was", async () => {
		const directory = await writableBundle();
		const path = join(directory, "standards/testing.md");
		const before = await readFile(path, "utf8");
		await chmod(join(directory, "standards"), 0o555);

		const outcome = await store(directory).write({
			id: "standards/testing",
			mode: "revise",
			body: "# Definition\n\nHalf a concept.",
		});

		await chmod(join(directory, "standards"), 0o755);
		expect(outcome.refused).toBeTruthy();
		expect(await readFile(path, "utf8")).toBe(before);
	});

	test("authoring into a curated level adds the entry to its listing", async () => {
		const directory = await writableBundle();

		await store(directory).write(draft);

		const listing = await readFile(join(directory, "standards/index.md"), "utf8");
		expect(listing).toContain("elision.md");
		// Appended, not interleaved: the author's order survives.
		expect(listing.indexOf("testing.md")).toBeLessThan(listing.indexOf("elision.md"));
		const level = await store(directory).list("standards");
		expect(level?.concepts.at(-1)?.id).toBe("standards/elision");
		expect(level?.concepts.at(-1)?.unlisted).toBeUndefined();
	});
});

describe("what an agent may not write", () => {
	test("asking for human verification is refused, and nothing is written", async () => {
		const directory = await writableBundle();

		const outcome = await store(directory).write({
			id: "standards/self-signed",
			mode: "create",
			type: "Standard",
			title: "Self-signed",
			body: "# Definition\n\nReviewed by me.",
			verified: [{ by: "human:zero", at: "2026-09-24T00:00:00Z" }],
		});

		expect(outcome.refused).toContain("verification");
		expect(await store(directory).open("standards/self-signed")).toBeUndefined();
	});

	test("an authored concept says a machine wrote it, and enters as a draft", async () => {
		const directory = await writableBundle();

		const { written } = await store(directory).write({
			id: "standards/elision",
			mode: "create",
			type: "Standard",
			title: "Elision",
			body: "# Definition\n\nThe head and the tail survive with a marker.",
		});

		expect(written?.generated?.by).toContain("pi-chart@");
		expect(written?.generated?.at).toBe(AT.toISOString());
		expect(written?.status).toBe("draft");
		expect(written?.trust).toBe("unverified");
	});

	test("revising beneath a human review stops the review counting", async () => {
		const directory = await writableBundle();
		const before = await store(directory).open("standards/testing");
		expect(before?.trust).toBe("human-reviewed");

		await store(directory).write({
			id: "standards/testing",
			mode: "revise",
			body: "# Definition\n\nA test earns its place when the agent says so.",
		});

		const after = await store(directory).open("standards/testing");
		// Demoted, not stripped: the signature stays for whoever re-reviews.
		expect(after?.trust).toBe("unverified");
		expect(
			await readFile(join(directory, "standards/testing.md"), "utf8"),
		).toContain("human:zero");
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
