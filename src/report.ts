import { messageText } from "./messages.ts";
import type { Concept } from "./concept.ts";
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
	size: "absent: nothing fitted the budget",
	empty: "absent: Turn 0's prompt is empty",
	missing: "absent: the first turn is no longer stored",
	unhooked: "absent: the harness never offered the system prompt",
};

/**
 * An absence in words. A record written by an earlier version may hold a
 * cause this one no longer records; it is named as recorded rather than
 * failing or reading as another cause.
 */
function absenceOf(cause: AbsenceCause): string {
	return ABSENCE[cause] ?? `absent: ${cause}`;
}

/**
 * Why a part carried less than it could have, in the order a reader wants
 * them: what each Budget refused, then what the tail evicted, then what the
 * pack ceiling took, then what had to be shortened.
 *
 * A table rather than a cascade of conditionals, because every entry answers
 * the same question and a reader comparing two parts should be comparing one
 * list, not tracing eight branches.
 */
const REASONS: ((part: PartView) => string | undefined)[] = [
	(part) =>
		(part.excluded?.count ?? 0) > 0
			? `${part.excluded?.count} over the count`
			: undefined,
	(part) =>
		(part.excluded?.size ?? 0) > 0
			? `${part.excluded?.size} over the size budget`
			: undefined,
	(part) =>
		(part.excluded?.evicted ?? 0) > 0
			? `${part.excluded?.evicted} evicted`
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
	(part) =>
		part.droppedMessages !== undefined
			? `${part.droppedMessages} message${part.droppedMessages === 1 ? "" : "s"} dropped`
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
		part.budget?.tokens !== undefined &&
		part.approximateTokens > part.budget.tokens
			? `over its ${part.budget.tokens}-token budget, irreducible`
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
	const spend =
		part.budget === undefined ? [] : [`${part.carried} of ${part.budget.count}`];
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

/** Which Turns or Pins the part carried, where it names any. */
function identities(part: PartView): string {
	const turns =
		part.turnIndices.length > 0 ? ` turns ${part.turnIndices.join(", ")}` : "";
	const pins =
		part.pinIds.length > 0
			? ` pins ${part.pinIds.map((id) => `#${id}`).join(", ")}`
			: "";
	return `${turns}${pins}`;
}

/** Renders an inspection as text, which is the shape a pack actually has. */
export function renderCall(view: CallView): string {
	const lines: string[] = [
		`Turn ${view.turnIndex}, call ${view.callIndex}${view.unassembled ? " (unassembled)" : ""}`,
	];

	for (const part of view.parts) {
		// A Conversation holding no Pins is the usual case, and a line on
		// every Call saying so would bury the parts that did something.
		// Pins the hook never reached, or failed to build, are another
		// matter: the Conversation may hold some, and silence would read as
		// holding none.
		if (
			part.source === "pinned" &&
			part.carried === 0 &&
			part.absent !== "unhooked" &&
			part.absent !== "failed"
		) {
			continue;
		}
		// An absent part still gets a line, with the cause where the record
		// holds one: "no store is configured" and "the harness never offered
		// the system prompt" are different problems with different
		// remedies, and omitting the part entirely reads as neither.
		if (part.absent !== undefined) {
			lines.push(
				`  ${part.source.padEnd(14)} ${absenceOf(part.absent)}${reasonsOf(part)}`,
			);
			continue;
		}
		// The Pins and the Opening ride the system prompt (ADR-0015); a
		// reader must not take them for messages. Older records, sent as
		// messages, carry no placement and no mark.
		const placed = part.placement === "system-prompt" ? " in the system prompt" : "";
		lines.push(`  ${part.source.padEnd(14)} ~${part.approximateTokens} tokens` +
			`${placed}${carriedOf(part)}${identities(part)}`);
	}

	// Where the harness rewrote the Conversation behind this Call: every
	// Call before it was assembled against a window that no longer exists.
	if (view.compacted) {
		lines.push(
			"  compaction    the harness compacted this conversation at this call",
		);
	}

	// What else was filling this window. Said only when the backend was
	// active or unconfirmed: off is the condition the whole design assumes,
	// a Call recorded before the state existed has nothing to say, and a
	// line per Call restating either would bury the two that matter.
	if (view.memoryBackend === "active") {
		lines.push(
			"  memory        the harness memory backend was active for this call",
		);
	} else if (view.memoryBackend === "unconfirmed") {
		lines.push(
			"  memory        the harness never reported its memory backend, so " +
				"this call is unconfirmed rather than clean",
		);
	}

	if (view.ceiling !== undefined) {
		lines.push(
			`  ceiling       ~${view.beforeCeiling ?? "?"} of ${view.ceiling} tokens` +
				`${view.reduced ? " — parts reduced to fit" : ""}`,
		);
	}

	// Said only when it is news: a tail sent wholly from the harness's live
	// history is the normal case. Store copies stand in for Turns the live
	// history no longer holds, and a session spent running without the
	// store's sizes should be visible afterwards rather than mysterious.
	if (view.tailSource === "thread-store") {
		lines.push("  tail          some tail Turns are the store's copies");
	} else if (view.tailSource === "harness-fallback") {
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

	// What the window cost, against the Pack rather than the whole window:
	// the Floor is most of a window and caches whatever the Pack does, so a
	// rate over the window would read high whatever the body did.
	if (view.cacheRead === undefined) {
		lines.push("  cache         not reported for this call");
	} else if (view.cachedPackShare === undefined) {
		// Priced, but with no Pack to measure the price against — a window
		// the harness reported as all Floor. Saying 0% would claim a
		// measurement nobody made.
		lines.push(
			`  cache         ${view.cacheRead} read, ${view.cacheWrite ?? 0} written ` +
				`(share of the pack unmeasured)`,
		);
	} else {
		const cached = Math.round(view.cachedPackShare * 100);
		lines.push(
			`  cache         ${view.cacheRead} read, ${view.cacheWrite ?? 0} written ` +
				`(${cached}% of the pack read from cache)`,
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
 * What a pack carried or left out, named: a Turn by position, a Pin by id.
 * One renderer, because a diff and an explanation name the same things and
 * a reader comparing them should not be comparing two spellings.
 */
function nameOf(identity: { turnIndex?: number; pinId?: number }): string {
	if (identity.pinId !== undefined) return `#${identity.pinId}`;
	return `turn ${identity.turnIndex ?? "?"}`;
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

	// The Conversation-level answer to "which windows had two injectors in
	// them": one line naming the Calls, since a Conversation is usually
	// uniform and the exceptions are what a reader is looking for.
	if (summary.exposed.length > 0) {
		const addresses = summary.exposed
			.map((at) => `${at.turnIndex}.${at.callIndex} (${at.state})`)
			.join(", ");
		lines.push(
			`  the harness memory backend was not off for ${summary.exposed.length} ` +
				`of ${summary.calls} calls: ${addresses}`,
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

/**
 * Why a Call did not carry what someone asked about.
 *
 * Named, and explicit about what it cannot answer: a Call whose record
 * predates the ledger says so rather than reporting that nothing was
 * excluded, which would be the same lie in a new place.
 */
export function renderExplanation(answer: Explanation): string {
	const where = `turn ${answer.turnIndex}, call ${answer.callIndex}`;
	const lines = [`Why "${answer.subject}" was not carried by ${where}:`];

	// Said before the ledger is consulted: a part the harness never offered
	// a place for is explained by that, whatever else the record holds.
	for (const { source, cause } of answer.absent) {
		lines.push(`  ${source.padEnd(14)} ${absenceOf(cause)}`);
	}

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

	if (
		answer.carried.length === 0 &&
		answer.excluded.length === 0 &&
		answer.absent.length === 0
	) {
		// Never considered and considered-then-excluded are different
		// answers: one is about the Conversation, the other about a Budget.
		lines.push("  nothing matching it was considered for this call");
	}
	return lines.join("\n");
}

/** One excluded candidate: what it was, its size, and what kept it out. */
function describeCandidate(candidate: ExcludedCandidate): string {
	const size = candidate.tokens === undefined ? "" : `  ~${candidate.tokens} tokens`;
	let why: string;
	switch (candidate.reason) {
		case "ceiling":
			why = "  dropped for the pack ceiling";
			break;
		case "evicted":
			why = "  evicted from the tail";
			break;
		case "count":
		case "size":
			why =
				`  excluded by the ${candidate.budget ?? "?"} ` +
				`${candidate.reason === "count" ? "count" : "token"} budget`;
			break;
		default:
			// A reason an earlier version recorded and this one does not.
			why = `  excluded: ${candidate.reason}`;
	}
	return `${nameOf(candidate)}${size}${why}`;
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
		// A Concept the listing omits is reported rather than hidden, and
		// said to be missing from it: the listing is the author's view
		// about what matters, and a file nothing names is invisible.
		const unlisted = entry.unlisted ? " (not in this level's listing)" : "";
		// Broken, not absent: a Concept that cannot be read is something to
		// fix, and silence would read as a Level that does not hold it.
		const broken = entry.problem ? ` (cannot be read: ${entry.problem})` : "";
		lines.push(`  concept ${entry.id}${description}${unlisted}${broken}`);
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
 * One Concept as an agent reads it whole.
 *
 * What it declares it is *not*, and what it was drawn from, are served with
 * it: a definition read without the exclusions that bound it invites the
 * mistake they exist to prevent, and prose with no provenance cannot be
 * checked. A Concept recording neither carries no placeholder for them —
 * an empty heading says something is missing where nothing is.
 */
export function renderConcept(concept: Concept): string {
	const lines = [`# ${concept.title ?? concept.id}`];
	if (concept.description) lines.push("", concept.description);
	lines.push("", concept.body.trim());

	if (concept.exclusions.length > 0) {
		lines.push("", "This is not:");
		for (const exclusion of concept.exclusions) {
			const why = exclusion.why ? ` — ${exclusion.why}` : "";
			const instead = exclusion.instead
				? ` Use instead: ${exclusion.instead}`
				: "";
			lines.push(`- ${exclusion.term}${why}${instead}`);
		}
	}
	if (concept.sources.length > 0) {
		lines.push("", "Drawn from:");
		for (const source of concept.sources) {
			// A source that names only where it is says that once, not twice;
			// one that names only its author still names something.
			const named = source.title ?? source.id ?? source.author;
			const where = source.resource ?? "";
			lines.push(
				named ? `- ${named}${where ? ` (${where})` : ""}` : `- ${where}`,
			);
		}
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
	if (found.length === 0) return "No conversation holds anything relevant to that.";

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
