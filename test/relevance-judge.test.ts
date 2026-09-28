import { describe, expect, test } from "bun:test";

import { JEV_MODEL, JevJudge, JudgeFailure } from "../src/relevance-judge.ts";

interface Sent {
	url: string;
	headers: Headers;
	body: Record<string, unknown>;
}

/** A `fetch` that answers every request the same way and keeps what was sent. */
function answering(status: number, body: unknown, sent: Sent[] = []): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		sent.push({
			url: String(input),
			headers: new Headers(init?.headers),
			body: JSON.parse(String(init?.body)),
		});
		return new Response(typeof body === "string" ? body : JSON.stringify(body), {
			status,
		});
	}) as typeof fetch;
}

const verdict = (noul: unknown) => ({
	model: JEV_MODEL,
	answers: { relevant: { type: "noul", noul } },
	usage: { input_tokens: 700, output_tokens: 0 },
});

async function failureOf(work: Promise<unknown>): Promise<JudgeFailure> {
	try {
		await work;
	} catch (error) {
		if (error instanceof JudgeFailure) return error;
		throw error;
	}
	throw new Error("the judge answered instead of failing");
}

describe("asking Jev whether a Turn is relevant", () => {
	test("asks with the key, the pinned model, and both texts, and returns the Noul", async () => {
		const sent: Sent[] = [];
		const judge = new JevJudge("sk-test", answering(200, verdict(0.83), sent));

		const probability = await judge.judge("why do retries back off", "we chose exponential backoff");

		expect(probability).toBe(0.83);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
		expect(sent[0]?.headers.get("authorization")).toBe("Bearer sk-test");
		expect(sent[0]?.body.model).toBe("jev-1.13.0");
		expect(sent[0]?.body.state).toEqual({
			request: "why do retries back off",
			earlier_turn: "we chose exponential backoff",
		});
	});

	test("a refused key is a rejected failure", async () => {
		const judge = new JevJudge("sk-bad", answering(401, { error: "invalid api key" }));

		const failure = await failureOf(judge.judge("q", "p"));

		expect(failure.rejected).toBe(true);
	});

	test("a rate limit is a failure, but not a rejected key", async () => {
		const judge = new JevJudge("sk-test", answering(429, { error: "slow down" }));

		const failure = await failureOf(judge.judge("q", "p"));

		expect(failure.rejected).toBe(false);
		expect(failure.message).toContain("429");
	});

	test("an answer that is not a probability is a failure, not a verdict", async () => {
		for (const body of [verdict(1.7), verdict("0.9"), { answers: {} }, "not json"]) {
			const judge = new JevJudge("sk-test", answering(200, body));

			const failure = await failureOf(judge.judge("q", "p"));

			expect(failure.rejected).toBe(false);
		}
	});
});
