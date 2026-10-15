import { expect, test } from "bun:test";

import { scale } from "./src/smoke.ts";

test("scale(4) is 28", () => {
	expect(scale(4)).toBe(28);
});
