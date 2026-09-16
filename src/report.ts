import { messageText } from "./messages.ts";
import type { FoundTurn } from "./thread-store.ts";
import type {
	CallView,
	ConversationSummary,
	PackDiff,
} from "./inspection.ts";

/** Renders an inspection as text, which is the shape a pack actually has. */
export function renderCall(view: CallView): string {
	const lines: string[] = [
		`Turn ${view.turnIndex}, call ${view.callIndex}${view.unassembled ? " (unassembled)" : ""}`,
	];

	for (const part of view.parts) {
		const excluded = part.trimmed
			? `, ${part.dropped} dropped`
			: part.irrelevant > 0
				? `, ${part.irrelevant} not relevant enough`
				: "";
		const budget =
			part.budget === undefined ? "" : ` of ${part.budget}${excluded}`;
		const turns =
			part.turnIndices.length > 0 ? ` turns ${part.turnIndices.join(", ")}` : "";
		const concepts =
			part.conceptIds.length > 0
				? ` concepts ${part.conceptIds.join(", ")}`
				: "";
		const symbols =
			part.symbols.length > 0 ? ` symbols ${part.symbols.join(", ")}` : "";
		lines.push(
			`  ${part.source.padEnd(14)} ~${part.approximateTokens} tokens` +
				`${budget ? ` (${part.carried}${budget})` : ""}${turns}${concepts}` +
				`${symbols}`,
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
			return `- ${where}conversation ${hit.conversationId}, turn ${hit.turnIndex}\n${body}`;
		})
		.join("\n\n");
}
