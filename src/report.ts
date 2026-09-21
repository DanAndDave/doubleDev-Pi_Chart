import { messageText } from "./messages.ts";
import type { Level } from "./doc-store.ts";
import type { FoundTurn } from "./thread-store.ts";
import type { AbsenceCause, ExcludedCandidate } from "./assembler.ts";
import type {
	CallView,
	ConversationSummary,
	Explanation,
	PackDiff,
	PartView,
} from "./inspection.ts";

/** Why a part contributed nothing, in words a reader can act on. */
const ABSENCE: Record<AbsenceCause, string> = {
	disabled: "excluded: its budget is zero",
	unconfigured: "absent: no store configured for it",
	failed: "absent: retrieval failed",
	none: "absent: no candidates",
	irrelevant: "absent: nothing met the threshold",
	size: "absent: nothing fitted the budget",
};

/**
 * Why a part carried less than it could have, in the order a reader wants
 * them: what was never relevant, then what each Budget refused, then what
 * the pack ceiling took, then what had to be shortened.
 *
 * A table rather than a cascade of conditionals, because every entry answers
 * the same question and a reader comparing two parts should be comparing one
 * list, not tracing eight branches.
 */
const REASONS: ((part: PartView) => string | undefined)[] = [
	// Reported against the threshold in force wherever one was applied, so
	// a part that refused nothing and a part measured against a threshold
	// set too tight are not the same line. A part that never ran — no
	// Budget, no Store, a failed retrieval — measured nothing against its
	// threshold, and "0 refused" there would read as a corpus with
	// nothing near when the cause says otherwise.
	(part) => {
		const measured =
			part.absent === undefined ||
			part.absent === "irrelevant" ||
			part.absent === "none" ||
			part.absent === "size";
		const irrelevant = part.excluded?.irrelevant ?? part.irrelevant;
		if (part.threshold !== undefined && measured) {
			return `${irrelevant} refused against the ${part.threshold} threshold`;
		}
		return irrelevant > 0 ? `${irrelevant} not relevant enough` : undefined;
	},
	// Said where a shortfall might otherwise be read as irrelevance: a
	// part selected by recency or by name cannot refuse anything for being
	// too distant, and silence there invites the wrong remedy. An absent
	// part already carries its cause, so it does not need this too.
	(part) => (part.unranked && part.dropped > 0 ? "no relevance threshold" : undefined),
	(part) =>
		(part.excluded?.count ?? 0) > 0
			? `${part.excluded?.count} over the count`
			: undefined,
	(part) =>
		(part.excluded?.size ?? 0) > 0
			? `${part.excluded?.size} over the size budget`
			: undefined,
	(part) =>
		(part.excluded?.ceiling ?? 0) > 0
			? `${part.excluded?.ceiling} for the pack ceiling`
			: undefined,
	// Older records carry a count of what a Budget excluded but no reason for
	// it; saying "dropped" keeps them readable without inventing one.
	(part) =>
		part.trimmed && part.excluded === undefined
			? `${part.dropped} dropped`
			: undefined,
	(part) => (part.shortened === true ? "content shortened" : undefined),
	// Said whenever the ceiling changed what this part carried, whether it
	// lost whole candidates or only their bulk.
	(part) =>
		part.withoutCeiling !== undefined &&
		part.withoutCeiling !== part.approximateTokens
			? `~${part.withoutCeiling} tokens without the ceiling`
			: undefined,
	// A Budget a part could not get under is reported as exceeded rather than
	// left to look like a fit: a Turn of many messages, each already as short
	// as is worth carrying, has a floor no Budget can argue with.
	(part) =>
		part.tokenBudget !== undefined && part.approximateTokens > part.tokenBudget
			? `over its ${part.tokenBudget}-token budget, irreducible`
			: undefined,
];

/**
 * What a part carried and why it carried no more.
 *
 * The reasons are rendered whether or not the part has a count Budget: the
 * current Turn has none, and it is the part the ceiling elides, so hanging
 * them off the Budget hid exactly the case worth reading.
 */
function carriedOf(part: PartView): string {
	// The count Budget reads as "2 of 4" and leads; every reason follows it.
	const spend = part.budget === undefined ? [] : [`${part.carried} of ${part.budget}`];
	return wrap([...spend, ...reasons(part)]);
}

/** Why an absent part is absent, beyond the cause itself. */
function reasonsOf(part: PartView): string {
	return wrap(reasons(part));
}

function reasons(part: PartView): string[] {
	return REASONS.map((reason) => reason(part)).filter(
		(reason) => reason !== undefined,
	);
}

function wrap(inside: string[]): string {
	return inside.length > 0 ? ` (${inside.join(", ")})` : "";
}

/** Which Turns, Concepts, or symbols the part carried, where it names any. */
function identities(part: PartView): string {
	const turns =
		part.turnIndices.length > 0 ? ` turns ${part.turnIndices.join(", ")}` : "";
	const concepts =
		part.conceptIds.length > 0 ? ` concepts ${part.conceptIds.join(", ")}` : "";
	const symbols =
		part.symbols.length > 0 ? ` symbols ${part.symbols.join(", ")}` : "";
	return `${turns}${concepts}${symbols}`;
}

/** Renders an inspection as text, which is the shape a pack actually has. */
export function renderCall(view: CallView): string {
	const lines: string[] = [
		`Turn ${view.turnIndex}, call ${view.callIndex}${view.unassembled ? " (unassembled)" : ""}`,
	];

	for (const part of view.parts) {
		// An absent part still gets a line, with the cause where the record
		// holds one: "curated carried nothing" and "no doc store is
		// configured" are different problems with different remedies, and
		// omitting the part entirely reads as neither.
		if (part.absent !== undefined) {
			lines.push(
				`  ${part.source.padEnd(14)} ${ABSENCE[part.absent]}${reasonsOf(part)}`,
			);
			continue;
		}
		lines.push(`  ${part.source.padEnd(14)} ~${part.approximateTokens} tokens` +
			`${carriedOf(part)}${identities(part)}`);
	}

	// Where the harness rewrote the Conversation behind this Call: every
	// Call before it was assembled against a window that no longer exists.
	if (view.compacted) {
		lines.push(
			"  compaction    the harness compacted this conversation at this call",
		);
	}

	if (view.ceiling !== undefined) {
		lines.push(
			`  ceiling       ~${view.beforeCeiling ?? "?"} of ${view.ceiling} tokens` +
				`${view.reduced ? " — parts reduced to fit" : ""}`,
		);
	}

	// Said once, on the Call, because a Call that recalled nothing has no
	// part to say it on — and that is the case worth explaining.
	if (view.rejected > 0 && !view.parts.some((part) => part.source === "recalled")) {
		lines.push(
			`  recalled       nothing (${view.rejected} not relevant enough)`,
		);
	}

	// A recall the store could not complete is a different fact from one
	// that found nothing worth carrying, and the difference is repairable:
	// those Turns come back once embedding catches up.
	if (view.unsearched > 0) {
		lines.push(
			`  recall        searched all but ${view.unsearched} turns of this ` +
				`conversation (awaiting embedding)`,
		);
	}

	// Said only when it is news: a session spent running without the store
	// should be visible afterwards rather than mysterious.
	if (view.tailSource === "harness-fallback") {
		lines.push("  tail          from the harness's own history, not the store");
	}

	if (view.floorTokens === undefined || view.packTokens === undefined) {
		lines.push("  window        not reported yet");
		if (view.approximateTokens !== undefined) {
			// Never the reported size in disguise: a Budget is applied to
			// this figure, and whether it runs high or low is unknown until
			// the harness has measured the window it went into.
			lines.push(
				`  estimate      ~${view.approximateTokens} tokens, unmeasured ` +
					`against the window`,
			);
		}
		return lines.join("\n");
	}

	const share = Math.round((view.floorShare ?? 0) * 100);
	lines.push(
		`  window        pack ${view.packTokens} + floor ${view.floorTokens} ` +
			`(floor is ${share}% of the window)`,
	);
	if (view.approximateTokens !== undefined) {
		lines.push(
			`  estimate      ~${view.approximateTokens} estimated against ` +
				`${view.packTokens} reported` +
				(view.estimateRatio === undefined
					? ""
					: ` (${view.estimateRatio}× the reported size)`),
		);
	}
	return lines.join("\n");
}

export function renderDiff(diff: PackDiff): string {
	if (diff.entered.length === 0 && diff.left.length === 0) {
		return "No change between these packs.";
	}
	const lines: string[] = [];
	for (const item of diff.entered) lines.push(`  + ${describeItem(item)}`);
	for (const item of diff.left) lines.push(`  - ${describeItem(item)}`);
	lines.push(`  = ${diff.unchanged.length} unchanged`);
	return lines.join("\n");
}

/**
 * What a pack carried or refused, named: a Turn by position, a Concept by
 * id, a symbol by name. One renderer, because a diff, an explanation and a
 * near miss all name the same three kinds of thing and a reader comparing
 * them should not be comparing three spellings.
 */
function nameOf(identity: {
	turnIndex?: number;
	conceptId?: string;
	symbol?: string;
}): string {
	return (
		identity.conceptId ??
		identity.symbol ??
		`turn ${identity.turnIndex ?? "?"}`
	);
}

/** A diffed item, with the part that carried it. */
function describeItem(item: PackDiff["entered"][number]): string {
	return `${item.source} ${nameOf(item)}`;
}

/** What a Conversation recorded, for refusing an address with. */
export function describeRecorded(calls: CallView[]): string {
	if (calls.length === 0) return "nothing";
	const turns = [...new Set(calls.map((call) => call.turnIndex))].sort(
		(a, b) => a - b,
	);
	const first = turns[0];
	const last = turns[turns.length - 1];
	const span = first === last ? `turn ${first}` : `turns ${first} to ${last}`;
	return `${span}, ${calls.length} call${calls.length === 1 ? "" : "s"}`;
}

export function renderSummary(summary: ConversationSummary): string {
	if (summary.calls === 0) return "Nothing recorded for this conversation yet.";

	const lines = [
		`${summary.calls} calls, ${summary.measuredCalls} measured`,
	];

	if (summary.averageFloorShare !== undefined) {
		lines.push(
			`  average pack ${summary.averagePackTokens} + floor ${summary.averageFloorTokens} ` +
				`(floor is ${Math.round(summary.averageFloorShare * 100)}% of the window)`,
		);
	}

	// The figure every Budget is applied to, against the one the harness
	// measured. A ratio near one says the estimator is honest here; the
	// pack ceiling is only as good as this number.
	if (summary.averageEstimateRatio !== undefined) {
		lines.push(
			`  estimate ran ${summary.averageEstimateRatio}× the reported size`,
		);
	}

	for (const at of summary.compactions) {
		lines.push(
			`  the harness compacted this conversation at turn ${at.turnIndex}, ` +
				`call ${at.callIndex}`,
		);
	}

	for (const use of summary.budgetUse) {
		const budget = use.budget === undefined ? "" : ` of ${use.budget}`;
		const irrelevant =
			use.averageIrrelevant > 0
				? `, ${use.averageIrrelevant} rejected as irrelevant on average`
				: "";
		lines.push(
			`  ${use.source.padEnd(14)} carried ${use.averageCarried}${budget} on average` +
				`, trimmed ${use.timesTrimmed} times${irrelevant}`,
		);
	}

	return lines.join("\n");
}

/**
 * Why a Call did not carry what someone asked about.
 *
 * Ranked, named, and explicit about what it cannot answer: a Call whose
 * record predates the ledger says so rather than reporting that nothing
 * was excluded, which would be the same lie in a new place.
 */
export function renderExplanation(answer: Explanation): string {
	const where = `turn ${answer.turnIndex}, call ${answer.callIndex}`;
	const lines = [`Why "${answer.subject}" was not carried by ${where}:`];

	if (answer.unexplainable) {
		lines.push(
			"  this call was recorded before candidate identities were kept, " +
				"so it holds no detail about what it excluded",
		);
		return lines.join("\n");
	}

	for (const item of answer.carried) {
		lines.push(`  carried by ${item.source}: ${nameOf(item)}`);
	}

	for (const { source, candidate } of answer.excluded) {
		lines.push(`  ${source.padEnd(14)} ${describeCandidate(candidate)}`);
	}

	if (answer.carried.length === 0 && answer.excluded.length === 0) {
		// Never considered and considered-then-refused are different
		// answers: one is about the threshold, the other about the corpus.
		lines.push("  nothing matching it was considered for this call");
	}
	return lines.join("\n");
}

/** One excluded candidate: what it was, how far, and what kept it out. */
function describeCandidate(candidate: ExcludedCandidate): string {
	const what = nameOf(candidate);
	// Two decimals: a distance is a ranking signal, and sixteen digits of
	// float precision in a line someone reads is noise.
	const distance =
		candidate.distance === undefined
			? ""
			: `  distance ${candidate.distance.toFixed(2)}`;
	const size = candidate.tokens === undefined ? "" : `  ~${candidate.tokens} tokens`;
	const why =
		candidate.reason === "irrelevant"
			? `  beyond the ${candidate.threshold ?? "?"} threshold`
			: candidate.reason === "ceiling"
				? "  dropped for the pack ceiling"
				: `  excluded by the ${candidate.budget ?? "?"} ` +
					`${candidate.reason === "count" ? "count" : "token"} budget`;
	return `${what}${distance}${size}${why}`;
}

/** A Level as the agent reads it: where to walk next, and what to open. */
export function renderLevel(level: Level): string {
	const where = level.path === "" ? "the bundle" : level.path;
	const lines = [`${where} holds:`];

	for (const sub of level.levels) {
		const path = level.path === "" ? sub : `${level.path}/${sub}`;
		lines.push(`  level ${path}`);
	}
	for (const entry of level.concepts) {
		const description = entry.description ? ` — ${entry.description}` : "";
		lines.push(`  concept ${entry.id}${description}`);
	}
	if (level.levels.length === 0 && level.concepts.length === 0) {
		lines.push("  nothing yet");
	}
	// Whether the ordering is the author's or ours is worth knowing: a
	// curated listing says what the author thought mattered first.
	if (level.curated) lines.push("(listing curated by the bundle's author)");
	return lines.join("\n");
}

/**
 * Renders a cross-Conversation search as a tool result.
 *
 * Each hit says where it came from: a recollection from another project is
 * only useful if the agent can tell that is what it is.
 */
export function renderSearch(found: FoundTurn[]): string {
	if (found.length === 0) {
		return "No conversation holds anything relevant to that.";
	}

	return found
		.map((hit) => {
			const where = hit.codebase ? `${hit.codebase} ` : "";
			// Filtered on the text, before it is decorated with a role: a tool
			// call renders as empty text, and an empty line helps nobody.
			const body = hit.turn.messages
				.map((message) => ({ role: message.role, text: messageText(message) }))
				.filter((part) => part.text.trim().length > 0)
				.map((part) => `    ${part.role}: ${part.text}`)
				.join("\n");
			// Only when it is more than one: "took 1 call" is noise, while
			// "took 6 calls" is the difference between a question answered
			// and one fought with.
			const effort = hit.calls > 1 ? `, ${hit.calls} calls` : "";
			return (
				`- ${where}conversation ${hit.conversationId}, ` +
				`turn ${hit.turnIndex}${effort}\n${body}`
			);
		})
		.join("\n\n");
}
