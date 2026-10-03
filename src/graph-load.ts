import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

import { readGraph, type CodeGraph } from "./graph.ts";

/**
 * What reading one extraction came to. The hash is of the file's text, so
 * a rewrite with the same content is recognised without parsing it again.
 */
export type Loaded =
	| { hash: string; skipped: true }
	| { hash: string; graph: CodeGraph }
	| { hash: string; failure: string };

/** Reads an extraction from a file, skipping it if its hash is in `skip`. */
export type Load = (path: string, skip: readonly string[]) => Promise<Loaded>;

/**
 * Hashes an extraction and, unless that hash is one already read, parses
 * it. A graph the adapter rejects is a result rather than a throw: it has
 * a hash, so the same broken file is not parsed again.
 */
export function readExtraction(text: string, skip: readonly string[]): Loaded {
	const hash = createHash("sha256").update(text).digest("hex");
	if (skip.includes(hash)) return { hash, skipped: true };
	try {
		return { hash, graph: readGraph(text) };
	} catch (error) {
		return { hash, failure: error instanceof Error ? error.message : String(error) };
	}
}

const WORKER = new URL("./graph-load-worker.ts", import.meta.url);

/**
 * Reads an extraction in a worker thread of its own, so the read, the
 * hash, the parse and the filtering never stall the session. One worker
 * per load, exiting once it has answered: the parse's memory goes with it.
 *
 * Settles however the worker ends: a worker that crashes, or exits
 * without answering, rejects rather than leaving a Call waiting on it.
 */
export function loadInWorker(path: string, skip: readonly string[]): Promise<Loaded> {
	return new Promise((resolve, reject) => {
		let answered = false;
		const worker = new Worker(WORKER, { workerData: { path, skip } });
		worker.once("message", (loaded: Loaded) => {
			answered = true;
			// Taking the message in is a stall of its own (≈250 ms on VS
			// Code); answering after a timer turn lets input and rendering
			// through before the indexing that follows, rather than adding
			// the two into one stall.
			setTimeout(() => resolve(loaded), 0);
		});
		worker.once("error", (error) => {
			answered = true;
			reject(error);
		});
		worker.once("exit", (code) => {
			if (!answered) reject(new Error(`graph reader exited (code ${code}) without answering`));
		});
	});
}
