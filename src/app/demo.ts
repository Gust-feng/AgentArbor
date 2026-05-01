import { EXPECTED_DEMO_EVENTS, runMinimalLoop } from "./minimal-loop.js";

const result = runMinimalLoop();

console.log("AgentArbor minimal runtime demo");
console.log("");
console.log("EventLog replay:");
for (const entry of result.runtime.eventLog.list()) {
  console.log(`${String(entry.sequence).padStart(2, "0")}. ${entry.type}`);
}

console.log("");
console.log("Expected order:");
console.log(EXPECTED_DEMO_EVENTS.join(" -> "));

console.log("");
console.log("Summary:");
console.log(
  JSON.stringify(
    {
      loadedDirectionPackage: {
        id: result.loadedDirectionHandoffPackage.manifest.directionId,
        version: result.loadedDirectionHandoffPackage.manifest.directionVersion,
        status: result.loadedDirectionHandoffPackage.manifest.status,
      },
      fruit: result.fruit,
      runMemory: {
        id: result.runMemory.id,
        actualPath: result.runMemory.actualPath,
        artifactIds: result.runMemory.artifactIds,
        verificationIds: result.runMemory.verificationIds,
      },
      experienceCandidate: result.experienceCandidate,
      pathBias: result.pathBias,
    },
    null,
    2
  )
);
