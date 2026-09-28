/**
 * Whether a passage is relevant to a query, asked of a model rather than
 * measured as a distance.
 *
 * Distance admits Turns that merely share a Codebase's vocabulary: against
 * Turns from other Conversations of the same Codebase the recall cut
 * admitted 32 of 50, of which Jev refused 27 (`docs/research/jev.md`). A
 * judge answers the question distance only approximates.
 */
export interface RelevanceJudge {
	/** P(relevant), in [0, 1]. Throws a `JudgeFailure` when it cannot answer. */
	judge(query: string, passage: string): Promise<number>;
}

/**
 * Why a judge could not answer. `rejected` is the one failure that will not
 * pass on its own: the key was refused, so asking again asks for the same
 * refusal. Everything else — a rate limit, an overload, a timeout, an answer
 * that is not a probability — may be gone by the next search.
 */
export class JudgeFailure extends Error {
	constructor(
		message: string,
		readonly rejected: boolean = false,
	) {
		super(message);
		this.name = "JudgeFailure";
	}
}

/**
 * The model id, pinned rather than `jev-latest`: the threshold below is
 * measured against this model, and an alias that moves on release would
 * move the threshold's meaning with it.
 */
export const JEV_MODEL = "jev-1.13.0";

/** Where Jev is asked. Named in the disclosure, so it is one constant. */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/**
 * The verdict a Turn must reach to be kept. Untuned: on 50 genuine and 50
 * unlabelled same-Codebase pairs it kept 42 genuine and admitted 5 others
 * behind the distance cut. Tuning it is a one-line change with a measurement.
 */
export const JUDGE_THRESHOLD = 0.5;

/**
 * How long one verdict may take. The measured maximum at six in parallel was
 * 1,068 ms; past three seconds the agent is better served by distance alone.
 */
export const JUDGE_DEADLINE_MS = 3_000;

/**
 * The question, as measured. `request` and `earlier_turn` name the state
 * fields; Jev reads backticked names as references into the state.
 */
const QUESTION =
	"Is `earlier_turn` about the same task or subject as `request`, so that " +
	"recalling it would help an assistant answer `request`?";

/**
 * Jev over plain `fetch`. One question per request: a batched state is the
 * "large irrelevant state" Jev handles worst, and would let adversarial text
 * in one Turn sway the verdicts on the others.
 *
 * No SDK: its 10 s timeout and two retries fight a deadline, and one
 * endpoint needs no client.
 */
export class JevJudge implements RelevanceJudge {
	constructor(
		private readonly key: string,
		private readonly send: typeof fetch = fetch,
	) {}

	async judge(query: string, passage: string): Promise<number> {
		let response: Response;
		try {
			response = await this.send(JEV_ENDPOINT, {
				method: "POST",
				headers: {
					authorization: `Bearer ${this.key}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model: JEV_MODEL,
					state: { request: query, earlier_turn: passage },
					questions: { relevant: { type: "noul", instructions: QUESTION } },
				}),
				signal: AbortSignal.timeout(JUDGE_DEADLINE_MS),
			});
		} catch (error) {
			const timedOut = error instanceof Error && error.name === "TimeoutError";
			throw new JudgeFailure(
				timedOut
					? `no answer within ${JUDGE_DEADLINE_MS} ms`
					: `could not reach the judge (${error instanceof Error ? error.message : String(error)})`,
			);
		}

		if (response.status === 401) {
			throw new JudgeFailure("the TypeSafe key was rejected (401)", true);
		}
		if (!response.ok) {
			throw new JudgeFailure(`the judge answered ${response.status}`);
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new JudgeFailure("the judge's answer was not JSON");
		}
		const noul = field(field(field(body, "answers"), "relevant"), "noul");
		if (typeof noul !== "number" || !(noul >= 0 && noul <= 1)) {
			throw new JudgeFailure("the judge's answer held no probability");
		}
		return noul;
	}
}

/** One property of a parsed JSON value, or `undefined` when it has none. */
function field(value: unknown, name: string): unknown {
	return value !== null && typeof value === "object" && name in value
		? (value as Record<string, unknown>)[name]
		: undefined;
}
