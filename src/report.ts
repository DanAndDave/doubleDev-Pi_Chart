import { messageText } from "./messages.ts";
import type { Level } from "./doc-store.ts";
import type { FoundTurn } from "./thread-store.ts";
import type {
	CallView,
	ConversationSummary,
	PackDiff,
	PartView,
} from "./inspection.ts";

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
	(part) => {
		const irrelevant = part.excluded?.irrelevant ?? part.irrelevant;
		return irrelevant > 0 ? `${irrelevant} not relevant enough` : undefined;
	},
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
	const reasons = REASONS.map((reason) => reason(part)).filter(
		(reason) => reason !== undefined,
	);
	// The count Budget reads as "2 of 4" and leads; every reason follows it.
	const spend = part.budget === undefined ? [] : [`${part.carried} of ${part.budget}`];
	const inside = [...spend, ...reasons];
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
		lines.push(`  ${part.source.padEnd(14)} ~${part.approximateTokens} tokens` +
			`${carriedOf(part)}${identities(part)}`);
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

	// Said only when it is news: a session spent running without the store
	// should be visible afterwards rather than mysterious.
	if (view.tailSource === "harness-fallback") {
		lines.push("  tail          from the harness's own history, not the store");
	}

	if (view.floorTokens === undefined || view.packTokens === undefined) {
		lines.push("  window        not reported yet");
		return lines.join("\n");
	}

	const share = Math.round((view.floorShare ?? 0) * 100);
	lines.push(
		`  window        pack ${view.packTokens} + floor ${view.floorTokens} ` +
			`(floor is ${share}% of the window)`,
	);
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

/** A diffed item: a Turn by position, or a Concept by id. */
function describeItem(item: PackDiff["entered"][number]): string {
	const what = item.conceptId ?? item.symbol ?? `turn ${item.turnIndex}`;
	return `${item.source} ${what}`;
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
