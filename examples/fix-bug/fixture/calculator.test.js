import assert from "node:assert/strict";
import test from "node:test";
import { add } from "./calculator.js";

test("add returns the sum of two numbers", () => {
  assert.equal(add(1, 2), 3);
});
