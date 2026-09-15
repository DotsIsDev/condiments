import assert from "node:assert/strict";
import test from "node:test";
import { double } from "../src/double.mjs";

test("doubles a value", () => {
  assert.equal(double(4), 8);
});

