import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveWorkerRuntimeAccess } from "../src/railwayRuntime.js";

test("keeps local and persistent Railway workers active", () => {
  for (const railwayEnvironment of [undefined, "dev", "staging", "production"]) {
    const access = resolveWorkerRuntimeAccess({
      RAILWAY_ENVIRONMENT_NAME: railwayEnvironment,
    });

    assert.equal(access.mode, "active");
    assert.equal(access.jobsEnabled, true);
    assert.equal(access.conversionsEnabled, true);
  }
});

test("makes PR and unknown Railway environments health-only", () => {
  for (const railwayEnvironment of ["glass-pr-186", "preview", "qa"]) {
    const access = resolveWorkerRuntimeAccess({
      RAILWAY_ENVIRONMENT_NAME: railwayEnvironment,
    });

    assert.deepEqual(access, {
      mode: "health_only",
      railwayEnvironment,
      jobsEnabled: false,
      conversionsEnabled: false,
    });
  }
});

test("normalizes persistent Railway environment names", () => {
  const access = resolveWorkerRuntimeAccess({
    RAILWAY_ENVIRONMENT_NAME: " Production ",
  });

  assert.deepEqual(access, {
    mode: "active",
    railwayEnvironment: "Production",
    jobsEnabled: true,
    conversionsEnabled: true,
  });
});
