// A worker whose model runs but whose WebAssembly runtime aborts mid-inference,
// forwarding the Emscripten abort as an error reply exactly as the real worker
// does. This is the user-reported shape: the process survives, so no exit code
// prefixes the message. Used to prove the abort reaches the caller legibly.

for await (const line of console) {
	if (!line.trim()) continue;
	const { id } = JSON.parse(line) as { id: number };
	process.stdout.write(
		JSON.stringify({
			id,
			error: "Aborted(). Build with -sASSERTIONS for more info.",
		}) + "\n",
	);
}
export {};
