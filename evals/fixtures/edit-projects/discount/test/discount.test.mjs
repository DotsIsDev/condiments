import assert from "node:assert/strict";
import test from "node:test";
import { loyaltyDiscount } from "../src/discount.mjs";

test("discount includes exact threshold", () => {
  assert.equal(loyaltyDiscount(99), 0);
  assert.equal(loyaltyDiscount(100), 0.1);
});
