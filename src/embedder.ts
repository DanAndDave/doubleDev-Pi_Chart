/**
 * Turns text into a vector so Turns can be found by meaning.
 *
 * Injected rather than imported, so the default suite runs without a model
 * download and so the model behind it can be swapped on evidence later.
 */
export interface Embedder {
	/** Vectors this embedder produces. Recorded with the schema. */
	readonly dimensions: number;
	embed(texts: string[]): Promise<number[][]>;
}

/** The model this project is pinned to, and the width of its output. */
export const PINNED_MODEL = "Xenova/bge-small-en-v1.5";
export const PINNED_DIMENSIONS = 384;

/**
 * A deterministic stand-in: a hash-derived unit vector. Shares no behaviour
 * with a real model beyond being stable and the right width, which is exactly
 * what tests of ranking mechanics need and no more than they should assume.
 */
export class StubEmbedder implements Embedder {
	constructor(readonly dimensions: number = PINNED_DIMENSIONS) {}

	async embed(texts: string[]): Promise<number[][]> {
		return texts.map((text) => this.vector(text));
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
	readonly dimensions = PINNED_DIMENSIONS;
	private worker?: Worker;
	private nextId = 0;
	private readonly pending = new Map<number, Resolver>();

	constructor(
		private readonly runtime = process.env.CM_BUN ?? "bun",
		/** How long one batch may take, including first-use model load. */
		private readonly timeoutMs = 120_000,
		/** The worker to run. A seam: tests substitute a misbehaving one. */
		private readonly script = new URL("./embedder-worker.ts", import.meta.url)
			.pathname,
	) {}

	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		const worker = this.start();
		const id = this.nextId++;
		const { promise, resolve, reject } = Promise.withResolvers<number[][]>();
		this.pending.set(id, { resolve, reject });

		// A dead worker must surface as a failure, never as a promise nobody
		// settles: the context handler awaits this, so a hang would block the
		// Turn rather than degrade it.
		const deadline = setTimeout(() => {
			this.fail(new Error(`embedder timed out after ${this.timeoutMs}ms`));
		}, this.timeoutMs);
		deadline.unref?.();

		try {
			worker.stdin.write(JSON.stringify({ id, texts }) + "\n");
		} catch (error) {
			clearTimeout(deadline);
			this.fail(error instanceof Error ? error : new Error(String(error)));
		}

		try {
			const vectors = await promise;
			for (const vector of vectors) {
				if (vector.length !== this.dimensions) {
					throw new Error(
						`embedder produced ${vector.length} dimensions, expected ${this.dimensions}`,
					);
				}
			}
			return vectors;
		} finally {
			clearTimeout(deadline);
		}
	}

	/** Stops the worker. Safe to call when none was started. */
	close(): void {
		this.worker?.process.kill();
		this.worker = undefined;
		this.settleAll(new Error("embedder stopped"));
	}

	/** Tears down a worker that cannot serve, failing everything waiting. */
	private fail(error: Error): void {
		this.worker?.process.kill();
		this.worker = undefined;
		this.settleAll(error);
	}

	private settleAll(error: Error): void {
		for (const { reject } of this.pending.values()) reject(error);
		this.pending.clear();
	}

	private start(): Worker {
		if (this.worker) return this.worker;

		let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
		try {
			child = Bun.spawn([this.runtime, this.script], {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			});
		} catch (error) {
			throw new Error(
				`could not start the embedder with "${this.runtime}": ` +
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
		this.settleAll(
			new Error(
				`embedder exited with code ${code}${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`,
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
		let reply: { id?: number; vectors?: number[][]; error?: string };
		try {
			reply = JSON.parse(line) as typeof reply;
		} catch {
			return;
		}
		if (reply.id === undefined) return;
		const waiting = this.pending.get(reply.id);
		if (!waiting) return;
		this.pending.delete(reply.id);
		if (reply.error !== undefined) waiting.reject(new Error(reply.error));
		else waiting.resolve(reply.vectors ?? []);
	}
}

interface Resolver {
	resolve: (vectors: number[][]) => void;
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
