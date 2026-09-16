import { describe, expect, test } from "bun:test";

import { parseConcept } from "../src/concept.ts";

const AT = new Date("2026-09-16T00:00:00Z");

function conceptFile(frontmatter: string, body = "Body."): string {
	return `---\n${frontmatter}\n---\n\n${body}\n`;
}

describe("parseConcept", () => {
	test("separates frontmatter from body", () => {
		const concept = parseConcept(
			"standards/testing",
			conceptFile("type: Standard\ntitle: Testing", "# Definition\n\nText."),
			AT,
		);

		expect(concept.type).toBe("Standard");
		expect(concept.title).toBe("Testing");
		expect(concept.body.trim()).toBe("# Definition\n\nText.");
	});

	test("a concept carrying only a type is conformant", () => {
		const concept = parseConcept("decisions/minimal", conceptFile("type: Decision"), AT);

		expect(concept.conformant).toBe(true);
		expect(concept.problem).toBeUndefined();
	});

	test("frontmatter that does not parse is reported, not thrown", () => {
		const concept = parseConcept(
			"decisions/broken",
			conceptFile("type: Decision\ntags: [unclosed"),
			AT,
		);

		expect(concept.conformant).toBe(false);
		expect(concept.problem).toBeTruthy();
	});

	test("a concept with no type is reported as non-conformant", () => {
		const concept = parseConcept("decisions/untyped", conceptFile("title: Untyped"), AT);

		expect(concept.conformant).toBe(false);
		expect(concept.problem).toContain("type");
	});

	test("unknown keys survive being read", () => {
		const concept = parseConcept(
			"decisions/extended",
			conceptFile("type: Decision\nhouse_rule: keep it boring"),
			AT,
		);

		expect(concept.frontmatter.house_rule).toBe("keep it boring");
	});

	test("an unknown type is not an error", () => {
		const concept = parseConcept(
			"decisions/extended",
			conceptFile("type: Some Type Nobody Has Seen"),
			AT,
		);

		expect(concept.conformant).toBe(true);
		expect(concept.type).toBe("Some Type Nobody Has Seen");
	});

	test("absent status means stable", () => {
		const concept = parseConcept("decisions/minimal", conceptFile("type: Decision"), AT);

		expect(concept.status).toBe("stable");
	});

	test("a declared status is reported as declared", () => {
		const concept = parseConcept(
			"standards/naming",
			conceptFile("type: Standard\nstatus: draft"),
			AT,
		);

		expect(concept.status).toBe("draft");
	});

	test("staleness is decided against the clock it is given", () => {
		const past = parseConcept(
			"a",
			conceptFile("type: Standard\nstale_after: 2020-01-01T00:00:00Z"),
			AT,
		);
		const future = parseConcept(
			"b",
			conceptFile("type: Standard\nstale_after: 2099-01-01T00:00:00Z"),
			AT,
		);

		expect(past.stale).toBe(true);
		expect(future.stale).toBe(false);
	});

	test("a concept with no freshness moment is never stale", () => {
		const concept = parseConcept("a", conceptFile("type: Standard"), AT);

		expect(concept.stale).toBe(false);
	});

	test("human review outranks machine confirmation", () => {
		const human = parseConcept(
			"a",
			conceptFile(
				"type: Standard\nverified:\n  - { by: human:zero, at: 2026-07-01T09:00:00Z }",
			),
			AT,
		);
		const machine = parseConcept(
			"b",
			conceptFile(
				"type: Standard\nverified:\n  - { by: agent/gemini, at: 2026-07-01T09:00:00Z }",
			),
			AT,
		);

		expect(human.trust).toBe("human-reviewed");
		expect(machine.trust).toBe("machine-confirmed");
	});

	test("a concept nothing has verified is unverified", () => {
		const concept = parseConcept("a", conceptFile("type: Standard"), AT);

		expect(concept.trust).toBe("unverified");
	});

	test("a bare verification mapping counts as one entry", () => {
		const concept = parseConcept(
			"a",
			conceptFile("type: Standard\nverified: { by: human:zero, at: 2026-07-01T09:00:00Z }"),
			AT,
		);

		expect(concept.trust).toBe("human-reviewed");
	});

	test("a file with no frontmatter at all is non-conformant", () => {
		const concept = parseConcept("a", "Just a body, no frontmatter.\n", AT);

		expect(concept.conformant).toBe(false);
		expect(concept.body.trim()).toBe("Just a body, no frontmatter.");
	});
});
