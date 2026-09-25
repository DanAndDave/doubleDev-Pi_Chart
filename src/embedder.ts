import { findBun } from "./bun-runtime.ts";

/**
 * What a loaded embedder is: which model, and how wide its vectors are.
 *
 * Reported by the thing that loaded the model rather than declared beside
 * it, because `PICHART_EMBED_MODEL` can replace the pinned model at startup and
 * a declared constant would then describe a model nothing is running. Every
 * stored vector records this, so two vector spaces can never be ranked
 * against one another.
 */
export interface EmbedderIdentity {
	model: string;
	dimensions: number;
}

/**
 * Turns text into a vector so Turns can be found by meaning.
 *
 * Injected rather than imported, so the default suite runs without a model
 * download and so the model behind it can be swapped on evidence later.
 */
export interface Embedder {
	/** The model actually loaded and the width it produces. */
	identity(): Promise<EmbedderIdentity>;
	/** Embeds content as it is stored: no instruction, no derivation. */
	embed(texts: string[]): Promise<number[][]>;
	/**
	 * Embeds text as a question about stored content rather than as stored
	 * content. The pinned model is trained asymmetrically — a query carries
	 * an instruction, a passage carries none — so the two are separate
	 * calls: applying the derivation to both would discard the asymmetry and
	 * weld every stored vector to a prompt string.
	 */
	embedQuery(texts: string[]): Promise<number[][]>;
}

/** The model this project is pinned to, and the width of its output. */
export const PINNED_MODEL = "Xenova/bge-small-en-v1.5";
export const PINNED_DIMENSIONS = 384;

/**
 * What bge-small-en-v1.5 expects in front of a short query. The model was
 * trained with it on the query side and without it on the passage side, so
 * it belongs to the model rather than to the caller — and it never reaches
 * a stored vector.
 */
export const QUERY_INSTRUCTION =
	"Represent this sentence for searching relevant passages: ";

/**
 * A deterministic stand-in: a hash-derived unit vector. Shares no behaviour
 * with a real model beyond being stable and the right width, which is exactly
 * what tests of ranking mechanics need and no more than they should assume.
 */
export class StubEmbedder implements Embedder {
	constructor(
		private readonly dimensions: number = PINNED_DIMENSIONS,
		/** Named so a test can stand in for a second model, not just a second width. */
		private readonly model: string = "stub",
	) {}

	async identity(): Promise<EmbedderIdentity> {
		return { model: this.model, dimensions: this.dimensions };
	}

	async embed(texts: string[]): Promise<number[][]> {
		return texts.map((text) => this.vector(text));
	}

	/**
	 * The same vector as `embed`: the instruction belongs to the real
	 * model's training, and a stand-in that imitated it would make every
	 * query in the default suite drift by a constant nobody measured.
	 */
	async embedQuery(texts: string[]): Promise<number[][]> {
		return this.embed(texts);
	}

	private vector(text: string): number[] {
		const values = new Array<number>(this.dimensions).fill(0);
		// Every token nudges one dimension, so texts sharing words land near
		// each other and unrelated ones do not.
		for (const token of text.toLowerCase().split(/\W+/)) {
			if (!token) continue;
			let hash = 2166136261;
			for (let index = 0; index < token.length; index++) {
				hash = Math.imul(hash ^ token.charCodeAt(index), 16777619);
			}
			const slot = Math.abs(hash) % this.dimensions;
			values[slot] = (values[slot] ?? 0) + 1;
		}
		return normalize(values);
	}
}

/**
 * The real embedder: the pinned model, run in its own process.
 *
 * Out-of-process because the harness's bundled runtime cannot load the
 * model's native dependencies, while the project's own Bun can. The worker
 * is started on first use and reused, so the model loads once per session
 * rather than once per batch.
 */
export class LocalEmbedder implements Embedder {
	private worker?: Worker;
	private nextId = 0;
	private readonly pending = new Map<number, Resolver>();
	/** Asked once and remembered: the model is loaded once per worker. */
	private handshake?: Promise<EmbedderIdentity>;

	constructor(
		/** Where Bun is. Found when unset, so `PICHART_BUN` is a rescue, not a step. */
		private readonly runtime?: string,
		/** How long one batch may take, including first-use model load. */
		private readonly timeoutMs = 120_000,
		/** The worker to run. A seam: tests substitute a misbehaving one. */
		private readonly script = new URL("./embedder-worker.ts", import.meta.url)
			.pathname,
	) {}

	/**
	 * What the worker actually loaded, asked of the worker rather than
	 * assumed: `PICHART_EMBED_MODEL` can replace the pinned model, and the width
	 * is measured from a vector the loaded model produced.
	 */
	async identity(): Promise<EmbedderIdentity> {
		this.handshake ??= this.ask({ identify: true })
			.then((reply) => {
				const model = reply.model;
				const dimensions = reply.dimensions;
				if (typeof model !== "string" || typeof dimensions !== "number") {
					throw new Error("embedder did not report the model it loaded");
				}
				return { model, dimensions };
			})
			.catch((error: unknown) => {
				// A failed handshake must not be remembered as the answer:
				// the next attempt starts a fresh worker.
				this.handshake = undefined;
				throw error;
			});
		return this.handshake;
	}

	/**
	 * A query, with the instruction the model was trained to expect in front
	 * of one. Only here: the passage side stays bare, so rewording the
	 * instruction never invalidates a stored vector.
	 */
	async embedQuery(texts: string[]): Promise<number[][]> {
		return this.embed(texts.map((text) => `${QUERY_INSTRUCTION}${text}`));
	}

	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		const { dimensions } = await this.identity();
		const reply = await this.ask({ texts });
		const vectors = reply.vectors ?? [];
		for (const vector of vectors) {
			if (vector.length !== dimensions) {
				throw new Error(
					`embedder produced ${vector.length} dimensions, expected ${dimensions}`,
				);
			}
		}
		return vectors;
	}

	/** One line of JSON out, one line back, or a failure nobody waits past. */
	private async ask(request: Record<string, unknown>): Promise<Reply> {
		const worker = await this.start();
		const id = this.nextId++;
		const { promise, resolve, reject } = Promise.withResolvers<Reply>();
		this.pending.set(id, { resolve, reject });

		// A dead worker must surface as a failure, never as a promise nobody
		// settles: the context handler awaits this, so a hang would block the
		// Turn rather than degrade it.
		const deadline = setTimeout(() => {
			this.fail(new Error(`embedder timed out after ${this.timeoutMs}ms`));
		}, this.timeoutMs);
		deadline.unref?.();

		try {
			worker.stdin.write(JSON.stringify({ id, ...request }) + "\n");
		} catch (error) {
			clearTimeout(deadline);
			this.fail(error instanceof Error ? error : new Error(String(error)));
		}

		try {
			return await promise;
		} finally {
			clearTimeout(deadline);
		}
	}

	/** Stops the worker. Safe to call when none was started. */
	close(): void {
		this.worker?.process.kill();
		this.worker = undefined;
		this.handshake = undefined;
		this.settleAll(new Error("embedder stopped"));
	}

	/** Tears down a worker that cannot serve, failing everything waiting. */
	private fail(error: Error): void {
		this.worker?.process.kill();
		this.worker = undefined;
		this.handshake = undefined;
		this.settleAll(error);
	}

	private settleAll(error: Error): void {
		for (const { reject } of this.pending.values()) reject(error);
		this.pending.clear();
	}

	private async start(): Promise<Worker> {
		if (this.worker) return this.worker;

		const runtime = this.runtime ?? (await findBun());
		if (!runtime) {
			throw new Error(
				"no Bun found to run the embedder. Install Bun " +
					"(https://bun.sh) or set PICHART_BUN to its path",
			);
		}

		let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
		try {
			child = Bun.spawn([runtime, this.script], {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			});
		} catch (error) {
			throw new Error(
				`could not start the embedder with "${runtime}": ` +
					(error instanceof Error ? error.message : String(error)),
			);
		}

		const worker: Worker = { process: child, stdin: child.stdin };
		this.worker = worker;
		void this.consume(child.stdout);
		void this.watch(child);
		return worker;
	}

	/** A worker that exits takes every batch waiting on it down with it. */
	private async watch(
		child: Bun.Subprocess<"pipe", "pipe", "pipe">,
	): Promise<void> {
		const code = await child.exited;
		if (this.worker?.process !== child) return;
		this.worker = undefined;
		const stderr = await new Response(child.stderr).text().catch(() => "");
		const tail = stderr.trim()
			? `: ${stderr.trim().split("\n").at(-1)}`
			: "";
		this.settleAll(
			new Error(
				explainEmbedderFailure(`embedder exited with code ${code}${tail}`),
			),
		);
	}

	/** Matches each reply to the batch that asked for it. */
	private async consume(stdout: ReadableStream<Uint8Array>): Promise<void> {
		const decoder = new TextDecoder();
		let buffer = "";
		for await (const chunk of stdout) {
			buffer += decoder.decode(chunk, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				if (line.trim()) this.deliver(line);
			}
		}
	}

	private deliver(line: string): void {
		let reply: Reply & { id?: number; error?: string };
		try {
			reply = JSON.parse(line) as typeof reply;
		} catch {
			return;
		}
		if (reply.id === undefined) return;
		const waiting = this.pending.get(reply.id);
		if (!waiting) return;
		this.pending.delete(reply.id);
		if (reply.error !== undefined) {
			waiting.reject(new Error(explainEmbedderFailure(reply.error)));
		} else waiting.resolve(reply);
	}
}

/**
 * A WebAssembly abort from the embedding model, made legible.
 *
 * ONNX Runtime aborts its Emscripten runtime with "Aborted(). Build with
 * -sASSERTIONS for more info." — opaque, and by the time it reaches a report
 * line nothing says it came from the embedder or what to do about it. The
 * signature is recognised here and rewritten with the usual cause and the
 * one action that clears it, the original text kept on the end so nothing is
 * hidden. Anything that is not that abort passes through untouched.
 */
export function explainEmbedderFailure(raw: string): string {
	if (!/\bAborted\(\)/.test(raw)) return raw;
	return (
		"the embedding model crashed its WebAssembly runtime, usually a " +
		"corrupt or half-downloaded model file, or too little memory to load " +
		"the model. Clear the transformers cache " +
		"(node_modules/@huggingface/transformers/.cache) so the model " +
		"re-downloads, or set PICHART_EMBED_MODEL to a smaller model. " +
		`Original: ${raw}`
	);
}

/** What one line back from the worker can carry. */
interface Reply {
	vectors?: number[][];
	model?: string;
	dimensions?: number;
}

interface Resolver {
	resolve: (reply: Reply) => void;
	reject: (error: Error) => void;
}

interface Worker {
	process: Bun.Subprocess;
	stdin: { write(chunk: string): void };
}

function normalize(values: number[]): number[] {
	let sum = 0;
	for (const value of values) sum += value * value;
	const length = Math.sqrt(sum);
	if (length === 0) return values;
	return values.map((value) => value / length);
}
