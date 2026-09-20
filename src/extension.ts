import {
	MemoryAccounting,
	type AccountingStore,
	type CallAddress,
	type Measurement,
	type TailSource,
} from "./accounting.ts";
import {
	assemble as defaultAssemble,
	type AssembleInput,
	type AssemblerConfig,
	type Pack,
} from "./assembler.ts";
import type { Concept } from "./concept.ts";
import { loadConfig, setBudget, type Config } from "./config.ts";
import { DocStore, readBundle, type DocWalk } from "./doc-store.ts";
import { GraphStore } from "./graph-store.ts";
import { describeChecks, Installation } from "./install.ts";
import { describeTree, SpecStore } from "./spec-store.ts";
import {
	neighbourhoods,
	symbolsInPlay,
	type Neighbourhood,
} from "./symbols.ts";
import type { ConceptHit, ConceptSearch } from "./doc-index.ts";
import {
	comparePacks,
	inspectConversation,
	summarise,
} from "./inspection.ts";
import {
	renderCall,
	renderDiff,
	renderLevel,
	renderSearch,
	renderSummary,
} from "./report.ts";
import { findJournal, readJournal } from "./journal.ts";
import { messageText, type ContextSnapshot, type HarnessMessage, type Turn } from "./messages.ts";
import type {
	BranchEntry,
	ExtensionAPI,
	HandlerContext,
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
import { reconstructTurns } from "./turns.ts";

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
	/** Releases whatever the session held open. */
	close?: () => Promise<void> | void;
	/** Shows text to the person running the session. */
	show?: (text: string) => void;
	/** Searches every Conversation, when the agent asks. */
	search?: CorpusSearch;
	/** The Doc Store's index, searched during assembly. */
	docs?: ConceptSearch;
	/** The bundle as the agent walks it, Level by Level. */
	walk?: DocWalk;
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

/** How many hits a cross-Conversation search returns when unasked. */
const DEFAULT_SEARCH_RESULTS = 5;
/** A ceiling, so one call cannot empty the store into the window. */
const MAX_SEARCH_RESULTS = 20;

function toolResult(text: string, details: Record<string, unknown>): ToolResult {
	return { content: [{ type: "text", text }], details };
}

/** A tool argument as a usable string, or absent. Empty is absent. */
function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Wires the Assembler into the harness.
 *
 * Everything of consequence lives behind this function: reconstruction,
 * assembly, retrieval, and accounting are pure or injected, so this adapter is
 * the only code that knows the harness exists.
 */
export function register(pi: ExtensionAPI, deps: Dependencies): void {
	/** What the harness said about its memory backend, if it said anything. */
	let memoryOff: boolean | undefined;
	/** Whether it has been asked at all. Unasked is not "did not answer". */
	let memoryAsked = false;
	const measuredByConversation = new Map<string, number>();
	/** One ingest-and-embed sweep per Conversation at a time. */
	const sweeping = new Map<string, Promise<void>>();
	/** The Conversation the command inspects: whichever one is running. */
	let lastConversation = UNKNOWN_CONVERSATION;
	/** Said once a session: a model swap is a condition, not a per-Turn event. */
	let swapReported = false;
	/** Conversations already told their packs are approaching the ceiling. */
	const warnedNearCeiling = new Set<string>();

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
			reportSafely(
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
		reportSafely(
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

	pi.on("session_start", async (_event, ctx) => {
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
			const graph = deps.graph;
			const codebase = deps.codebase ?? process.cwd();
			// Background, like Doc Store indexing: extracting a Codebase is
			// seconds of work a first prompt must not wait for.
			inBackground("Graph Store extraction", graph.refresh(codebase));
		}

		if (deps.docs && deps.bundle) {
			const docs = deps.docs;
			const bundle = deps.bundle;
			const ready = deps.ready;
			// Indexing is background work: a session must not wait on the
			// bundle to send its first prompt. It does have to wait for the
			// schema, which is migrated concurrently at startup.
			inBackground(
				"Doc Store indexing",
				(async () => {
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
				})(),
			);
		}

		const status = await ctx.memory?.status?.();
		// Remembered for `context-manager`, which runs long after this and
		// has no way to ask the harness itself.
		memoryAsked = true;
		memoryOff = status
			? status.active !== true && (!status.backend || status.backend === "off")
			: undefined;
		if (!status) {
			// The same rule the Spec Store applies to a missing CLI: an
			// invariant that cannot be checked is unknown, and reporting
			// nothing would read as "verified off" (ADR-0003).
			deps.report(
				"The harness does not report its memory backend, so it cannot be " +
					"confirmed off. Two systems injecting recall into one window " +
					"makes a bad pack impossible to diagnose.",
			);
			return;
		}
		if (status.active === true || (status.backend && status.backend !== "off")) {
			deps.report(
				`The harness memory backend is active (${status.backend ?? "unknown"}). ` +
					"Two systems will inject recalled content into one context window; " +
					"set memory.backend to off.",
			);
		}
	});

	pi.on("context", async (event, ctx) => {
		const conversationId = conversationOf(ctx);
		lastConversation = conversationId;
		const branch = ctx.sessionManager?.getBranch?.() ?? [];
		const messages = event.messages ?? [];
		const address = addressOf(branch, messages);

		reconcile(conversationId, branch);

		try {
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
					recalled: recalled.turns,
					rejected: recalled.rejected,
					unsearched: recalled.unsearched,
					concepts,
					structure,
				},
				{
					tailTurns: deps.config.tailTurns,
					recallTurns: deps.config.recallTurns,
					docConcepts: deps.config.docConcepts,
					graphSymbols: deps.config.graphSymbols,
					tailTokens: deps.config.tailTokens,
					recallTokens: deps.config.recallTokens,
					docTokens: deps.config.docTokens,
					graphTokens: deps.config.graphTokens,
					packTokens: deps.config.packTokens,
				},
			);

			warnIfNearCeiling(conversationId, pack);

			inBackground(
				"Accounting",
				deps.accounting.recordPack(conversationId, address, pack, tailSource),
			);

			return { messages: pack.messages };
		} catch (error) {
			// Fails open, toward the accumulating window this exists to prevent,
			// so every occurrence is reported and the Call is marked unassembled
			// rather than vanishing from the accounting.
			reportSafely(`Assembly failed, turn left unassembled: ${describe(error)}`);
			inBackground(
				"Unassembled turn",
				deps.accounting.recordUnassembled(conversationId, address),
			);
			return undefined;
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		const conversationId = conversationOf(ctx);
		reconcile(conversationId, ctx.sessionManager?.getBranch?.() ?? []);
		await store(conversationId);
	});

	// `agent_end` is notification-only: the harness does not wait for it, so a
	// headless run can exit mid-ingest. `session_shutdown` is awaited, which
	// makes it the sweep that guarantees a Turn is stored before exit.
	pi.on("session_shutdown", async (_event, ctx) => {
		await store(conversationOf(ctx));
		await deps.close?.();
	});

	/**
	 * Ingests and embeds. Runs after a response, never before a request.
	 *
	 * One sweep per Conversation at a time: `agent_end` and `session_shutdown`
	 * overlap on a short run, and two concurrent passes would select the same
	 * unembedded rows and embed them twice.
	 */
	function store(conversationId: string): Promise<void> {
		const running = sweeping.get(conversationId);
		if (running) return running;

		const sweep = runSweep(conversationId).finally(() => {
			sweeping.delete(conversationId);
		});
		sweeping.set(conversationId, sweep);
		return sweep;
	}

	async function runSweep(conversationId: string): Promise<void> {
		if (!deps.ingest) return;
		try {
			await ingestJournal(conversationId, deps.ingest, deps.codebase);
		} catch (error) {
			deps.report(`Ingest failed: ${describe(error)}`);
			return;
		}
		reportModelSwap();
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
				deps.report(
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
	 */
	async function tailFor(
		conversationId: string,
		live: Turn[],
		tailTurns: number,
	): Promise<{ tail: Turn[]; tailSource: TailSource }> {
		try {
			const stored = await deps.turns.recentTurns(conversationId, tailTurns);
			if (stored.length > 0) return { tail: stored, tailSource: "thread-store" };
		} catch (error) {
			reportSafely(`Thread Store unreachable, using harness history: ${describe(error)}`);
			return { tail: live.slice(0, -1), tailSource: "harness-fallback" };
		}
		// An empty store is not a failure: a Conversation's first Turns predate
		// any ingest, and the harness still has them.
		return { tail: live.slice(0, -1), tailSource: "harness-fallback" };
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
				return concept
					? toolResult(`# ${concept.title ?? concept.id}\n\n${concept.body}`, {
							concept: concept.id,
						})
					: toolResult(`No concept called ${asked.concept}.`, {
							missing: asked.concept,
						});
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

		try {
			const found = await (deps.search?.searchAll(
				query,
				limit,
				deps.config.recallMaxDistance,
			) ?? Promise.resolve([]));
			return toolResult(renderSearch(found), {
				results: found.length,
				conversations: [...new Set(found.map((hit) => hit.conversationId))],
			});
		} catch (error) {
			const reason = describe(error);
			deps.report(`Cross-conversation search failed: ${reason}`);
			return toolResult(`The search could not run: ${reason}`, { failed: true });
		}
	}

	if (pi.registerCommand) {
		pi.registerCommand("context-manager", {
			description:
				"Check what this extension needs and what is missing: " +
				"`context-manager` to check, `context-manager setup` to start " +
				"the thread store",
			handler: async (args, commandCtx) => {
				const output = await manageInstall(args.trim());
				if (commandCtx.ui?.notify) commandCtx.ui.notify(output, "info");
				else deps.show?.(output);
			},
		});

		pi.registerCommand("specs", {
			description:
				"Check the codebase's OpenSpec tree: `specs` to verify, " +
				"`specs init` to create what is missing",
			handler: async (args, commandCtx) => {
				const text = await checkSpecs(args.trim());
				if (commandCtx.ui?.notify) commandCtx.ui.notify(text, "info");
				else deps.show?.(text);
			},
		});

		pi.registerCommand("pack", {
			description:
				"Inspect the context pack: `pack` for the last call, `pack diff`, " +
				"`pack summary`, `pack budget <tail|recall|docs|graph|" +
				"tail-tokens|recall-tokens|docs-tokens|graph-tokens|pack> <n>`",
			handler: async (args, commandCtx) => {
				const text = await inspect(args.trim());
				// One channel: the harness owns the screen when it offers one.
				if (commandCtx.ui?.notify) commandCtx.ui.notify(text, "info");
				else deps.show?.(text);
			},
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
			const after = await install.check(deps.config, memoryState());
			return `${describeChecks(done)}\n\nNow:\n${describeChecks(after)}`;
		}
		if (args !== "") {
			return `Unknown command: ${args}. Use \`context-manager\` or \`context-manager setup\`.`;
		}

		return describeChecks(await install.check(deps.config, memoryState()));
	}

	/** What to tell the installation about the harness's memory backend. */
	function memoryState(): boolean | undefined {
		return memoryAsked ? memoryOff : undefined;
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

	/** The inspector's whole surface, kept out of the harness adapter. */
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

		if (verb === "diff") {
			const previous = calls[calls.length - 2];
			if (!previous) return "Only one call recorded; nothing to compare with.";
			return renderDiff(comparePacks(previous, latest));
		}

		return renderCall(latest);
	}

	/**
	 * Turns recalled by meaning. A retrieval failure costs the recollections,
	 * never the Turn: the pack is assembled without them and the failure is
	 * reported.
	 */
	async function recallFor(
		conversationId: string,
		current: Turn | undefined,
	): Promise<Recollections> {
		const none: Recollections = { turns: [], rejected: 0, unsearched: 0 };
		if (!deps.recall || !current || deps.config.recallTurns <= 0) return none;
		try {
			// Over-fetch: the Assembler drops what the verbatim tail already
			// carries, and only it knows what that is.
			return await deps.recall.similarTurns(
				conversationId,
				current.prompt,
				deps.config.recallTurns + deps.config.tailTurns,
				deps.config.recallMaxDistance,
			);
		} catch (error) {
			reportSafely(`Recall unavailable, pack assembled without it: ${describe(error)}`);
			return none;
		}
	}

	async function ingestJournal(
		conversationId: string,
		sink: TurnSink,
		codebase?: string,
	): Promise<void> {
		const path = await findJournal(conversationId);
		if (!path) return;
		await sink.ingest(conversationId, await readJournal(path), codebase);
	}

	/**
	 * Curated knowledge for this prompt. A retrieval failure costs the
	 * Concepts, never the Turn.
	 */
	async function conceptsFor(current: Turn | undefined): Promise<ConceptHit[]> {
		if (!deps.docs || !current || deps.config.docConcepts <= 0) return [];
		try {
			// Over-fetch, as recall does: the Assembler applies the Budget,
			// so what the Budget excluded is visible rather than invisible.
			return await deps.docs.searchConcepts(
				current.prompt,
				deps.config.docConcepts * 2,
				deps.config.docMaxDistance,
			);
		} catch (error) {
			reportSafely(`Doc Store unavailable, pack assembled without it: ${describe(error)}`);
			return [];
		}
	}

	/**
	 * The structure around the symbols this prompt names. A Graph Store
	 * failure costs the structure, never the Turn.
	 */
	async function structureFor(
		current: Turn | undefined,
	): Promise<Neighbourhood[]> {
		if (!deps.graph || !current || deps.config.graphSymbols <= 0) return [];
		try {
			const graph = await deps.graph.graph(deps.codebase ?? process.cwd());
			if (!graph) return [];
			// Over-fetch, as the other Stores do, so what the Budget excluded
			// is visible in the accounting rather than invisible.
			return neighbourhoods(graph, symbolsInPlay(graph, current.prompt)).slice(
				0,
				deps.config.graphSymbols * 2,
			);
		} catch (error) {
			reportSafely(
				`Graph Store unavailable, pack assembled without it: ${describe(error)}`,
			);
			return [];
		}
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

/** Every window size the harness has reported, addressed to its Call. */
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
		});
		callIndex++;
	}
	return measurements;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export default function contextManager(pi: ExtensionAPI): void {
	const config = loadConfig(process.env);

	if (!config.databaseUrl) {
		// Without a Thread Store the Assembler still owns the window; the tail
		// simply comes from the harness's own history, as it did before.
		const memory = new MemoryTurnSource();
		register(pi, {
			config,
			assemble: defaultAssemble,
			turns: memory,
			accounting: new MemoryAccounting(),
			// Neither needs Postgres, and a session with no Thread Store is
			// the one with least other context to draw on.
			walk: new DocStore(config.docBundle),
			// Neither Postgres nor a model: `stat` and a subprocess, so it
			// works in a session with no Thread Store at all.
			specs: new SpecStore(),
			codebase: process.cwd(),
			report: reportToStderr,
			show: showToStdout,
		});
		return;
	}

	const embedder = new LocalEmbedder();
	const store = PostgresStore.connect(config.databaseUrl, embedder);
	const ready = store.migrate().catch((error: unknown) => {
		// Naming the command matters more than naming the error: an
		// unreachable store means nothing is recorded and nothing is
		// recalled, and the fix is one command away.
		reportToStderr(
			`Thread Store unreachable, so nothing is recorded or recalled. ` +
				`Run \`/context-manager setup\` to start it. (${describe(error)})`,
		);
	});

	register(pi, {
		config,
		assemble: defaultAssemble,
		turns: store,
		ingest: store,
		recall: store,
		search: store,
		docs: store,
		graph: new GraphStore(),
		walk: new DocStore(config.docBundle),
		specs: new SpecStore(),
		ready,
		bundle: () => readBundle(config.docBundle),
		codebase: process.cwd(),
		embed: (conversationId) => embedAll(store, conversationId),
		vectorModels: () => store.vectorModels(),
		close: () => {
			embedder.close();
		},
		accounting: store,
		report: reportToStderr,
		show: showToStdout,
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

function reportToStderr(message: string): void {
	process.stderr.write(`[context-manager] ${message}\n`);
}
