import type { ArborMessageType } from "../domain/common.js";
import type { TaskSoil } from "../domain/soil/task-soil.js";
import type { AgentRunTree, ParentSynthesisResult } from "../domain/underground/agent-fabric.js";
import type { ArtifactRecord } from "../kernel/artifacts/in-memory-artifact-store.js";
import { createMessage } from "../kernel/messages/create-message.js";
import type {
  CognitiveWorkSessionReport,
  CognitiveWorkSessionResult,
  CognitiveWorkSessionStatus,
  CognitiveWorkSessionStep,
  WorkSessionChildMaterial,
} from "./cognitive-work-session-contracts.js";
import { MANAGER_AGENT_ID } from "./cognitive-work-session-fabric.js";
import { toolCallRefsFromEvents } from "./cognitive-work-session-run-projection.js";
import { safeText, unique } from "./cognitive-work-session-safe.js";
import type { MinimalRuntime } from "./runtime.js";

export function publishGoalReceived(input: {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: "desktop-shell", role: "user" },
      to: { group: "desktop-shell" },
      type: "goal.received",
      intent: "start_cognitive_work_session",
      payload: {
        goalId: input.goalId,
        taskSoilId: input.taskSoil.taskSoilId,
        goalSummary: safeText(input.goal, 300),
        contextRefCount: input.taskSoil.contextRefs.length,
        permissionBoundaryRefs: input.taskSoil.permissionBoundaryRefs,
      },
    })
  );
}

export function publishFinalArtifact(input: {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly finalArtifact: ArtifactRecord;
  readonly report: CognitiveWorkSessionReport;
  readonly synthesis: ParentSynthesisResult;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: MANAGER_AGENT_ID, role: "work_session_manager" },
      to: { group: "desktop-shell" },
      type: "artifact.produced",
      intent: "produce_work_session_report",
      payload: {
        artifactRef: input.finalArtifact.ref,
        artifactId: input.finalArtifact.ref.id,
        summary: input.finalArtifact.summary,
        sourceRefs: input.synthesis.outputRefs,
        evidenceRefs: input.report.evidenceRefs,
        uncertainty: input.report.uncertainty,
        nextActions: input.report.nextActions,
      },
      artifacts: [input.finalArtifact.ref],
    })
  );
}

export function renderReport(input: {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly report: CognitiveWorkSessionReport;
  readonly synthesis: ParentSynthesisResult;
  readonly childMaterials: readonly WorkSessionChildMaterial[];
  readonly steps: readonly CognitiveWorkSessionStep[];
}): string {
  const lines = [
    `# ${input.report.title}`,
    "",
    `目标：${safeText(input.goal, 700)}`,
    `任务上下文：${input.taskSoil.taskSoilId}`,
    `父层综合：${input.synthesis.synthesisId}`,
    "",
    "## 关键发现",
    ...input.report.keyFindings.map((finding) => `- ${safeText(finding, 700)}`),
    "",
    "## 优化建议",
    ...input.report.recommendations.map((recommendation) => `- ${safeText(recommendation, 700)}`),
    "",
    "## 工作步骤",
    ...input.steps.map((step) => `- Step ${step.stepIndex} ${step.action}: ${safeText(step.summary, 500)}`),
    "",
    "## 局部材料摘要",
    ...input.childMaterials.map((material) => `- ${safeText(material.summary, 500)}`),
    "",
    "## 证据引用",
    ...input.report.evidenceRefs.map((ref) => `- ${safeText(ref, 180)}`),
    "",
    "## 不确定性",
    ...(input.report.uncertainty.length === 0
      ? ["- 无明确不确定性。"]
      : input.report.uncertainty.map((item) => `- ${safeText(item, 500)}`)),
    "",
    "## 下一步",
    ...(input.report.nextActions.length === 0
      ? ["- 等待用户审阅报告。"]
      : input.report.nextActions.map((item) => `- ${safeText(item, 500)}`)),
  ];
  return lines.join("\n");
}

export function stoppedResult(input: {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly taskSoil: TaskSoil;
  readonly agentRunTree: AgentRunTree;
  readonly openQuestion: string;
  readonly status?: CognitiveWorkSessionStatus;
  readonly steps?: readonly CognitiveWorkSessionStep[];
  readonly evidenceRefs?: readonly string[];
  readonly modelCallRefs?: readonly string[];
  readonly toolCallRefs?: readonly string[];
}): CognitiveWorkSessionResult {
  return {
    status: input.status ?? "stopped",
    traceId: input.traceId,
    goalId: input.goalId,
    runtime: input.runtime,
    taskSoil: input.taskSoil,
    agentRunTree: input.agentRunTree,
    openQuestions: [input.openQuestion],
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    uncertainty: [input.openQuestion],
    nextActions: ["Configure AI runtime and rerun the Desktop Work Session."],
    steps: [...(input.steps ?? [])],
    modelCallRefs: [...(input.modelCallRefs ?? [])],
    toolCallRefs: unique([...(input.toolCallRefs ?? []), ...toolCallRefsFromEvents(input.runtime.eventLog.list())]),
    eventTypes: input.runtime.eventLog.types(),
  };
}
