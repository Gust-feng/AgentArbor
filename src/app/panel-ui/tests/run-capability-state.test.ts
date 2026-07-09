import assert from "node:assert/strict";
import test from "node:test";
import { nextRunCapabilityState } from "../src/run-capability-state.js";

test("panel run capability state only reuses facts for the same run", () => {
  const run1Capabilities = capabilityResolution("run-1-resolution");
  const previous = {
    capabilityResolution: run1Capabilities,
    capabilityResolutionRunId: "run-1",
  };

  const sameRunWithoutCapabilities = nextRunCapabilityState(previous, {
    runId: "run-1",
  });

  assert.equal(sameRunWithoutCapabilities.capabilityResolution, run1Capabilities);
  assert.equal(sameRunWithoutCapabilities.capabilityResolutionRunId, "run-1");

  const refreshedRun1Capabilities = capabilityResolution("run-1-resolution-refreshed");
  const sameRunWithCapabilities = nextRunCapabilityState(previous, {
    runId: "run-1",
    capabilityResolution: refreshedRun1Capabilities,
  });

  assert.equal(sameRunWithCapabilities.capabilityResolution, refreshedRun1Capabilities);
  assert.equal(sameRunWithCapabilities.capabilityResolutionRunId, "run-1");

  const nextRunWithoutCapabilities = nextRunCapabilityState(previous, {
    runId: "run-2",
  });

  assert.equal(nextRunWithoutCapabilities.capabilityResolution, undefined);
  assert.equal(nextRunWithoutCapabilities.capabilityResolutionRunId, undefined);

  const run2Capabilities = capabilityResolution("run-2-resolution");
  const nextRunWithCapabilities = nextRunCapabilityState(previous, {
    runId: "run-2",
    capabilityResolution: run2Capabilities,
  });

  assert.equal(nextRunWithCapabilities.capabilityResolution, run2Capabilities);
  assert.equal(nextRunWithCapabilities.capabilityResolutionRunId, "run-2");
});

function capabilityResolution(resolutionId: string): { readonly resolutionId: string } {
  return { resolutionId };
}
