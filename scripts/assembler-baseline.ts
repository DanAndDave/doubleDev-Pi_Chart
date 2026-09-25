/**
 * Throwaway (assembler-shape): every Pack this machine's Journals produce,
 * serialised, so a restructuring can be checked byte for byte rather than
 * asserted to be safe.
 *
 * Assembles at the shipped defaults over the real Journals under the
 * harness's session root — no store, no embedder, so recall, curated
 * knowledge and structure are empty and what varies is exactly what this
 * change touches: selection, Ceiling reduction, and Elision. Writes one
 * JSON file; run it before the change and again after, and `diff` them.
 *
 * The second argument is the session root to read, which must be a frozen
 * copy: the live root is being appended to by whatever else is running, and
 * two runs against it differ for that reason alone.
 *
 *     cp -r ~/.omp/agent/sessions /tmp/cm-journals
 *     bun scripts/assembler-baseline.ts /tmp/before.json /tmp/cm-journals
 *     bun scripts/assembler-baseline.ts /tmp/after.json /tmp/cm-journals
 *     cmp /tmp/before.json /tmp/after.json
 *
 * Deleted when the change lands: its value expires with the refactor.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { assemble, type AssemblerConfig } from "../src/assembler.ts";
import {
	DEFAULT_DOC_CONCEPTS,
	DEFAULT_DOC_MAX_DISTANCE,
	DEFAULT_DOC_TOKENS,
	DEFAULT_EXPLAIN_CANDIDATES,
	DEFAULT_GRAPH_SYMBOLS,
	DEFAULT_GRAPH_TOKENS,
	DEFAULT_PACK_TOKENS,
	DEFAULT_RECALL_MAX_DISTANCE,
	DEFAULT_RECALL_TOKENS,
	DEFAULT_RECALL_TURNS,
	DEFAULT_TAIL_TOKENS,
	DEFAULT_TAIL_TURNS,
} from "../src/config.ts";
import { readJournal, SESSION_ROOT } from "../src/journal.ts";
import type { HarnessMessage, Turn } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: bun scripts/assembler-baseline.ts <file>");

/**
 * The shipped defaults, plus the narrower ceilings that make the reduction
 * path and the elision path run on ordinary Journals rather than only on
 * the few enormous ones.
 */
const CONFIGS: Record<string, AssemblerConfig> = {
	shipped: base(),
	"tight-ceiling": { ...base(), packTokens: 4_000 },
	"tight-tail": {
		...base(),
		tail: { count: DEFAULT_TAIL_TURNS, tokens: 1_500 },
		packTokens: 8_000,
	},
	"tiny-everything": {
		...base(),
		tail: { count: 3, tokens: 400 },
		packTokens: 600,
	},
};

function base(): AssemblerConfig {
	return {
		tail: { count: DEFAULT_TAIL_TURNS, tokens: DEFAULT_TAIL_TOKENS },
		recall: { count: DEFAULT_RECALL_TURNS, tokens: DEFAULT_RECALL_TOKENS },
		docs: { count: DEFAULT_DOC_CONCEPTS, tokens: DEFAULT_DOC_TOKENS },
		graph: { count: DEFAULT_GRAPH_SYMBOLS, tokens: DEFAULT_GRAPH_TOKENS },
		packTokens: DEFAULT_PACK_TOKENS,
		recallMaxDistance: DEFAULT_RECALL_MAX_DISTANCE,
		docMaxDistance: DEFAULT_DOC_MAX_DISTANCE,
		explainCandidates: DEFAULT_EXPLAIN_CANDIDATES,
	};
}

const root = process.argv[3] ?? SESSION_ROOT;
const journals: string[] = [];
for (const directory of await readdir(root)) {
	let entries: string[];
	try {
		entries = await readdir(join(root, directory));
	} catch {
		continue;
	}
	for (const entry of entries) {
		if (entry.endsWith(".jsonl")) journals.push(join(root, directory, entry));
	}
}
journals.sort();

const packs: unknown[] = [];
let assembled = 0;
let elided = 0;
let reduced = 0;
let unbound = 0;

for (const path of journals) {
	const turns = await readJournal(path);
	if (turns.length === 0) continue;
	// Every Call the Journal recorded, as the extension sees it: the Turns
	// up to and including the one in progress.
	for (let upto = 1; upto <= turns.length; upto++) {
		const messages: HarnessMessage[] = turns
			.slice(0, upto)
			.flatMap((turn) => turn.messages);
		const live: Turn[] = reconstructTurns(messages);
		for (const [name, config] of Object.entries(CONFIGS)) {
			const pack = assemble({ turns: live, supplied: messages }, config);
			assembled++;
			if (pack.beforeCeiling > pack.ceiling) reduced++;
			else unbound++;
			if (pack.parts.some((part) => part.shortened)) elided++;
			packs.push({
				journal: path.slice(root.length + 1),
				upto,
				config: name,
				leadingTokens: pack.leadingTokens,
				approximateTokens: pack.approximateTokens,
				beforeCeiling: pack.beforeCeiling,
				ceiling: pack.ceiling,
				budgets: pack.budgets,
				rejected: pack.rejected,
				unsearched: pack.unsearched,
				conceptsUnsearched: pack.conceptsUnsearched,
				parts: pack.parts,
				messages: pack.messages,
			});
		}
	}
}

await Bun.write(out, `${JSON.stringify(packs, null, "\t")}\n`);
console.log(
	`${journals.length} journals, ${assembled} packs: ` +
		`${reduced} reduced by the ceiling, ${unbound} unbound, ${elided} with something elided`,
);
