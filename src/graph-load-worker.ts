// The worker thread `loadInWorker` starts: reads one extraction, answers
// with what it came to, and exits. A file of its own because a worker
// needs an entry point.
import { parentPort, workerData } from "node:worker_threads";

import { readExtraction } from "./graph-load.ts";

const { path, skip } = workerData as { path: string; skip: readonly string[] };
parentPort?.postMessage(readExtraction(await Bun.file(path).text(), skip));
