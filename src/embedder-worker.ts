// Runs the embedding model in its own process.
//
// The harness's bundled runtime cannot load the model's native dependencies
// ("Could not load the sharp module using the linux-x64 runtime"), so the
// model runs under the project's own Bun instead. One line of JSON in, one
// line of JSON out, so the parent never has to care what the model needs.

import { pipeline } from "@huggingface/transformers";

import { PINNED_MODEL } from "./embedder.ts";

interface Request {
	id: number;
	texts: string[];
}

const model = process.env.CM_EMBED_MODEL ?? PINNED_MODEL;
const extract = await pipeline("feature-extraction", model);

for await (const line of console) {
	if (!line.trim()) continue;
	let request: Request;
	try {
		request = JSON.parse(line) as Request;
	} catch {
		continue;
	}

	try {
		const output = await extract(request.texts, {
			pooling: "mean",
			normalize: true,
		});
		process.stdout.write(
			JSON.stringify({ id: request.id, vectors: output.tolist() }) + "\n",
		);
	} catch (error) {
		process.stdout.write(
			JSON.stringify({
				id: request.id,
				error: error instanceof Error ? error.message : String(error),
			}) + "\n",
		);
	}
}
