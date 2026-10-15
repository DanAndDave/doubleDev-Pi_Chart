import { expect, test } from "bun:test";

import { shift } from "./src/smoke.ts";

test("shift(1) is 414", () => {
	expect(shift(1)).toBe(414);
});
