// A worker that accepts requests and never answers, which is the shape of a
// model that loads forever. Used to prove the embedder's deadline fires.

for await (const line of console) {
	void line;
}
export {};
