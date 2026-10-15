import { expect, test } from "bun:test";

import { double } from "./src/smoke.ts";

test("double(4) is 8", () => {
	expect(double(4)).toBe(8);
});
