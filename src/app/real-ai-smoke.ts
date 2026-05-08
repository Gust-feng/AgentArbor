import { runMinimalLoop } from "./minimal-loop.js";
import { UndergroundAiConfigurationError } from "./intelligence-channel-factory.js";

const DEFAULT_GOAL = "Run a short AgentArbor real AI smoke for Task Soil, Plan, Aboveground, and Fruits.";

await main();

async function main(): Promise<void> {
  const goal = process.argv.slice(2).join(" ").trim() || DEFAULT_GOAL;
  try {
    const result = await runMinimalLoop(goal, { aiMode: "openai-compatible" });
    console.log("AgentArbor real AI smoke");
    console.log(
      JSON.stringify(
        {
          status: "completed",
          mode: "openai-compatible",
          traceId: result.observationSnapshot.traceId,
          taskSoilId: result.taskSoil.taskSoilId,
          contextRefCount: result.taskSoil.contextRefs.length,
          planPackageId: result.loadedDirectionHandoffPackage.manifest.packageId,
          planStatus: result.loadedDirectionHandoffPackage.manifest.status,
          abovegroundStatus: result.observationSnapshot.aboveground.status,
          fruitId: result.fruit.id,
        },
        null,
        2
      )
    );
  } catch (error) {
    if (error instanceof UndergroundAiConfigurationError) {
      console.log("AgentArbor real AI smoke skipped");
      console.log(
        JSON.stringify(
          {
            status: "skipped",
            boundary: "configuration",
            mode: "openai-compatible",
            code: error.issue.code,
            message: configurationSkipMessage(error.issue.code),
            eventCounts: {
              requested: 0,
              completed: 0,
              failed: 0,
            },
          },
          null,
          2
        )
      );
      return;
    }
    throw error;
  }
}

function configurationSkipMessage(code: UndergroundAiConfigurationError["issue"]["code"]): string {
  if (code === "missing_api_key") {
    return "AGENTARBOR_MODEL_API_KEY or OPENAI_API_KEY is required; no provider fetch was attempted.";
  }
  if (code === "missing_model_name") {
    return "AGENTARBOR_MODEL_NAME is required; no provider fetch was attempted.";
  }
  return "AI disabled; real AI smoke was not started.";
}
