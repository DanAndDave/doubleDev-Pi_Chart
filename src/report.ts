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
		const budget =
			part.budget === undefined
				? ""
				: ` of ${part.budget}${part.trimmed ? `, ${part.dropped} dropped` : ""}`;
		const turns =
			part.turnIndices.length > 0 ? ` turns ${part.turnIndices.join(", ")}` : "";
		lines.push(
			`  ${part.source.padEnd(14)} ~${part.approximateTokens} tokens` +
				`${budget ? ` (${part.carried}${budget})` : ""}${turns}`,
		);
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
	for (const item of diff.entered) lines.push(`  + ${item.source} turn ${item.turnIndex}`);
	for (const item of diff.left) lines.push(`  - ${item.source} turn ${item.turnIndex}`);
	lines.push(`  = ${diff.unchanged.length} unchanged`);
	return lines.join("\n");
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
		lines.push(
			`  ${use.source.padEnd(14)} carried ${use.averageCarried}${budget} on average` +
				`, trimmed ${use.timesTrimmed} times`,
		);
	}

	return lines.join("\n");
}
