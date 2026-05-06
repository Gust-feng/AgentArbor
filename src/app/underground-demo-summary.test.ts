import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse } from "../domain/intelligence/index.js";
import { nowIso } from "../kernel/id.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import { pendingModelOutputValidation } from "../kernel/intelligence/validation.js";
import { createUndergroundAiRuntimeConfig } from "./intelligence-channel-factory.js";
import { runUndergroundDirectionSession } from "./underground-direction-session.js";
import { runUndergroundDirectionSessionWithIntelligence } from "./underground-direction-session.js";
import { recoverUndergroundDirectionSession } from "./underground-direction-recovery.js";
import { createUndergroundDemoSummary } from "./underground-demo-summary.js";

test("createUndergroundDemoSummary reports an approved underground package", async () => {
  const { result, aiInput } = await runFakeUndergroundDirectionSession("Build a small deterministic helper.");
  const summary = createUndergroundDemoSummary(result, undefined, aiInput);

  assert.equal(summary.terminalStatus, "approved_package_created");
  assert.equal(summary.directionPackage.status, "approved");
  assert.equal(summary.directionPackage.version, 1);
  assert.deepEqual(summary.versions, [1]);
  assert.equal(summary.lineage.revisionReason, "initial");
  assert.equal(summary.recoveredPackage, undefined);
  assert.equal(summary.writtenPackagePath, undefined);
  assert.equal(summary.directionPackage.validation.passed, true);
  assert.equal(summary.ai.enabled, true);
  assert.equal(summary.ai.status, "completed");
  assert.equal(summary.ai.eventCounts.requested > 0, true);
  assert.equal(summary.ai.modelCallRefs.length > 0, true);
  assert.deepEqual(summary.underground.rootletKinds, ["option"]);
  assert.equal(summary.underground.candidateCounts.accepted, 1);
  assert.equal(summary.underground.candidateCounts.merged, 1);
  assert.equal(summary.underground.convergence.outcome, "approved");
  assert.equal(summary.userEscalation, undefined);
  assert.equal(summary.observationSnapshot.layerStatuses.aboveground, "not_started");
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), true);
  assert.equal(summary.eventLog.includes("growth_plan.completed"), false);
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
});

test("createUndergroundDemoSummary reports auto-answer recovery as approved v2", async () => {
  const { result, aiInput } = await runFakeUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );
  const recovery = recoverUndergroundDirectionSession(result);
  const summary = createUndergroundDemoSummary(result, recovery, aiInput);

  assert.equal(summary.terminalStatus, "approved_package_created");
  assert.equal(summary.directionPackage.status, "approved");
  assert.equal(summary.directionPackage.version, 2);
  assert.equal(summary.recoveredPackage?.version, 2);
  assert.deepEqual(summary.versions, [1, 2]);
  assert.equal(summary.lineage.previous?.version, 1);
  assert.equal(summary.lineage.revisionReason, "user_clarification_answered");
  assert.equal(summary.underground.convergence.outcome, "approved");
  assert.equal(summary.underground.convergence.userEscalationRequired, false);
  assert.equal(summary.eventLog.includes("user_approval.received"), true);
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), true);
  assert.equal(summary.observationSnapshot.layerStatuses.aboveground, "not_started");
});

test("createUndergroundDemoSummary reports model events and candidate-layer refs without model content", async () => {
  const { runUndergroundDirectionSessionWithIntelligence } = await import("./underground-direction-session.js");

  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new GoalSpecificCandidateProvider(),
        bus: runtime.bus,
      }),
  });
  const summary = createUndergroundDemoSummary(result, undefined, {
    enabled: true,
    mode: "fake",
    providerId: "goal-specific-candidate-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "goal-specific-candidate-model",
  });

  assert.equal(summary.ai.enabled, true);
  assert.equal(summary.ai.mode, "fake");
  assert.equal(summary.ai.status, "completed");
  assert.equal(summary.ai.providerKind, "fake");
  assert.equal(summary.ai.protocolKind, "openai_compatible_chat_completions");
  assert.equal(summary.ai.model, "goal-specific-candidate-model");
  assert.equal(result.undergroundReport.agentClusterRun, undefined);
  assert.equal(summary.ai.eventCounts.requested > 0, true);
  assert.equal(summary.ai.eventCounts.completed > 0, true);
  assert.equal(JSON.stringify(summary).includes("GoalSpecific candidate raw text"), false);
});

test("createUndergroundDemoSummary reports deterministic fallback when AI returns empty candidates", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new EmptyCandidateProvider(),
        bus: runtime.bus,
      }),
  });
  const summary = createUndergroundDemoSummary(result, undefined, {
    enabled: true,
    mode: "fake",
    providerId: "empty-candidate-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "empty-candidate-model",
  });

  assert.equal(result.undergroundReport.agentClusterRun, undefined);
  assert.equal(summary.ai.status, "completed");
  assert.equal(summary.ai.aiCandidateCount, 0);
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.source === "deterministic_fallback"),
    true
  );
  assert.equal(JSON.stringify(summary).includes("empty provider raw text"), false);
});

test("createUndergroundDemoSummary exposes awaiting-user escalation without entering Aboveground", async () => {
  const { result, aiInput } = await runFakeUndergroundDirectionSession(
    "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
  );
  const summary = createUndergroundDemoSummary(result, undefined, aiInput);

  assert.equal(summary.terminalStatus, "awaiting_user");
  assert.equal(summary.directionPackage.status, "awaiting_user");
  assert.equal(summary.directionPackage.validation.passed, false);
  assert.equal(summary.underground.convergence.outcome, "awaiting_user");
  assert.equal(summary.underground.convergence.userEscalationRequired, true);
  assert.notEqual(summary.userEscalation, undefined);
  assert.equal((summary.userEscalation?.questionCount ?? 0) > 0, true);
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), true);
  assert.equal(summary.eventLog.includes("growth_plan.completed"), false);
});

test("createUndergroundDemoSummary reports stopped runs without fabricating approval", async () => {
  const result = await runUndergroundDirectionSession("Stop because no viable candidate should be produced.");
  const summary = createUndergroundDemoSummary(result);

  assert.equal(summary.terminalStatus, "stopped");
  assert.equal(summary.directionPackage.status, "draft");
  assert.equal(summary.directionPackage.validation.passed, false);
  assert.equal(summary.underground.convergence.outcome, "stopped");
  assert.equal(summary.underground.convergence.stopReason, "ai_required_for_autonomy");
  assert.equal(summary.userEscalation, undefined);
  assert.equal(summary.eventLog.includes("direction_handoff.completed"), false);
});

test("underground demo summary does not write repo-root .agentarbor assets", async () => {
  const repoRootAgentArbor = resolve(process.cwd(), ".agentarbor");
  const before = snapshotTree(repoRootAgentArbor);

  const { result, aiInput } = await runFakeUndergroundDirectionSession("Build a small deterministic helper.");
  createUndergroundDemoSummary(result);

  assert.deepEqual(snapshotTree(repoRootAgentArbor), before);
});

function snapshotTree(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const entries: string[] = [];
  const walk = (current: string, relativePrefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolutePath = join(current, name);
      const relativePath = relativePrefix === "" ? name : `${relativePrefix}/${name}`;
      const stats = statSync(absolutePath);
      entries.push(`${relativePath}:${stats.isDirectory() ? "dir" : "file"}:${stats.size}:${stats.mtimeMs}`);
      if (stats.isDirectory()) {
        walk(absolutePath, relativePath);
      }
    }
  };

  walk(root, "");
  return entries;
}

async function runFakeUndergroundDirectionSession(goal: string) {
  const aiConfig = createUndergroundAiRuntimeConfig({ mode: "fake" });
  if (!aiConfig.enabled) {
    throw new Error("Expected fake AI runtime config to be enabled.");
  }
  return {
    result: await runUndergroundDirectionSessionWithIntelligence(goal, {
      createIntelligenceChannel: aiConfig.createIntelligenceChannel,
      createToolCenter: aiConfig.createToolCenter,
    }),
    aiInput: aiConfig.summaryInput,
  };
}

class GoalSpecificCandidateProvider implements ModelProvider {
  readonly providerId = "goal-specific-candidate-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "goal-specific-candidate-model";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const kind = rootletKindFromContractId(request.outputContract.contractId);
    const structuredOutput =
      request.outputContract.contractId === "convergence-advisory"
        ? {
            candidateAnalyses: [],
            conflictsNeedingUserInput: [],
            constraintViolations: [],
            overallDirectionSummary: "GoalSpecific candidate provider defers to convergence judge.",
          }
        : request.outputContract.contractId === "underground.autonomy_decision.v1"
          ? {
              action: "request_convergence",
              completionAssessment: "GoalSpecific candidate provider allows convergence.",
              informationGaps: [],
              spawnRequests: [],
              rationale: "Convergence Judge still owns the final report.",
              sourceRefs: [],
            }
        : {
            candidates: [
              {
                summary: `TypeScript helper module with deterministic ${kind} logic and type-safe utility functions`,
                evidenceRefs: [`model-call:${request.requestId}`],
                sourceRefs: [`model-call:${request.requestId}`],
              },
              {
                summary: `Deterministic ${kind} approach using pure functions with no side effects`,
                evidenceRefs: [`model-call:${request.requestId}`],
                sourceRefs: [`model-call:${request.requestId}`],
              },
            ],
          };
    return {
      responseId: "model-response-goal-specific-candidates",
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput,
      textOutput: "GoalSpecific candidate raw text",
      finishReason: "stop",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }
}

function rootletKindFromContractId(contractId: string): string {
  const match = contractId.match(/rootlet_candidate_advice\.([^.]+)\.v\d+/);
  return match?.[1] ?? "option";
}

class EmptyCandidateProvider implements ModelProvider {
  readonly providerId = "empty-candidate-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "empty-candidate-model";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const structuredOutput =
      request.outputContract.contractId === "convergence-advisory"
        ? {
            candidateAnalyses: [],
            conflictsNeedingUserInput: [],
            constraintViolations: [],
            overallDirectionSummary: "Empty candidate provider leaves convergence advisory neutral.",
          }
        : request.outputContract.contractId === "underground.autonomy_decision.v1"
          ? {
              action: "request_convergence",
              completionAssessment: "Empty candidate provider allows convergence after deterministic fallback.",
              informationGaps: [],
              spawnRequests: [],
              rationale: "Convergence Judge still owns the final report.",
              sourceRefs: [],
            }
        : { candidates: [] };
    return {
      responseId: "model-response-empty-candidates",
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput,
      textOutput: "empty provider raw text",
      finishReason: "stop",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }
}
