import {
	MemoryAccounting,
	type AccountingStore,
	type CallAddress,
	type Measurement,
	type MemoryBackendState,
	type TailSource,
} from "./accounting.ts";
import {
	assemble as defaultAssemble,
	type AssembleInput,
	type AssemblerConfig,
	type Pack,
} from "./assembler.ts";
import {
	readExclusions,
	readSources,
	type Concept,
} from "./concept.ts";
import {
	assemblerConfig,
	loadConfig,
	pinBudget,
	readSavedUrl,
	setBudget,
	type Config,
} from "./config.ts";
import {
	DocStore,
	readBundle,
	type ConceptWriter,
	type DocWalk,
	type WriteOutcome,
} from "./doc-store.ts";
import { type Extraction, GraphStore } from "./graph-store.ts";
import { type Check, describeChecks, Installation } from "./install.ts";
import { describeTree, SpecStore } from "./spec-store.ts";
import {
	neighbourhoods,
	symbolsInPlay,
	type Neighbourhood,
} from "./symbols.ts";
import type {
	ConceptMatches,
	ConceptSearch,
} from "./doc-index.ts";
import {
	comparePacks,
	explain,
	inspectConversation,
	parseAddress,
	resolveCall,
	summarise,
	type CallView,
} from "./inspection.ts";
import {
	describeRecorded,
	renderCall,
	renderConcept,
	renderDiff,
	renderExplanation,
	renderLevel,
	renderSearch,
	type SearchJudgement,
	renderSummary,
} from "./report.ts";
import {
	findJournal,
	readJournal,
	SESSION_ROOT,
	type JournalTurn,
} from "./journal.ts";
import {
	messageText,
	withoutNativeCompaction,
	type ContextSnapshot,
	type HarnessMessage,
	type Turn,
} from "./messages.ts";
import type {
	BranchEntry,
	ExtensionAPI,
	HandlerContext,
	MemoryStatus,
	SchemaBuilder,
	CommandContext,
	HarnessUI,
	SessionView,
	SchemaField,
	ToolResult,
} from "./harness.ts";
import { LocalEmbedder } from "./embedder.ts";
import { PostgresStore } from "./postgres-store.ts";
import {
	type CorpusSearch,
	type FoundTurn,
	MemoryTurnSource,
	type Recollections,
	type TurnRecall,
	type TurnSink,
	type TurnSource,
	type VectorModels,
} from "./thread-store.ts";
import {
	JEV_ENDPOINT,
	JEV_MODEL,
	JevJudge,
	JUDGE_THRESHOLD,
	JudgeFailure,
	type RelevanceJudge,
} from "./relevance-judge.ts";
import { EMBED_CHARACTERS, embedText } from "./embed-text.ts";
import { reconstructTurns } from "./turns.ts";
import {
	admit,
	PIN_ENTRY,
	pinTokens,
	renderPin,
	replayPins,
	sameState,
	type PinEvent,
	type PinState,
} from "./pins.ts";
import { approximateTokens } from "./tokens.ts";

export interface Dependencies {
	config: Config;
	assemble: (input: AssembleInput, config: AssemblerConfig) => Pack;
	turns: TurnSource;
	ingest?: TurnSink;
	recall?: TurnRecall;
	/** Embeds newly ingested Turns. Runs after a Turn, never before one. */
	embed?: (conversationId: string) => Promise<unknown>;
	/**
	 * Which model produced the store's vectors. Asked once a session, so a
	 * model swap is reported in the session that caused it rather than
	 * inferred later from thin recall.
	 */
	vectorModels?: () => Promise<VectorModels>;
	/**
	 * Retires Turns older than an age, returning how many went. Absent when
	 * nothing durable is stored; called at shutdown, never on a request.
	 */
	retire?: (olderThanDays: number) => Promise<number>;
	/**
	 * How a deadline waits. Injected so a test can expire one without
	 * spending the time, and so nothing on the request path holds a timer
	 * the harness does not know about.
	 */
	after?: (ms: number) => Promise<void>;
	/** Where a Conversation's Journal is. A seam for the miss. */
	findJournal?: (conversationId: string) => Promise<string | undefined>;
	/** Where Journals were looked for, named when one cannot be found. */
	sessionRoot?: string;
	/** Releases whatever the session held open. */
	close?: () => Promise<void> | void;
	/** Shows text to the person running the session. */
	show?: (text: string) => void;
	/** Searches every Conversation, when the agent asks. */
	search?: CorpusSearch;
	/**
	 * Builds the relevance judge from the key the host resolves at session
	 * start. A factory because the key exists only then; absent where there
	 * is nothing to search.
	 */
	judgeWith?: (key: string) => RelevanceJudge;
	/** The Doc Store's index, searched during assembly. */
	docs?: ConceptSearch;
	/** The bundle as the agent walks it, Level by Level. */
	walk?: DocWalk;
	/** The bundle as the agent writes to it. */
	author?: ConceptWriter;
	/** What the installation needs. Injected so the checks are testable. */
	install?: Installation;
	/** The Codebase's programmatic structure. */
	graph?: GraphStore;
	/** The Codebase's stated intent. Verified, never read into a pack. */
	specs?: SpecStore;
	/**
	 * Reads the bundle the index is derived from, or resolves to `undefined`
	 * when there is no bundle to read.
	 */
	bundle?: () => Promise<Concept[] | undefined>;
	/** Settles when the schema is ready. Indexing at session start awaits it. */
	ready?: Promise<unknown>;
	/** Notified of background work, so a test can wait for it. */
	background?: (work: Promise<void>) => void;
	/** The Codebase this session is working in. */
	codebase?: string;
	accounting: AccountingStore;
	report: (message: string) => void;
}

const UNKNOWN_CONVERSATION = "unknown-conversation";
/** The footer status that says a Conversation holds Pins. */
const PIN_STATUS = "pi-chart.pins";
/** Said by every Pin command a harness without a Journal surface cannot serve. */
const PINS_UNAVAILABLE =
	"Pins are off: this harness does not let pi-chart read and write its journal.";

/** How many hits a cross-Conversation search returns when unasked. */
const DEFAULT_SEARCH_RESULTS = 5;
/** A ceiling, so one call cannot empty the store into the window. */
const MAX_SEARCH_RESULTS = 20;

/**
 * What `write_documentation` takes, in the harness's own schema builder.
 *
 * Built here rather than inline so the tool registers whether or not the
 * harness supplies a builder: a tool with no declared parameters is still
 * callable, and a missing builder must not withdraw the ability to write.
 */
function writeSchema(zod: SchemaBuilder | undefined): unknown {
	if (!zod) return undefined;
	return zod.object({
		id: zod
			.string()
			.describe("Where it belongs, as a listing names it: `decisions/caching`"),
		mode: zod
			.enum(["create", "revise"])
			.describe("Whether this is a new concept or a change to one"),
		type: zod
			.string()
			.describe("What kind of concept: Decision, Standard, Metric")
			.optional(),
		title: zod.string().describe("Its title").optional(),
		summary: zod
			.string()
			.describe(
				"One sentence saying what it is about; it is what makes the " +
					"concept findable by a paraphrase of its subject",
			)
			.optional(),
		body: zod
			.string()
			.describe("The concept itself, in Markdown, with `# ` headings")
			.optional(),
		not: zod
			.array(
				zod.object({
					term: zod.string().describe("What this is confusable with"),
					why: zod.string().describe("Why that is wrong here").optional(),
					instead: zod.string().describe("What to use instead").optional(),
				}) as SchemaField,
			)
			.describe("What this concept is not, where that is worth saying")
			.optional(),
		sources: zod
			.array(
				zod.object({
					title: zod.string().describe("What it is called").optional(),
					resource: zod.string().describe("Where it is").optional(),
				}) as SchemaField,
			)
			.describe("What this was drawn from")
			.optional(),
		// Declared so that asking for it reaches the refusal. Undeclared, a
		// harness that validates arguments against this schema would strip
		// the key, and the silent strip is exactly what must not happen: an
		// agent told nothing believes it recorded a review.
		verified: zod
			.unknown()
			.describe(
				"Not accepted. Human review is recorded by a person, and asking " +
					"for it here is refused with a reason.",
			)
			.optional(),
	});
}

function toolResult(text: string, details: Record<string, unknown>): ToolResult {
	return { content: [{ type: "text", text }], details };
}

/** A tool argument as a usable string, or absent. Empty is absent. */
function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The harness's answer in our vocabulary.
 *
 * Silence — no `memory`, no `status`, or a `status` that threw — is
 * `unconfirmed`. An answer naming a backend other than `off`, or declaring
 * itself active, is `active`; only an answer that says neither is `off`.
 */
function backendState(status: MemoryStatus | undefined): MemoryBackendState {
	if (!status) return "unconfirmed";
	if (status.active === true) return "active";
	if (status.backend && status.backend !== "off") return "active";
	return "off";
}

/**
 * Wires the Assembler into the harness.
 *
 * Everything of consequence lives behind this function: reconstruction,
 * assembly, retrieval, and accounting are pure or injected, so this adapter is
 * the only code that knows the harness exists.
 */
export function register(pi: ExtensionAPI, deps: Dependencies): void {
	/**
	 * What the harness's own memory backend was doing, as of this
	 * Conversation's start. Unconfirmed until it has answered, because that
	 * is what it is: nothing has said the invariant holds.
	 */
	let memoryBackend: MemoryBackendState = "unconfirmed";
	const measuredByConversation = new Map<string, number>();
	/** One ingest-and-embed sweep per Conversation at a time. */
	const sweeping = new Map<string, Promise<void>>();
	/** The sweep waiting behind a running one, which later requests join. */
	const queued = new Map<string, QueuedSweep>();
	/** The Conversation the command inspects: whichever one is running. */
	let lastConversation = UNKNOWN_CONVERSATION;
	/** Said once a session: a model swap is a condition, not a per-Turn event. */
	let swapReported = false;
	/**
	 * Why the harness says it started the compaction now in flight: set by
	 * `auto_compaction_start` and consumed by `session_before_compact`. Also
	 * cleared when the compaction ends, in case one started but never asked,
	 * so a later manual compaction is not taken for it. Absent for a manual
	 * compaction.
	 */
	let compactionTrigger: string | undefined;
	/**
	 * Whether the window the harness last sent was a Pack. A failed assembly
	 * sends the harness's own history, and then the harness's measurement of
	 * it is the right one. True at every session start: the pre-prompt check
	 * of a resumed Conversation runs before its first Call has had a chance
	 * to fail.
	 */
	let governing = true;
	/** Said once a Conversation: the harness keeps trying on every Call. */
	let compactionDeclineReported = false;
	/** Conversations already told their packs are approaching the ceiling. */
	const warnedNearCeiling = new Set<string>();
	/** Said once a session: a Codebase with no graph is a condition, not an event. */
	let missingGraphReported = false;
	/** Said once a session: graphify will refuse every refresh until someone acts. */
	let sizeCapReported = false;
	/**
	 * The launch of the refresh this session asked for last, so ending the
	 * session can let it start. Never the run itself: that outlives us.
	 */
	let lastLaunch: Promise<void> | undefined;
	/** Said once: a store not set up is a condition, not an event. */
	let setupAnnounced = false;
	/** Said once: an index mid-swap is a condition, not a per-Call event. */
	let unsearchedConceptsReported = false;
	/** The whole-bundle indexing pass, so authoring can wait rather than race it. */
	let indexingBundle: Promise<void> | undefined;
	/**
	 * The UI of the handler in flight, captured so a condition raised deep in
	 * assembly can reach the harness's status line. Absent in headless and
	 * print runs, where the log is the only channel.
	 */
	let ui: HandlerContext["ui"];
	/**
	 * The relevance judge for this session, built from the key the host
	 * resolved at session start. Absent means no key: the search is
	 * distance alone, as it was before judging existed.
	 */
	let judge: RelevanceJudge | undefined;
	/** Set by a 401: the same key would be refused again, so it is not sent. */
	let judgeRejected = false;
	/** Said once a session, just before Turn text first leaves the machine. */
	let judgeDisclosed = false;
	/**
	 * The Pins the Conversation's Journal held when last replayed. The
	 * Journal is the truth and is replayed before every use; this is what a
	 * branch is compared against, because by then the Journal it came from
	 * is gone.
	 */
	let held = replayPins([]);
	/** Said once a session: a harness without the Journal surface stays without it. */
	let pinsUnavailableReported = false;

	/**
	 * The Conversation's Journal as the Pins need it: read whole, written
	 * at the leaf. Absent where the harness offers either half without the
	 * other, so nothing is written that could not be read back.
	 */
	function pinJournal(
		session: SessionView | undefined,
	): { read: () => PinState; write: (event: PinEvent) => void } | undefined {
		// Called as methods: the harness's session manager and API are class
		// instances, so a detached method would lose `this`.
		if (!pi.appendEntry || !session?.getEntries) return undefined;
		return {
			read: () => replayPins(session.getEntries?.() ?? []),
			write: (event) => pi.appendEntry?.(PIN_ENTRY, event),
		};
	}

	/** The Pins the Conversation's Journal holds; none where it cannot be listed. */
	function pinsOf(session: SessionView | undefined): PinState {
		return pinJournal(session)?.read() ?? replayPins([]);
	}

	/**
	 * Says on the footer that Pins are held, and whether the last Call
	 * carried them. Cleared when there are none, so a Conversation without
	 * Pins shows nothing.
	 */
	function showPins(target: HarnessUI | undefined): void {
		if (held.pins.length === 0) {
			target?.setStatus?.(PIN_STATUS, undefined);
			return;
		}
		const unsent = governing ? "" : " — not sent";
		target?.setStatus?.(
			PIN_STATUS,
			`pinned: ${held.pins.length} (~${pinTokens(held.pins)} tok)${unsent}`,
		);
	}

	/**
	 * Neither accounting nor ingest may delay the model request, so their
	 * writes are started and not awaited. Failures are reported.
	 */
	function inBackground(what: string, work: Promise<void>): void {
		const reported = work.catch((error: unknown) => {
			deps.report(`${what} failed: ${describe(error)}`);
		});
		// Handed to whoever is watching — the tests — so background work is
		// awaitable without a timer. Nothing waits on it in production.
		deps.background?.(reported);
	}

	/**
	 * Says so once when a Conversation's packs start crowding the ceiling,
	 * and every time one cannot be brought under it at all.
	 *
	 * The approach is reported once: the condition persists for as long as
	 * the work does, and a line per model request is a line nobody reads. An
	 * overrun is reported every time, because it means a Call went out larger
	 * than the operator asked for and only the prompt kept it that way.
	 *
	 * Measured against the ceiling rather than the model's window because the
	 * harness reports the size of each window it sent and never the model's
	 * maximum.
	 */
	function warnIfNearCeiling(conversationId: string, pack: Pack): void {
		if (pack.ceiling <= 0) return;

		if (pack.approximateTokens > pack.ceiling) {
			announce(
				`Context Pack exceeds its ceiling: ~${pack.approximateTokens} of ` +
					`${pack.ceiling} tokens. The current turn could not be reduced ` +
					`further and is never dropped, so the pack went out over budget.`,
			);
			return;
		}

		if (warnedNearCeiling.has(conversationId)) return;
		if (pack.approximateTokens < pack.ceiling * deps.config.packWarnShare) return;
		warnedNearCeiling.add(conversationId);
		const share = Math.round((100 * pack.approximateTokens) / pack.ceiling);
		announce(
			`Context Packs are approaching their ceiling: ~${pack.approximateTokens} ` +
				`of ${pack.ceiling} tokens (${share}%). Parts will start being reduced; ` +
				`\`pack\` shows what, and \`pack budget pack <n>\` raises the ceiling ` +
				`for this session.`,
		);
	}

	/**
	 * Reports without putting the Turn at risk.
	 *
	 * Used by everything that reports from the `context` path: nothing that
	 * path has to say is worth the Call it is serving, so a reporter that
	 * throws must not turn an observation about a pack — or a Store that was
	 * unavailable — into a failed assembly. Reports from session start,
	 * shutdown and the commands keep using `deps.report` directly, where a
	 * throw belongs to the caller that asked.
	 */
	function reportSafely(message: string): void {
		try {
			deps.report(message);
		} catch {
			// Nowhere left to report a reporting failure.
		}
	}

	/**
	 * A condition the operator can act on. Recorded like every other report,
	 * and also raised once on the harness's status line when it offers one, so
	 * it is seen without opening the log. `notify` is the same seam the
	 * commands use; when a handler has no UI this degrades to the log alone.
	 */
	function announce(message: string): void {
		reportSafely(message);
		ui?.notify?.(message, "warning");
	}

	pi.on("session_start", async (_event, ctx) => {
		ui = ctx.ui;
		governing = true;
		held = pinsOf(ctx.sessionManager);
		showPins(ui);
		// Said once: without the Journal surface every Pack goes out with no
		// Pins, which must not look like a Conversation that holds none.
		if (!pinJournal(ctx.sessionManager) && !pinsUnavailableReported) {
			pinsUnavailableReported = true;
			deps.report(PINS_UNAVAILABLE);
		}
		compactionDeclineReported = false;
		// A setting silently ignored is a setting someone believes is in
		// force; retention in particular would be believed to be bounding a
		// Store it never touched.
		for (const problem of deps.config.problems) announce(problem);
		// Before setup there is no store and none was guessed at. Said where
		// it is seen, once: a resumed session starts again, and the fix is
		// the same command either way.
		if (deps.config.storeOrigin === "unset" && !setupAnnounced) {
			setupAnnounced = true;
			announce(
				"The Thread Store is not set up, so nothing is recorded or recalled. " +
					"Run `/pi-chart setup`.",
			);
		}

		// Resolved whether or not judging is on, so `pi-chart judge auto`
		// can turn it on mid-session. Resolving contacts nobody; only a
		// judged search sends anything.
		judge = deps.judgeWith ? await resolveJudge(ctx, deps.judgeWith) : undefined;
		judgeRejected = false;
		judgeDisclosed = false;

		if (deps.specs && deps.config.specsVerify) {
			const specs = deps.specs;
			const codebase = deps.codebase ?? process.cwd();
			// Read-only, and quiet unless a tree exists and is wrong. A
			// Codebase with no OpenSpec tree is not spec-driven, which is
			// its business; `specs` answers on demand.
			inBackground(
				"Spec Store verification",
				(async () => {
					const tree = await specs.verify(codebase);
					if (!tree.absent && !tree.conforming) {
						deps.report(describeTree(tree));
					}
				})(),
			);
		}

		if (deps.graph && deps.config.graphExtract) {
			// A run that ended after its session did was seen by nobody.
			inBackground("Graph Store extraction", reportExtractionFailure());
			// Background, like Doc Store indexing: extracting a Codebase is
			// seconds to minutes of work a first prompt must not wait for.
			extract();
		}

		if (deps.graph && deps.config.graphSymbols > 0) {
			// Read now, so the first Call finds the graph read rather than
			// waiting on a read of hundreds of megabytes. The Call that needs
			// the graph reports a failure; saying it here too says it twice.
			inBackground(
				"Graph Store read",
				deps.graph.graph(deps.codebase ?? process.cwd()).then(
					() => undefined,
					() => undefined,
				),
			);
		}

		if (deps.docs && deps.bundle) {
			const docs = deps.docs;
			const bundle = deps.bundle;
			const ready = deps.ready;
			// Indexing is background work: a session must not wait on the
			// bundle to send its first prompt. It does have to wait for the
			// schema, which is migrated concurrently at startup.
			//
			// Kept, because a Concept written while this is still running
			// would be pruned as absent from the snapshot this pass took, or
			// overwritten with the text that snapshot held. Authoring waits
			// for it rather than racing it.
			indexingBundle = (async () => {
				await ready;
				const concepts = await bundle();
				// No bundle is nothing to do, not a failure: most machines
				// have no curated knowledge yet.
				if (!concepts) return;
				const { contested } = await docs.indexConcepts(concepts);
				for (const conceptId of contested) {
					deps.report(
						`${conceptId} shares its identity with another concept ` +
							`and was not indexed`,
					);
				}
			})();
			inBackground("Doc Store indexing", indexingBundle);
		}

		// Asked once, here, and remembered: the answer cannot change within a
		// Conversation, `pi-chart` runs long after this with no way to
		// ask the harness itself, and every Call records what was observed.
		//
		// A `status` that throws is silence, not an answer — the same rule the
		// Spec Store applies to a missing CLI. An invariant that cannot be
		// checked is unknown, and treating it as off would certify a window
		// nobody looked at (ADR-0003).
		let status: MemoryStatus | undefined;
		try {
			status = await ctx.memory?.status?.();
		} catch {
			status = undefined;
		}
		memoryBackend = backendState(status);
		if (memoryBackend === "unconfirmed") {
			deps.report(
				"The harness does not report its memory backend, so it cannot be " +
					"confirmed off. Two systems injecting recall into one window " +
					"makes a bad pack impossible to diagnose. Every call of this " +
					"conversation is recorded as unconfirmed, not as clean.",
			);
		} else if (memoryBackend === "active") {
			announce(
				`The harness memory backend is active (${status?.backend ?? "unknown"}). ` +
					"It injects recall into the system prompt, which the assembler " +
					"cannot reach, so this window has two injectors in it; set " +
					"`memory: {backend: off}` in ~/.omp/agent/config.yml. Every call " +
					"of this conversation is recorded as active.",
			);
		}
	});

	pi.on("context", async (event, ctx) => {
		ui = ctx.ui;
		const conversationId = conversationOf(ctx);
		lastConversation = conversationId;
		const branch = ctx.sessionManager?.getBranch?.() ?? [];
		const messages = withoutNativeCompaction(event.messages ?? []);
		const address = addressOf(branch, messages);

		reconcile(conversationId, branch);

		try {
			// Inside the fail-open path: a Journal that cannot be listed costs
			// this Call its Pack, never the Call.
			held = pinsOf(ctx.sessionManager);
			const live = positioned(reconstructTurns(messages), address.turnIndex);
			const current = live[live.length - 1];

			// The current Turn always comes from the event: the Journal has not
			// been flushed for it yet, and reading our own write would race.
			const { tail, tailSource } = await tailFor(
				conversationId,
				live,
				deps.config.tailTurns,
			);

			// All three retrievals at once: none depends on another, and a
			// Call should not pay for them in series.
			const [recalled, concepts, structure] = await Promise.all([
				recallFor(conversationId, current),
				conceptsFor(current),
				structureFor(current),
			]);

			const pack = deps.assemble(
				{
					turns: current ? [...tail, current] : tail,
					supplied: messages,
					recalled: recalled.value.turns,
					rejected: recalled.value.rejected,
					recallMisses: recalled.value.misses,
					unsearched: recalled.value.unsearched,
					concepts: concepts.value.hits,
					conceptsRejected: concepts.value.rejected,
					conceptMisses: concepts.value.misses,
					conceptsUnsearched: concepts.value.unsearched,
					structure: structure.value,
					pins: held.pins,
					unavailable: {
						recalled: recalled.unavailable,
						curated: concepts.unavailable,
						structure: structure.unavailable,
					},
				},
				assemblerConfig(deps.config),
			);

			warnIfNearCeiling(conversationId, pack);

			inBackground(
				"Accounting",
				// The state rides the write that already happens off the
				// request path: the model waits for none of it.
				deps.accounting.recordPack(
					conversationId,
					address,
					pack,
					tailSource,
					memoryBackend,
				),
			);

			governing = true;
			showPins(ui);
			return { messages: pack.messages };
		} catch (error) {
			// Fails open, toward the accumulating window this exists to prevent,
			// so every occurrence is reported and the Call is marked unassembled
			// rather than vanishing from the accounting. The harness's history
			// is what goes out now, so its own compaction is left to it.
			governing = false;
			showPins(ui);
			reportSafely(`Assembly failed, turn left unassembled: ${describe(error)}`);
			inBackground(
				"Unassembled turn",
				deps.accounting.recordUnassembled(
					conversationId,
					address,
					memoryBackend,
				),
			);
			return undefined;
		}
	});

	// `/new` and resume open another Conversation, which holds only what its
	// own Journal says. A whole-session fork copied every entry, so it
	// replays equal and nothing needs writing either.
	pi.on("session_switch", async (_event, ctx) => {
		ui = ctx.ui;
		held = pinsOf(ctx.sessionManager);
		showPins(ui);
	});

	// A branch, a fork at an entry and `/btw` promotion copy only the path
	// to the leaf, which misses a Pin added after the leaf moved and keeps
	// one removed off it. Where the copy disagrees with what the parent
	// held, the parent's state is written into the new Journal, once; from
	// then on the two hold their Pins independently.
	pi.on("session_branch", async (_event, ctx) => {
		ui = ctx.ui;
		const journal = pinJournal(ctx.sessionManager);
		const copied = journal?.read() ?? replayPins([]);
		if (journal && !sameState(copied, held)) {
			journal.write({ op: "snapshot", pins: held.pins, nextId: held.nextId });
		} else {
			held = copied;
		}
		showPins(ui);
	});

	pi.on("auto_compaction_start", async (event, ctx) => {
		ui = ctx.ui;
		compactionTrigger = event.reason;
	});

	pi.on("auto_compaction_end", async (_event, ctx) => {
		ui = ctx.ui;
		compactionTrigger = undefined;
	});

	// The harness decides to compact by measuring its whole history, which
	// the Pack replaced, so its threshold fires on a window the model never
	// receives, and remote compaction then pays a Call over that history.
	// An overflow, a manual compaction, and a compaction after an unassembled
	// Call are about the window actually sent, and proceed.
	pi.on("session_before_compact", async (_event, ctx) => {
		ui = ctx.ui;
		const trigger = compactionTrigger;
		compactionTrigger = undefined;
		if (!governing || (trigger !== "threshold" && trigger !== "idle")) {
			return undefined;
		}
		if (!compactionDeclineReported) {
			compactionDeclineReported = true;
			announce(
				`Declined the harness's ${trigger} compaction: it measures the whole ` +
					"conversation, not the Context Pack sent in its place. Set " +
					"`compaction: {enabled: false}` in ~/.omp/agent/config.yml so it " +
					"stops trying on every call; an overflow still compacts either way.",
			);
		}
		return { cancel: true };
	});

	pi.on("agent_end", async (_event, ctx) => {
		ui = ctx.ui;
		const conversationId = conversationOf(ctx);
		reconcile(conversationId, ctx.sessionManager?.getBranch?.() ?? []);
		// The Turn that just finished is the Turn that may have edited the
		// Codebase, so this is where a graph frozen at session start stops
		// being frozen. Notification-only and in the background, so nothing
		// the user waits on grows; extraction is content-hash incremental,
		// so an unchanged tree costs a scan rather than a build.
		if (deps.config.graphExtract) {
			inBackground("Graph Store extraction", reportExtractionFailure());
			extract();
		}
		await store(conversationId, leafOf(ctx));
	});

	/**
	 * Asks for the Codebase's graph to be brought up to date, off the
	 * request path. The extraction runs detached and may outlive this
	 * session; its failure is reported here if it ends while the session is
	 * open, and by the next session otherwise.
	 */
	function extract(): void {
		const graph = deps.graph;
		if (!graph) return;
		const launching = graph.refresh(deps.codebase ?? process.cwd());
		lastLaunch = launching.then(
			() => undefined,
			() => undefined,
		);
		inBackground(
			"Graph Store extraction",
			launching.then((launch) => {
				inBackground(
					"Graph Store extraction",
					launch.finished.then(reportExtractionFailure),
				);
			}),
		);
	}

	/**
	 * Says how the last extraction failed, if it did and no session has said
	 * so yet. A graph over graphify's size cap is announced once a session:
	 * every later refresh is refused the same way until someone acts.
	 */
	async function reportExtractionFailure(): Promise<void> {
		const graph = deps.graph;
		if (!graph) return;
		const failure = await graph.takeFailure(deps.codebase ?? process.cwd());
		if (!failure) return;
		if (failure.kind !== "size-cap") {
			deps.report(`Graph Store extraction failed: ${failure.message}`);
			return;
		}
		if (sizeCapReported) return;
		sizeCapReported = true;
		announce(failure.message);
	}

	// `agent_end` is notification-only: the harness does not wait for it, so a
	// headless run can exit mid-ingest. `session_shutdown` is awaited, which
	// makes it the sweep that guarantees a Turn is stored before exit.
	pi.on("session_shutdown", async (_event, ctx) => {
		// Cleanup in `finally`: a final sweep that throws must still give
		// back what the session took. Measured — a session that never
		// released its pool held 200 sockets after 16.5 hours, and the
		// Store then refused every new client.
		try {
			await store(conversationOf(ctx), leafOf(ctx));
			// The refresh the last Turn asked for, given the chance to
			// start: measured on a headless run, a process that exited
			// first left the graph older than the edit that Turn made. Its
			// run is not waited for; it outlives the session by design.
			await lastLaunch;
			await retire();
		} finally {
			await deps.close?.();
		}
	});

	// `/tree` and `/branch` move the leaf inside the same Journal. Turns past
	// where the branch left and the branch taken part are no longer on it, so
	// the store lets them go and takes the branch's own before the next Call
	// reads its tail.
	pi.on("session_tree", async (event, ctx) => {
		ui = ctx.ui;
		// The whole file holds the Pins, not the branch, so a move inside
		// it changes none; the status is refreshed all the same.
		held = pinsOf(ctx.sessionManager);
		showPins(ui);
		const sink = deps.ingest;
		if (!sink) return;
		const conversationId = conversationOf(ctx);
		const branchTo = ctx.sessionManager?.getBranch;
		const left = event.oldLeafId ? (branchTo?.(event.oldLeafId) ?? []) : [];
		const taken = branchTo?.() ?? [];
		const leafId = taken.at(-1)?.id;
		// After a sweep already reading the Journal, so it cannot write the
		// abandoned Turns after them; and registered as one, so a sweep
		// starting meanwhile waits for it instead. A sweep queued before the
		// rewind still runs before it, so later requests queue anew.
		const running = sweeping.get(conversationId);
		queued.delete(conversationId);
		const rewind: Promise<void> = (async () => {
			await running;
			try {
				await sink.rewind(conversationId, rewoundFrom(left, taken));
				// No leaf: the branch is empty, and a Journal read without
				// one would follow the last entry written, the branch left.
				if (leafId) await ingestJournal(conversationId, sink, deps.codebase, leafId);
			} catch (error) {
				reportSafely(`Rewind failed; the store may hold an abandoned branch: ${describe(error)}`);
			}
		})().finally(() => release(conversationId, rewind));
		sweeping.set(conversationId, rewind);
		await rewind;
	});

	/**
	 * Retires Turns older than the configured age. Never on a request's
	 * path, and never at all unless someone asked for it: how long the
	 * Store keeps a Turn is their policy, not this project's default.
	 */
	async function retire(): Promise<void> {
		const age = deps.config.retainDays;
		if (!deps.retire || age === undefined) return;
		try {
			const retired = await deps.retire(age);
			if (retired > 0) {
				deps.report(
					`Retention removed ${retired} turn${retired === 1 ? "" : "s"} ` +
						`older than ${age} day${age === 1 ? "" : "s"}. ` +
						`Their accounting is kept.`,
				);
			}
		} catch (error) {
			deps.report(`Retention failed: ${describe(error)}`);
		}
	}

	/**
	 * Ingests and embeds. Runs after a response, never before a request.
	 *
	 * One sweep per Conversation at a time: `agent_end` and `session_shutdown`
	 * overlap on a short run, and two concurrent passes would select the same
	 * unembedded rows and embed them twice. A request arriving while a sweep
	 * runs queues one more after it, since the running one may have read the
	 * Journal before the Turn that asked had been written; requests arriving
	 * while that one waits join it, at the newest leaf asked for.
	 */
	function store(conversationId: string, leafId?: string): Promise<void> {
		const waiting = queued.get(conversationId);
		if (waiting) {
			waiting.leafId = leafId;
			return waiting.sweep;
		}

		const running = sweeping.get(conversationId);
		if (!running) {
			const sweep: Promise<void> = runSweep(conversationId, leafId).finally(() =>
				release(conversationId, sweep),
			);
			sweeping.set(conversationId, sweep);
			return sweep;
		}

		const next: QueuedSweep = { leafId, sweep: Promise.resolve() };
		next.sweep = (async () => {
			await running.catch(() => undefined);
			if (queued.get(conversationId) === next) queued.delete(conversationId);
			await runSweep(conversationId, next.leafId);
		})().finally(() => release(conversationId, next.sweep));
		queued.set(conversationId, next);
		sweeping.set(conversationId, next.sweep);
		return next.sweep;
	}

	/** Ends a Conversation's turn in `sweeping`, unless another took it over. */
	function release(conversationId: string, work: Promise<void>): void {
		if (sweeping.get(conversationId) === work) sweeping.delete(conversationId);
	}

	async function runSweep(conversationId: string, leafId?: string): Promise<void> {
		if (!deps.ingest) return;
		let ingested: JournalTurn[] | undefined;
		try {
			ingested = await ingestJournal(conversationId, deps.ingest, deps.codebase, leafId);
		} catch (error) {
			deps.report(`Ingest failed: ${describe(error)}`);
			return;
		}
		reportModelSwap();
		// Its own phase, and its own failure: a diagnostic figure that
		// cannot be written must not stop recall catching up, and must not
		// be reported as an ingest that failed. Only what ingest just
		// stored is walked, so a sweep over an unchanged Conversation still
		// costs what ticket 3 measured — nothing.
		if (ingested) {
			try {
				await deps.accounting.recordCosts(
					conversationId,
					measurementsOfJournal(ingested),
				);
			} catch (error) {
				deps.report(`Recording what calls cost failed: ${describe(error)}`);
			}
		}
		try {
			await deps.embed?.(conversationId);
		} catch (error) {
			deps.report(`Embedding failed: ${describe(error)}`);
		}
	}

	/**
	 * Says so, once, when the store holds vectors from another model.
	 *
	 * Loud is reserved for the condition, not for each Turn it affects: the
	 * Turns concerned are simply not recalled until the background pass has
	 * re-embedded them, and a swap nobody is told about looks like recall
	 * quietly getting worse.
	 */
	function reportModelSwap(): void {
		const check = deps.vectorModels;
		if (swapReported || !check) return;
		swapReported = true;
		inBackground(
			"Embedding model check",
			(async () => {
				const { inUse, others } = await check();
				if (others.length === 0) return;
				const named = others
					.map((each) => `${each.turns} from ${each.model}`)
					.join(", ");
				announce(
					`Embedding model in use is ${inUse}, but the store holds vectors ` +
						`${named}. Those turns are not recalled until the background ` +
						`pass has re-embedded them.`,
				);
			})(),
		);
	}

	/**
	 * The verbatim tail, from the store when it can be reached. Falling back to
	 * the harness's own history is a worse pack, not a broken Turn — and it is
	 * recorded, so a session spent on fallback is visible afterwards.
	 *
	 * The store lags the harness: ingest runs after `agent_end`, which the
	 * harness does not wait for, so a quick reply opens a Turn before the one
	 * it answers is stored. Turns the harness sent that are newer than the
	 * store's newest are taken from the harness, or the question being
	 * answered is missing from the window.
	 */
	async function tailFor(
		conversationId: string,
		live: Turn[],
		tailTurns: number,
	): Promise<{ tail: Turn[]; tailSource: TailSource }> {
		const completed = live.slice(0, -1);
		const fallback = {
			tail: completed,
			tailSource: "harness-fallback" as const,
		};
		try {
			const stored = await inTime(
				"Thread Store",
				deps.config.tailDeadlineMs,
				deps.turns.recentTurns(conversationId, tailTurns),
			);
			// A Store that ran out of time is a Store that is not there for
			// this Call: the harness still has the history, and the fallback
			// is recorded exactly as an unreachable Store's is.
			if (!stored.answered) return fallback;
			if (stored.value.length > 0) {
				const newest = stored.value.at(-1)?.index;
				const unstored =
					newest === undefined
						? []
						: completed.filter(
								(turn) => turn.index !== undefined && turn.index > newest,
							);
				return { tail: [...stored.value, ...unstored], tailSource: "thread-store" };
			}
		} catch (error) {
			reportSafely(`Thread Store unreachable, using harness history: ${describe(error)}`);
			return fallback;
		}
		// An empty store is not a failure: a Conversation's first Turns predate
		// any ingest, and the harness still has them.
		return fallback;
	}

	/**
	 * A Store call, bounded.
	 *
	 * A Store that accepts the request and never answers costs its part,
	 * not the Turn: the wait is bounded by configuration rather than by the
	 * slowest Store, and running out of time is reported in its own words
	 * so it reads differently from a Store that refused the connection —
	 * the two call for different remedies.
	 */
	async function inTime<T>(
		store: string,
		deadlineMs: number,
		work: Promise<T>,
	): Promise<{ answered: true; value: T } | { answered: false }> {
		if (deadlineMs <= 0) return { answered: true, value: await work };

		const expired = Symbol("deadline");
		const first = await Promise.race([
			work,
			(deps.after ?? sleep)(deadlineMs).then(() => expired),
		]);
		if (first === expired) {
			// Nobody is waiting on the Store's answer now, so a late failure
			// must not surface as an unhandled rejection.
			void work.catch(() => undefined);
			reportSafely(
				`${store} did not answer within ${deadlineMs}ms; ` +
					`pack assembled without its part`,
			);
			return { answered: false };
		}
		return { answered: true, value: first as T };
	}

	if (pi.registerTool && deps.search) {
		pi.registerTool({
			name: "recall_across_conversations",
			label: "Recall across conversations",
			description:
				"Search every recorded conversation for turns relevant to a query. " +
				"Use when the current conversation does not hold the answer and it " +
				"may have been decided elsewhere. Results say which conversation " +
				"and codebase they came from.",
			parameters: pi.zod?.object({
				query: pi.zod.string().describe("What to look for"),
				limit: pi.zod.number().describe("Most results to return").optional(),
			}),
			execute: (_id, params) => searchCorpus(params),
		});
	}

	if (pi.registerTool && deps.walk) {
		pi.registerTool({
			name: "walk_documentation",
			label: "Walk the documentation bundle",
			description:
				"Read what the curated documentation bundle holds: a level's " +
				"sub-levels and the concepts directly in it, each with its " +
				"description, or one named concept in full. Use when you need " +
				"the shape of what is documented rather than whatever a prompt " +
				"happened to retrieve. Costs no context budget.",
			parameters: pi.zod?.object({
				level: pi.zod
					.string()
					.describe("Level to read; omit for the top of the bundle")
					.optional(),
				concept: pi.zod
					.string()
					.describe(
						"Concept id from a listing, to read in full. Takes " +
							"precedence over level when both are given.",
					)
					.optional(),
			}),
			execute: (_id, params) => walkBundle(params),
		});
	}

	if (pi.registerTool && deps.author) {
		pi.registerTool({
			name: "write_documentation",
			label: "Write to the documentation bundle",
			description:
				"Record a conclusion in the curated documentation bundle as a " +
				"concept, or revise one that is already there. Use when " +
				"something settled is worth keeping beyond this conversation. " +
				"What you write enters as an unverified draft, recorded as " +
				"machine-written: human review is not something this tool can " +
				"record, and asking for it is refused. Creating refuses an " +
				"identifier the bundle already holds and revising refuses one " +
				"it does not; a revision keeps every field it does not name.",
			parameters: writeSchema(pi.zod),
			execute: (_id, params) => writeConcept(params),
		});
	}

	/**
	 * Records a conclusion as a Concept, and brings the index in line with
	 * it before the tool returns.
	 *
	 * Indexed here rather than in the background: the point of writing from
	 * inside a Conversation is that the next Call can retrieve what was
	 * written, and a background pass would land after it. The embed is one
	 * Concept's worth, on the tool's own Call.
	 */
	async function writeConcept(
		params: Record<string, unknown>,
	): Promise<ToolResult> {
		const author = deps.author;
		if (!author) return toolResult("No documentation bundle is configured.", {});

		const id = text(params.id);
		const mode = params.mode === "revise" ? "revise" : "create";
		if (id === undefined) {
			return toolResult("An id is required to write a concept.", {
				failed: true,
			});
		}

		let outcome: WriteOutcome;
		try {
			outcome = await author.write({
				id,
				mode,
				type: text(params.type),
				title: text(params.title),
				summary: text(params.summary),
				body: text(params.body),
				exclusions: params.not === undefined
					? undefined
					: readExclusions(params.not),
				sources: params.sources === undefined
					? undefined
					: readSources(params.sources),
				verified: params.verified,
			});
		} catch (error) {
			const reason = describe(error);
			deps.report(`Writing to the bundle failed: ${reason}`);
			return toolResult(`Could not write ${id}: ${reason}`, { failed: true });
		}

		const written = outcome.written;
		if (!written) {
			return toolResult(outcome.refused, { refused: true });
		}

		// The bundle is the record; the index is derived from it. A Concept
		// that was written but could not be indexed is kept and said to be
		// unretrievable until the next session start reconciles it.
		let indexed = "";
		if (deps.docs) {
			try {
				// After the whole-bundle pass, never beside it: that pass
				// prunes what its own snapshot did not hold, and this Concept
				// was written after the snapshot was taken.
				await indexingBundle?.catch(() => undefined);
				await deps.docs.indexConcept(written);
				indexed = " It is retrievable from the next call onwards.";
			} catch (error) {
				const reason = describe(error);
				deps.report(`Indexing ${written.id} failed: ${reason}`);
				indexed =
					` It could not be indexed (${reason}), so it is in the bundle ` +
					`but not yet retrievable.`;
			}
		}

		return toolResult(
			`Wrote ${written.id} as a ${written.status} concept, unverified and ` +
				`recorded as machine-written.${indexed}`,
			{ concept: written.id, status: written.status },
		);
	}

	/**
	 * The bundle as the agent walks it: a Level, or one Concept opened from
	 * one. Reads only; the Context Pack is untouched by it, which is what
	 * keeps assembly independent of what the agent chose to look at.
	 */
	async function walkBundle(
		params: Record<string, unknown>,
	): Promise<ToolResult> {
		// Narrowed rather than declared: these arrive as the model's JSON,
		// and a number reaching the filesystem blames the bundle for a bad
		// argument.
		const asked = {
			level: text(params.level),
			concept: text(params.concept),
		};
		const walk = deps.walk;
		if (!walk) return toolResult("No documentation bundle is configured.", {});

		try {
			// A Concept wins when both are given, which the tool says.
			if (asked.concept !== undefined) {
				const concept = await walk.open(asked.concept);
				if (!concept) {
					// Absence is its own answer: "you guessed a name", not
					// "something is here and it is broken".
					return toolResult(`No concept called ${asked.concept}.`, {
						missing: asked.concept,
					});
				}
				if (!concept.conformant) {
					// Served empty, a broken Concept reads as a Concept with
					// nothing to say — the opposite of what it means.
					return toolResult(
						`${concept.id} cannot be read as a concept: ` +
							`${concept.problem ?? "no reason recorded"}.`,
						{ concept: concept.id, broken: true },
					);
				}
				return toolResult(renderConcept(concept), { concept: concept.id });
			}

			const path = asked.level ?? "";
			const level = await walk.list(path);
			if (!level) {
				// Absent and empty mean opposite things: "you guessed a
				// name" and "this part of the corpus is empty". And a
				// named level missing because there is no bundle is a
				// third thing again — otherwise the agent keeps guessing
				// names against nothing.
				const noBundle =
					path === "" || (await walk.list("")) === undefined;
				return toolResult(
					noBundle
						? "No documentation bundle on this machine."
						: `No level called ${path}.`,
					{ missing: path },
				);
			}
			return toolResult(renderLevel(level), { level: level.path });
		} catch (error) {
			const reason = describe(error);
			// The person running the session can act on an unreadable
			// bundle; the model cannot.
			deps.report(`Walking the bundle failed: ${reason}`);
			return toolResult(`Could not read the bundle: ${reason}`, {
				failed: true,
			});
		}
	}

	/**
	 * The wider search, as the agent sees it. A failure is the search's
	 * outcome rather than the Turn's: the agent asked a question and needs
	 * an answer it can act on.
	 */
	async function searchCorpus(
		params: Record<string, unknown>,
	): Promise<ToolResult> {
		const query = params.query;
		if (typeof query !== "string" || query.trim().length === 0) {
			// Searching for nothing would return whatever happens to fall
			// under the threshold, which is exactly the weak result the
			// threshold exists to prevent.
			return toolResult("A query is required to search.", { failed: true });
		}

		const asked = typeof params.limit === "number" ? Math.floor(params.limit) : 0;
		const limit = Math.min(
			Math.max(asked > 0 ? asked : DEFAULT_SEARCH_RESULTS, 1),
			MAX_SEARCH_RESULTS,
		);

		// With a judge, the whole ceiling is fetched and judged in one
		// parallel round, so a refusal among the nearest is replaced from
		// further down without a second round trip.
		const judging = judgeInForce();
		let found: FoundTurn[];
		try {
			found = await (deps.search?.searchAll(
				query,
				judging ? MAX_SEARCH_RESULTS : limit,
				deps.config.recallMaxDistance,
			) ?? Promise.resolve([]));
		} catch (error) {
			const reason = describe(error);
			deps.report(`Cross-conversation search failed: ${reason}`);
			return toolResult(`The search could not run: ${reason}`, { failed: true });
		}

		// Nothing admitted is nothing to send: no request, no disclosure.
		if (!judging || found.length === 0) {
			return searchResult(found.slice(0, limit), { judged: false });
		}

		const verdict = await judgeAll(judging, query, found);
		if ("unjudged" in verdict) {
			// Wholly unjudged rather than half: a result mixing two
			// standards under one heading could not be read by either.
			return searchResult(found.slice(0, limit), { judged: false, ...verdict });
		}
		const kept = found.filter((_hit, at) => verdict.scores[at]! >= JUDGE_THRESHOLD);
		return searchResult(kept.slice(0, limit), {
			judged: true,
			refused: found.length - kept.length,
		});
	}

	/** The judge, when this session may use it; otherwise the search is distance alone. */
	function judgeInForce(): RelevanceJudge | undefined {
		return deps.config.judge === "auto" && !judgeRejected ? judge : undefined;
	}

	/**
	 * One verdict per Turn, asked in parallel. Any failure discards them
	 * all and names why; a rejected key also ends judging for the session,
	 * said once, because the same key would be refused again.
	 */
	async function judgeAll(
		using: RelevanceJudge,
		query: string,
		found: FoundTurn[],
	): Promise<{ scores: number[] } | { unjudged: string }> {
		if (!judgeDisclosed) {
			judgeDisclosed = true;
			announce(
				`recall_across_conversations sends each candidate Turn, up to ` +
					`${EMBED_CHARACTERS} characters of it, with the query to ` +
					`${new URL(JEV_ENDPOINT).host} to judge its relevance. Set ` +
					"PICHART_JUDGE=off to stop, or `pi-chart judge off` for this session.",
			);
		}
		try {
			const scores = await Promise.all(
				found.map((hit) => using.judge(query, embedText(hit.turn.messages))),
			);
			return { scores };
		} catch (error) {
			const reason = describe(error);
			if (error instanceof JudgeFailure && error.rejected && !judgeRejected) {
				judgeRejected = true;
				announce(
					`The relevance judge rejected the TypeSafe key, so cross-conversation ` +
						"searches are unjudged for the rest of this session. Run " +
						"`/login typesafe` with a valid key, or set PICHART_JUDGE=off.",
				);
			}
			return { unjudged: reason };
		}
	}

	function searchResult(
		found: FoundTurn[],
		judgement: SearchJudgement & { judged: boolean },
	): ToolResult {
		return toolResult(renderSearch(found, judgement), {
			results: found.length,
			conversations: [...new Set(found.map((hit) => hit.conversationId))],
			...judgement,
		});
	}

	if (pi.registerCommand) {
		pi.registerCommand("pi-chart", {
			description:
				"Check what this extension needs and what is missing: " +
				"`pi-chart` to check, `pi-chart setup` to start " +
				"the thread store, `pi-chart judge <auto|off>` to switch " +
				"relevance judging for this session",
			handler: async (args, commandCtx) => {
				const output = await manageInstall(args.trim());
				tell(commandCtx, output);
			},
		});

		pi.registerCommand("specs", {
			description:
				"Check the codebase's OpenSpec tree: `specs` to verify, " +
				"`specs init` to create what is missing",
			handler: async (args, commandCtx) => {
				const text = await checkSpecs(args.trim());
				tell(commandCtx, text);
			},
		});

		pi.registerCommand("pack", {
			description:
				"Inspect the context pack: `pack` for the last call, " +
				"`pack <turn>[.<call>]` for any recorded call, " +
				"`pack why [<address>] <subject>` for why something was not " +
				"carried, `pack diff [<a> <b>]`, `pack summary`, " +
				"`pack budget <tail|recall|docs|graph|" +
				"tail-tokens|recall-tokens|docs-tokens|graph-tokens|pack|" +
				"pins|pins-tokens> <n>`",
			handler: async (args, commandCtx) => {
				const text = await inspect(args.trim());
				tell(commandCtx, text);
			},
		});

		// One command with verbs, like `pack`: the harness owns `/pin`, which
		// pins a session in its resume list.
		pi.registerCommand("pins", {
			description:
				"Text carried whole by every context pack of this conversation: " +
				"`pins` to read them, `pins add <text>` to pin text (`pins add` " +
				"alone opens the editor), `pins rm <id|all>` to remove",
			handler: async (args, commandCtx) => tell(commandCtx, await pins(args, commandCtx)),
		});
	}

	/**
	 * What the installation needs, and the one thing this project can
	 * supply itself. Reporting is the default: starting containers is a
	 * side effect nobody should get from a status check.
	 */
	async function manageInstall(args: string): Promise<string> {
		const install = deps.install ?? new Installation();

		if (args === "setup") {
			const done = await install.setup(deps.config);
			const after = await install.check(
				deps.config,
				memoryBackend,
				deps.graph !== undefined,
			);
			return `${describeChecks(done)}\n\nNow:\n${describeChecks(
				withJudge(await withExtraction(after)),
			)}`;
		}
		const [verb = "", ...rest] = args.split(/\s+/).filter(Boolean);
		if (verb === "judge") return switchJudge(rest.join(" "));
		if (args !== "") {
			return (
				`Unknown command: ${args}. Use \`pi-chart\`, \`pi-chart setup\` ` +
				"or `pi-chart judge <auto|off>`."
			);
		}

		return describeChecks(
			withJudge(
				await withExtraction(
					await install.check(deps.config, memoryBackend, deps.graph !== undefined),
				),
			),
		);
	}

	/**
	 * The codebase graph line, with whether an extraction is running and
	 * how the last one ended. Session state, like the judge's, so it is
	 * added here rather than known to `Installation`.
	 */
	async function withExtraction(checks: Check[]): Promise<Check[]> {
		const graph = deps.graph;
		if (!graph || !deps.config.graphExtract) return checks;
		const said: string[] = [];
		try {
			const state = await graph.extraction(deps.codebase ?? process.cwd());
			if (state.running) said.push(`extracting since ${clock(state.running.since)}`);
			if (state.last) {
				said.push(
					state.last.failure
						? `last run failed: ${state.last.failure}`
						: `last run: ok at ${clock(state.last.endedAt)}`,
				);
			}
		} catch (error) {
			said.push(`run state unknown: ${describe(error)}`);
		}
		if (said.length === 0) return checks;
		return checks.map((check) =>
			check.name === "codebase graph"
				? { ...check, detail: `${check.detail}; ${said.join("; ")}` }
				: check,
		);
	}

	/**
	 * Switches judging for the running session. In memory only, like
	 * `pack budget`: an experiment that silently persisted into tomorrow's
	 * sessions would be a trap. `PICHART_JUDGE` sets the default.
	 */
	function switchJudge(value: string): string {
		if (value !== "auto" && value !== "off") {
			return `Relevance judging unchanged: "${value}" is neither auto nor off.`;
		}
		deps.config.judge = value;
		return describeChecks(withJudge([]));
	}

	/**
	 * The relevance judge's state beside the installation's, where there is
	 * a search to judge. Session state, so it is added here rather than
	 * known to `Installation`.
	 */
	function withJudge(checks: Check[]): Check[] {
		if (!deps.judgeWith) return checks;
		const name = "relevance judge";
		const check: Check =
			deps.config.judge === "off"
				? {
						name,
						ok: true,
						detail: "off; cross-conversation searches are ranked by distance alone",
						fix: "PICHART_JUDGE=auto, or `pi-chart judge auto` for this session",
					}
				: !judge
					? {
							name,
							ok: true,
							detail: "no key; cross-conversation searches are ranked by distance alone",
							fix: "set TYPESAFE_API_KEY or run `/login typesafe` to judge them",
						}
					: judgeRejected
						? {
								name,
								ok: false,
								detail: "key rejected; searches are unjudged for this session",
								fix: "`/login typesafe` with a valid key, or PICHART_JUDGE=off",
							}
						: {
								name,
								ok: true,
								detail: `on (${JEV_MODEL}); candidate turns are sent to ${new URL(JEV_ENDPOINT).host}`,
								fix: "PICHART_JUDGE=off, or `pi-chart judge off` for this session",
							};
		return [...checks, check];
	}

	/**
	 * The Spec Store's whole surface. Initialization is a request and never
	 * a side effect: an `openspec/` tree is a claim about how a project is
	 * run, not a cache that can be recreated.
	 */
	async function checkSpecs(args: string): Promise<string> {
		if (!deps.specs) return "The Spec Store is not configured.";
		const codebase = deps.codebase ?? process.cwd();
		const [verb = "", ...rest] = args.split(/\s+/).filter(Boolean);

		if (verb === "init") {
			if (rest.length > 0) {
				return `Unknown arguments: ${rest.join(" ")}. Use \`specs init\`.`;
			}
			try {
				await deps.specs.initialize(codebase);
			} catch (error) {
				return `Could not initialize: ${describe(error)}`;
			}
			return describeTree(await deps.specs.verify(codebase));
		}
		if (verb !== "") return `Unknown command: ${verb}. Use \`specs\` or \`specs init\`.`;

		const tree = await deps.specs.verify(codebase);
		const lines = [describeTree(tree)];
		if (tree.absent) {
			// Nothing to judge the content of, and OpenSpec would answer
			// with its own "no root here", which reads as a verdict on
			// specs that do not exist.
			lines.push("Run `specs init` to create one.");
			return lines.join("\n");
		}
		if (!tree.conforming) lines.push("Run `specs init` to create what is missing.");

		const content = await deps.specs.diagnose(codebase);
		lines.push(
			content.valid === undefined
				? `Content unchecked: ${content.detail}`
				: content.valid
					? "OpenSpec reports every spec and change valid."
					: content.detail,
		);
		return lines.join("\n");
	}

	/**
	 * The inspector's whole surface, kept out of the harness adapter.
	 *
	 * Any recorded Call is reachable by address — `pack 12`, `pack 12.3` —
	 * because a bad pack is usually noticed several Turns after it went
	 * out, and an inspector that only reads the last two Calls cannot be
	 * asked about it.
	 */
	async function inspect(args: string): Promise<string> {
		const [verb = "", ...rest] = args.split(/\s+/).filter(Boolean);

		if (verb === "budget") {
			const [name = "", value = ""] = rest;
			const result = setBudget(deps.config, name, value);
			return result.ok
				? `Budget ${name} is now ${result.budget}; it applies from the next call.`
				: `Budget unchanged: ${result.reason}`;
		}

		const turns = await deps.accounting.readAccounting(lastConversation);
		const calls = inspectConversation(turns);

		if (verb === "summary") return renderSummary(summarise(lastConversation, turns));

		const latest = calls[calls.length - 1];
		if (!latest) return "Nothing recorded for this conversation yet.";

		/** A named Call, or the words refusing it. */
		const at = (text: string): CallView | string => {
			const address = parseAddress(text);
			if (!address) return `${text} is not a call address; use \`12\` or \`12.3\`.`;
			const call = resolveCall(calls, address);
			// Never the nearest Call instead: an answer about a different
			// Call than the one asked about is the failure addressing
			// exists to remove.
			return (
				call ??
				`No call recorded at ${text}. This conversation has ` +
					`${describeRecorded(calls)}.`
			);
		};

		if (verb === "why") {
			// A subject is required and an address is not, so the first word
			// is only an address when something follows it to be the
			// subject. Otherwise `pack why 4` — a Turn, the commonest
			// question there is — would be read as an address and answered
			// with a usage line.
			const addressed = rest.length > 1 && parseAddress(rest[0] ?? "") !== undefined;
			const call = addressed ? at(rest[0] ?? "") : latest;
			if (typeof call === "string") return call;
			const subject = (addressed ? rest.slice(1) : rest).join(" ");
			if (subject === "") {
				return "Say what to explain: `pack why <subject>` or `pack why 12 <subject>`.";
			}
			return renderExplanation(explain(call, subject));
		}

		if (verb === "diff") {
			const [first, second] = rest;
			if (first !== undefined && second !== undefined) {
				const before = at(first);
				if (typeof before === "string") return before;
				const after = at(second);
				if (typeof after === "string") return after;
				return renderDiff(comparePacks(before, after));
			}
			const previous = calls[calls.length - 2];
			if (!previous) return "Only one call recorded; nothing to compare with.";
			return renderDiff(comparePacks(previous, latest));
		}

		if (verb !== "") {
			const call = at(verb);
			return typeof call === "string" ? call : renderCall(call);
		}

		return renderCall(latest);
	}

	/** One channel: the harness owns the screen when it offers one. */
	function tell(commandCtx: CommandContext, text: string): void {
		if (commandCtx.ui?.notify) commandCtx.ui.notify(text, "info");
		else deps.show?.(text);
	}

	/**
	 * The Pin surface: read, add, remove. The verb is the first word; what
	 * follows `add` is taken verbatim, line breaks included.
	 */
	async function pins(args: string, commandCtx: CommandContext): Promise<string> {
		const [, verb = "", rest = ""] = /^\s*(\S*)\s*([\s\S]*)$/.exec(args) ?? [];
		if (verb === "") return listPins(commandCtx);
		if (verb === "add") return pin(rest, commandCtx);
		if (verb === "rm") return unpin(rest, commandCtx);
		return `Unknown: pins ${verb}. Use \`/pins\`, \`/pins add [text]\` or \`/pins rm <id|all>\`.`;
	}

	/**
	 * Adds a Pin: the text given, or what the editor submits. Refused over
	 * the Budget before anything is written, so a refused Pin leaves no
	 * trace in the Journal.
	 */
	async function pin(args: string, commandCtx: CommandContext): Promise<string> {
		const journal = pinJournal(commandCtx.sessionManager);
		if (!journal) return PINS_UNAVAILABLE;
		// Verbatim: the user's text as written. Only the space after the verb
		// is not part of it, and the dispatcher has already taken that.
		const text =
			args.trim() !== ""
				? args
				: commandCtx.hasUI === false
					? undefined
					: await commandCtx.ui?.editor?.("Pin text");
		if (text === undefined || text.trim() === "") {
			return "Nothing pinned. Use `/pins add <text>` to pin text inline.";
		}
		const budget = pinBudget(deps.config);
		const outcome = admit(journal.read(), text, budget);
		if (!outcome.ok) return `Not pinned: ${outcome.reason}.`;
		journal.write({ op: "add", id: outcome.pin.id, text: outcome.pin.text });
		held = journal.read();
		showPins(commandCtx.ui);
		return (
			`Pinned #${outcome.pin.id} (~${outcome.tokens} tokens). Pins hold ` +
			`~${outcome.total} of ${budget.tokens} tokens, ${held.pins.length} of ${budget.count}.`
		);
	}

	/** Removes one Pin by id, or all of them. An id not held removes nothing. */
	function unpin(args: string, commandCtx: CommandContext): string {
		const journal = pinJournal(commandCtx.sessionManager);
		if (!journal) return PINS_UNAVAILABLE;
		const wanted = args.trim();
		if (wanted === "") return "Say which pin: `/pins rm <id>` or `/pins rm all`.";
		const ids = journal.read().pins.map((each) => each.id);
		if (ids.length === 0) return "No pins in this conversation to remove.";
		// `#3` and `3` name the same Pin; anything else names none.
		const named = /^#?(\d+)$/.exec(wanted)?.[1];
		const chosen =
			wanted === "all"
				? ids
				: ids.filter((id) => named !== undefined && id === Number(named));
		if (chosen.length === 0) {
			return (
				`No pin ${wanted} in this conversation; it holds ` +
				`${ids.map((id) => `#${id}`).join(", ")}.`
			);
		}
		journal.write({ op: "remove", ids: chosen });
		held = journal.read();
		showPins(commandCtx.ui);
		return (
			`Unpinned ${chosen.map((id) => `#${id}`).join(", ")}; ` +
			`${held.pins.length} remain${held.pins.length === 1 ? "s" : ""}.`
		);
	}

	/**
	 * Every Pin in full, sized as the Pack sizes it, then the total against
	 * the Budget: the reader of last resort where there is no status line.
	 */
	function listPins(commandCtx: CommandContext): string {
		const journal = pinJournal(commandCtx.sessionManager);
		if (!journal) return PINS_UNAVAILABLE;
		held = journal.read();
		const { pins } = held;
		if (pins.length === 0) return "no pins in this conversation";
		const budget = pinBudget(deps.config);
		const each = pins.map(
			(one, index) =>
				`#${one.id}  ~${approximateTokens([renderPin(one, index + 1, pins.length)])} ` +
				`tokens\n${one.text}`,
		);
		return (
			`${each.join("\n\n")}\n\n~${pinTokens(pins)} of ${budget.tokens} tokens, ` +
			`${pins.length} of ${budget.count} pins`
		);
	}

	/**
	 * What a retrieval supplied, and why it supplied nothing where it did.
	 *
	 * A part absent because no Store was configured, because retrieval
	 * failed, and because nothing was relevant are three different
	 * problems with three different remedies, and only the caller of the
	 * Store can tell the first two apart.
	 */
	type Supplied<T> = {
		value: T;
		unavailable?: "unconfigured" | "failed";
	};

	/**
	 * Turns recalled by meaning. A retrieval failure costs the recollections,
	 * never the Turn: the pack is assembled without them and the failure is
	 * reported.
	 */
	async function recallFor(
		conversationId: string,
		current: Turn | undefined,
	): Promise<Supplied<Recollections>> {
		const none: Recollections = {
			turns: [],
			rejected: 0,
			misses: [],
			unsearched: 0,
		};
		// No Store and no prompt are different absences: one is a machine
		// with nothing wired, the other a Call with nothing to search for.
		if (!deps.recall) return { value: none, unavailable: "unconfigured" };
		if (!current || deps.config.recallTurns <= 0) return { value: none };
		try {
			// Over-fetch: the Assembler drops what the verbatim tail already
			// carries, and only it knows what that is.
			const found = await inTime(
				"Recall",
				deps.config.recallDeadlineMs,
				deps.recall.similarTurns(
					conversationId,
					current.prompt,
					deps.config.recallTurns + deps.config.tailTurns,
					deps.config.recallMaxDistance,
				),
			);
			// Out of time is out of reach for this Call: the part is absent
			// for a reason the operator can act on, not for irrelevance.
			return found.answered
				? { value: found.value }
				: { value: none, unavailable: "failed" };
		} catch (error) {
			reportSafely(`Recall unavailable, pack assembled without it: ${describe(error)}`);
			return { value: none, unavailable: "failed" };
		}
	}

	/**
	 * Stores what the Journal holds, and says what happened.
	 *
	 * A Journal nobody can find used to return in silence, which on a
	 * machine whose session root differs is the whole Thread Store: nothing
	 * recorded, nothing recalled, and every setup check passing. It is now
	 * a report naming the Conversation and where it was looked for.
	 */
	/**
	 * Brings the Thread Store in line with the Journal, and says what it
	 * stored: the Turns just written, so their Calls' costs can be read
	 * from the same record, or nothing where the Store was already current.
	 */
	async function ingestJournal(
		conversationId: string,
		sink: TurnSink,
		codebase?: string,
		leafId?: string,
	): Promise<JournalTurn[] | undefined> {
		const path = await (deps.findJournal ?? findJournal)(conversationId);
		if (!path) {
			reportSafely(
				`No journal found for conversation ${conversationId} under ` +
					`${deps.sessionRoot ?? SESSION_ROOT}; nothing was ingested, so the ` +
					`tail comes from the harness's own history`,
			);
			return;
		}
		const recorded = await readJournal(path, leafId);
		if (recorded.length === 0) {
			// Read, and there was nothing in it. Said aloud because it looks
			// exactly like a healthy Store holding nothing yet, and the two want
			// different remedies.
			reportSafely(`The journal at ${path} holds no turns yet; nothing was ingested`);
			return;
		}
		const stored = await sink.ingest(conversationId, recorded, codebase);
		if (stored.length > 0) {
			deps.report(`Ingested ${stored.length} turn${stored.length === 1 ? "" : "s"}.`);
		}
		return stored.length > 0 ? stored : undefined;
	}

	/**
	 * Curated knowledge for this prompt, with what the threshold refused.
	 * A retrieval failure costs the Concepts, never the Turn.
	 */
	async function conceptsFor(
		current: Turn | undefined,
	): Promise<Supplied<ConceptMatches>> {
		const none: ConceptMatches = { hits: [], rejected: 0, misses: [], unsearched: 0 };
		if (!deps.docs) return { value: none, unavailable: "unconfigured" };
		if (!current || deps.config.docConcepts <= 0) return { value: none };
		try {
			// Over-fetch, as recall does: the Assembler applies the Budget,
			// so what the Budget excluded is visible rather than invisible.
			const found = await inTime(
				"Doc Store",
				deps.config.docDeadlineMs,
				deps.docs.searchConcepts(
					current.prompt,
					deps.config.docConcepts * 2,
					deps.config.docMaxDistance,
				),
			);
			if (found.answered) {
				reportUnsearchedConcepts(found.value.unsearched);
				return { value: found.value };
			}
			return { value: none, unavailable: "failed" };
		} catch (error) {
			reportSafely(`Doc Store unavailable, pack assembled without it: ${describe(error)}`);
			return { value: none, unavailable: "failed" };
		}
	}

	/**
	 * Says so, once, while the Concept index holds vectors another model
	 * made.
	 *
	 * The same cadence as the Turn-side swap report, and for the same
	 * reason: the condition persists until the background pass has
	 * re-embedded the sections, and a line per Call is a line nobody reads.
	 * Silence would leave curated knowledge looking thin for no stated
	 * reason, which is the one reading it must not invite.
	 */
	function reportUnsearchedConcepts(unsearched: number): void {
		if (unsearched <= 0 || unsearchedConceptsReported) return;
		unsearchedConceptsReported = true;
		reportSafely(
			`${unsearched} concept${unsearched === 1 ? " is" : "s are"} held only ` +
				`as vectors from another embedding model, so ${unsearched === 1 ? "it is" : "they are"} ` +
				`not searched until an indexing pass has re-embedded ` +
				`${unsearched === 1 ? "it" : "them"}.`,
		);
	}

	/**
	 * The structure around the symbols this Turn is working with, with what
	 * the Codebase has outgrown marked. A Graph Store failure costs the
	 * structure, never the Turn.
	 */
	async function structureFor(
		current: Turn | undefined,
	): Promise<Supplied<Neighbourhood[]>> {
		if (!deps.graph) return { value: [], unavailable: "unconfigured" };
		if (!current || deps.config.graphSymbols <= 0) return { value: [] };
		const store = deps.graph;
		const codebase = deps.codebase ?? process.cwd();
		try {
			const found = await inTime(
				"Graph Store",
				deps.config.graphDeadlineMs,
				store.graph(codebase),
			);
			if (!found.answered) return { value: [], unavailable: "failed" };
			const graph = found.value;
			// No graph is a Codebase never extracted, which is nothing
			// configured rather than something that failed.
			if (!graph) {
				reportMissingGraph();
				return { value: [], unavailable: "unconfigured" };
			}
			const newer = store.takeLoadFailure(codebase);
			if (newer) {
				reportSafely(
					`Graph Store could not read the newer graph, structure is from ` +
						`the one before it: ${describe(newer)}`,
				);
			}
			// Over-fetch, as the other Stores do, so what the Budget excluded
			// is visible in the accounting rather than invisible.
			const around = neighbourhoods(graph, symbolsInPlay(graph, current)).slice(
				0,
				deps.config.graphSymbols * 2,
			);
			// Aged after selection, so the number of `stat` calls is the
			// over-fetch rather than the graph.
			const older = await store.changedSince(
				codebase,
				graph.extractedAt,
				around.map((each) => each.symbol.file),
			);
			return {
				value: around.map((each) =>
					older.has(each.symbol.file) ? { ...each, stale: true as const } : each,
				),
			};
		} catch (error) {
			reportSafely(
				`Graph Store unavailable, pack assembled without it: ${describe(error)}`,
			);
			return { value: [], unavailable: "failed" };
		}
	}

	/**
	 * Said once when a structure Budget is set and there is no graph to
	 * serve it: an empty part with no explanation reads as a Codebase with
	 * no structure worth carrying, which is a different thing entirely.
	 *
	 * Asked of the runner off the Call path, since it is a subprocess:
	 * a first extraction still running is a wait, not a missing setting.
	 */
	function reportMissingGraph(): void {
		if (missingGraphReported) return;
		missingGraphReported = true;
		const graph = deps.graph;
		const codebase = deps.codebase ?? process.cwd();
		inBackground(
			"Graph Store status",
			(async () => {
				const running = graph
					? (await graph.extraction(codebase).catch((): Extraction => ({}))).running
					: undefined;
				announce(
					running
						? `Structure is configured but this codebase's first extraction is ` +
								`still running (started ${clock(running.since)}); structure ` +
								`arrives when it finishes.`
						: `Structure is configured (${deps.config.graphSymbols} symbols) but this ` +
								`codebase has no graph; run with PICHART_GRAPH=on to derive one, or set ` +
								`PICHART_GRAPH_SYMBOLS=0 to stop asking for it.`,
				);
			})(),
		);
	}

	/** Writes any reported window size this process has not written yet. */
	function reconcile(conversationId: string, branch: BranchEntry[]): void {
		const measurements = measurementsOf(branch);
		const already = measuredByConversation.get(conversationId) ?? 0;
		const fresh = measurements.slice(already);
		if (fresh.length === 0) return;

		measuredByConversation.set(conversationId, measurements.length);
		inBackground(
			"Measurements",
			deps.accounting.recordMeasurements(conversationId, fresh),
		);
	}
}

/** A sweep waiting its turn, and the leaf the latest request asked it to read. */
interface QueuedSweep {
	leafId: string | undefined;
	sweep: Promise<void>;
}

/**
 * Gives Turns reconstructed from the live message array their position in the
 * Conversation, counting back from the Turn now in progress. Without this a
 * pack assembled before ingest reports carrying nothing, because only the
 * Thread Store knows where a Turn sits.
 */
function positioned(turns: Turn[], currentIndex: number): Turn[] {
	const offset = currentIndex - (turns.length - 1);
	return turns.map((turn, at) => ({ ...turn, index: turn.index ?? offset + at }));
}

function conversationOf(ctx: HandlerContext): string {
	return ctx.sessionManager?.getSessionId?.() ?? UNKNOWN_CONVERSATION;
}

/** The entry the harness's branch ends at, where ingest reads back from. */
function leafOf(ctx: HandlerContext): string | undefined {
	return ctx.sessionManager?.getBranch?.().at(-1)?.id;
}

/**
 * The first Turn a rewind may have changed: the one the branch left and the
 * branch taken part in. Every Turn before it lies wholly on both and is
 * kept. Counted against the branch left, not the store's head, because the
 * store holds the branch left: a branch taken that runs longer would
 * otherwise keep the left one's Turns below its own leaf. Prompts are
 * counted as `addressOf` counts them; discarding one Turn too many costs
 * only its re-ingest. With no branch left to compare, nothing is kept.
 */
function rewoundFrom(left: BranchEntry[], taken: BranchEntry[]): number {
	let prompts = 0;
	for (const [index, entry] of taken.entries()) {
		if (!entry.id || entry.id !== left[index]?.id) break;
		if (entry.message?.role === "user") prompts++;
	}
	return Math.max(prompts - 1, 0);
}

/**
 * Where the Call about to happen sits.
 *
 * The branch holds every prompt the Conversation has ever seen, including
 * those before a clear — clearing adds a boundary marker, it does not drop
 * history — so counting prompts there numbers Turns continuously. What the
 * branch may lack is the prompt that triggered *this* Call: it is appended
 * after the context event on a new Turn, and present on the Calls of a tool
 * loop. That distinction is the whole of the arithmetic.
 */
function addressOf(
	branch: BranchEntry[],
	messages: HarnessMessage[],
): CallAddress {
	let prompts = 0;
	let callsThisTurn = 0;
	let lastPrompt: string | undefined;
	for (const entry of branch) {
		if (entry.message?.role === "user") {
			prompts++;
			callsThisTurn = 0;
			lastPrompt = messageText({
				role: "user",
				content: entry.message.content,
			});
		}
		if (entry.message?.contextSnapshot) callsThisTurn++;
	}

	const current = currentPrompt(messages);
	const inBranch = prompts > 0 && current !== undefined && current === lastPrompt;

	// Not yet in the branch: this prompt opens a Turn, at its first Call.
	if (!inBranch) return { turnIndex: prompts, callIndex: 0 };

	return { turnIndex: prompts - 1, callIndex: callsThisTurn };
}

function currentPrompt(messages: HarnessMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === "user") return messageText(message);
	}
	return undefined;
}

/**
 * Every window size the harness has reported, addressed to its Call, with
 * what the provider charged for it.
 *
 * Both sit on the same branch entry — the assistant message the Call
 * produced — so the cost is read on the walk that already numbers the
 * window, rather than on a second pass or on the request path, where a
 * Call's cost does not exist yet.
 */
function measurementsOf(branch: BranchEntry[]): Measurement[] {
	const measurements: Measurement[] = [];
	let turnIndex = -1;
	let callIndex = 0;
	for (const entry of branch) {
		if (entry.message?.role === "user") {
			turnIndex++;
			callIndex = 0;
		}
		const snapshot: ContextSnapshot | undefined = entry.message?.contextSnapshot;
		if (!snapshot) continue;
		measurements.push({
			turnIndex: Math.max(turnIndex, 0),
			callIndex,
			snapshot,
			usage: entry.message?.usage,
		});
		callIndex++;
	}
	return measurements;
}

/**
 * Every window the Journal recorded, addressed to its Call.
 *
 * The same walk `measurementsOf` makes over the live branch, over the record
 * on disk instead: `readJournal` already numbers each message to the Call it
 * belongs to, and a snapshot is what ends one.
 */
function measurementsOfJournal(turns: JournalTurn[]): Measurement[] {
	const measurements: Measurement[] = [];
	for (const turn of turns) {
		for (const [index, message] of turn.messages.entries()) {
			const snapshot = message.contextSnapshot;
			if (!snapshot) continue;
			measurements.push({
				turnIndex: turn.turnIndex,
				callIndex: turn.calls[index] ?? 0,
				snapshot,
				usage: message.usage,
			});
		}
	}
	return measurements;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** A time of day as the operator's clock shows it, HH:MM. */
function clock(at: number): string {
	const time = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

/**
 * How a deadline waits when nothing else was injected: a timer that does
 * not hold the process open, because it bounds someone else's slowness and
 * is never work of its own.
 */
function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	const timer = setTimeout(resolve, ms);
	timer.unref?.();
	return promise;
}

/**
 * The session's relevance judge, from the key the host resolves for
 * TypeSafe. pi-chart never reads the key itself: the host already merges the
 * environment, every `.env` and `/login`. A host that throws, or offers no
 * resolution at all, is no key — the search as it was before judging.
 */
async function resolveJudge(
	ctx: HandlerContext,
	judgeWith: (key: string) => RelevanceJudge,
): Promise<RelevanceJudge | undefined> {
	let key: string | undefined;
	try {
		key = await ctx.modelRegistry?.getApiKeyForProvider?.(
			"typesafe",
			ctx.sessionManager?.getSessionId?.(),
		);
	} catch {
		key = undefined;
	}
	return key ? judgeWith(key) : undefined;
}

export default function piChart(pi: ExtensionAPI): void {
	const config = loadConfig(process.env, readSavedUrl());

	// Everything a Codebase alone can serve is unconditional: structure is
	// derived from the Codebase, the bundle from disk, the Spec Store from
	// `stat` and a subprocess. Declining the record of what happened must
	// not withdraw any of them, which two literals made it do.
	const bundle = new DocStore(config.docBundle);
	const shared = {
		config,
		assemble: defaultAssemble,
		graph: new GraphStore({ extractDeadlineMs: config.graphExtractDeadlineMs }),
		walk: bundle,
		author: bundle,
		specs: new SpecStore(),
		codebase: process.cwd(),
		report: (message) => pi.logger.warn(`[pi-chart] ${message}`),
		show: showToStdout,
	} satisfies Partial<Dependencies>;

	const embedder = new LocalEmbedder();
	const store = PostgresStore.open(config, embedder);
	if (!store) {
		// Declined, or not set up yet: the Assembler still owns the window;
		// the tail simply comes from the harness's own history, and
		// Accounting is held in memory so `/pack` still answers in-session.
		register(pi, {
			...shared,
			turns: new MemoryTurnSource(),
			accounting: new MemoryAccounting(),
		});
		return;
	}
	let opened = true;
	const ready = store.migrate().catch((error: unknown) => {
		opened = false;
		// Naming the fix matters more than naming the error: a store that
		// will not open means nothing is recorded and nothing is recalled.
		// A supplied server is the operator's to bring up; a saved one is
		// setup's to find again.
		const fix =
			config.storeOrigin === "supplied"
				? `Check PICHART_DATABASE_URL and that its Postgres is up.`
				: "Run `/pi-chart setup` to find a server again.";
		pi.logger.warn(
			`[pi-chart] Thread Store unavailable, so nothing is recorded or recalled. ` +
				`${fix} (${describe(error)})`,
		);
	});

	register(pi, {
		...shared,
		turns: store,
		ingest: store,
		recall: store,
		search: store,
		judgeWith: (key) => new JevJudge(key),
		docs: store,
		ready,
		bundle: () => readBundle(config.docBundle),
		embed: (conversationId) => embedAll(store, conversationId),
		vectorModels: () => store.vectorModels(),
		retire: (olderThanDays) => store.retire(olderThanDays),
		close: async () => {
			// Both are attempted, whichever fails: the Store's pool is the
			// resource a long session exhausts, so it goes back first, and
			// the embedder's worker is a process that must not outlive the
			// session either way.
			try {
				await ready;
				// A store that never opened was reported at start; its close
				// re-raising that failure would only report it again, as an
				// error at exit.
				await store.close().catch((error: unknown) => {
					if (opened) throw error;
				});
			} finally {
				embedder.close();
			}
		},
		accounting: store,
	});
}

/** Embeds everything still lacking a vector, a batch at a time. */
async function embedAll(store: PostgresStore, conversationId: string): Promise<void> {
	while ((await store.embedPending(conversationId)) > 0) {
		// Each pass takes the next batch; zero means nothing is left.
	}
}

function showToStdout(text: string): void {
	process.stdout.write(`${text}\n`);
}
