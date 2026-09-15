import assert from "node:assert/strict";
import test from "node:test";
import { applicationRouter } from "../src/router.mjs";

test("health and readiness routes respond", () => {
  assert.equal(applicationRouter.get("/health")(), "ok");
  assert.equal(applicationRouter.get("/ready")(), "ready");
});
