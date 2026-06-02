import type { MinimalLoopResult } from "./minimal-loop.js";
import type { CognitiveWorkSessionResult } from "./cognitive-work-session.js";
import type { UndergroundDirectionSessionResult } from "./underground-direction-session.js";
import type {
  PanelObservationReadModel,
  PanelRunTrackingReadModel,
} from "./panel-run-tracking-contracts.js";
import type { PanelRunTranscript } from "./panel-run-transcript-contracts.js";
import { safeText, taskSoilCanvas, unique, type PanelTaskSoilCanvasReadModel } from "./panel-canvas-common.js";
import type { DesktopAgentCanvasReadModel } from "./panel-desktop-agent-canvas.js";
import { createSafeAgentRunTreeView, type SafeAgentRunTreeView } from "./panel-agent-run-tree-view.js";

export { createDesktopAgentCanvas, createDesktopChatCanvas } from "./panel-desktop-agent-canvas.js";
export type { DesktopAgentCanvasReadModel } from "./panel-desktop-agent-canvas.js";
export { createSafeAgentRunTreeView } from "./panel-agent-run-tree-view.js";
export type { SafeAgentRunTreeView } from "./panel-agent-run-tree-view.js";

export type PanelRunCanvasReadModel =
  | LegacyPanelRunCanvasReadModel
  | WorkSessionCanvasReadModel
  | DesktopAgentCanvasReadModel
  | UndergroundDeepCanvasReadModel;

export type LegacyPanelRunCanvasReadModel = {
  readonly kind: "desktop_shell_canvas";
  readonly taskSoil: {
    readonly taskSoilId: string;
    readonly goalId?: string;
    readonly traceId?: string;
    readonly goalSummary: string;
    readonly contextRefs: readonly {
      readonly ref: string;
      readonly kind: string;
      readonly summary?: string;
      readonly readonlyPreview?: {
        readonly title?: string;
        readonly text: string;
        readonly truncated: boolean;
      };
    }[];
    readonly permissionBoundaryRefs: readonly string[];
  };
  readonly plan: {
    readonly packageRef: {
      readonly packageId: string;
      readonly directionId: string;
      readonly version: number;
    };
    readonly status: string;
    readonly validationPassed: boolean;
    readonly recommendedDirection: {
      readonly optionId?: string;
      readonly summary: string;
      readonly reason: string;
    };
    readonly keyEvidenceRefs: readonly string[];
    readonly uncertainty: readonly string[];
  };
  readonly aboveground: {
    readonly consumer: "Aboveground Execution Runtime";
    readonly status: PanelObservationReadModel["aboveground"]["status"];
    readonly executionPlanId?: string;
    readonly workflowId?: string;
    readonly task?: {
      readonly taskId: string;
      readonly title: string;
      readonly status: string;
    };
    readonly artifact?: {
      readonly artifactId: string;
      readonly type: string;
      readonly summary: string;
    };
    readonly verification: {
      readonly reportId?: string;
      readonly status?: string;
      readonly passedChecks: number;
      readonly totalChecks: number;
    };
  };
  readonly fruits: {
    readonly fruit?: {
      readonly fruitId: string;
      readonly status: string;
      readonly artifactIds: readonly string[];
      readonly verificationIds: readonly string[];
    };
    readonly runMemory?: {
      readonly runMemoryId: string;
      readonly actualPathLength: number;
      readonly reusableSignals: readonly string[];
    };
    readonly experienceCandidate?: {
      readonly candidateId: string;
      readonly confidence: string;
      readonly governanceStatus: string;
      readonly reusablePattern: string;
    };
    readonly pathBias?: {
      readonly pathBiasId: string;
      readonly confidence: string;
      readonly preferredNodes: readonly string[];
      readonly requiredVerificationGates: readonly string[];
    };
  };
  readonly explanation: {
    readonly resultWhyReasonable: string;
    readonly observationPanelRole: string;
  };
};

export type WorkSessionCanvasReadModel = {
  readonly kind: "work_session_canvas";
  readonly taskSoil: PanelTaskSoilCanvasReadModel;
  readonly workSession: {
    readonly status: CognitiveWorkSessionResult["status"];
    readonly artifact?: {
      readonly artifactId: string;
      readonly type: string;
      readonly summary: string;
    };
    readonly directAnswer?: {
      readonly answer: string;
      readonly evidenceRefs: readonly string[];
      readonly uncertainty: readonly string[];
      readonly followUpSuggestions: readonly string[];
      readonly decisionSummary: string;
      readonly confidence: number;
    };
    readonly report?: {
      readonly title: string;
      readonly keyFindings: readonly string[];
      readonly recommendations: readonly string[];
      readonly evidenceRefs: readonly string[];
      readonly uncertainty: readonly string[];
      readonly nextActions: readonly string[];
      readonly decisionSummary: string;
      readonly confidence: number;
    };
    readonly openQuestions: readonly string[];
    readonly modelCallRefs: readonly string[];
    readonly toolCallRefs: readonly string[];
    readonly steps: readonly {
      readonly stepIndex: number;
      readonly action: string;
      readonly status: string;
      readonly summary: string;
      readonly evidenceRefs: readonly string[];
      readonly toolCallRefs: readonly string[];
      readonly childRunIds: readonly string[];
      readonly synthesisId?: string;
    }[];
  };
  readonly agentRunTree?: SafeAgentRunTreeView;
  readonly explanation: {
    readonly resultWhyReasonable: string;
    readonly observationPanelRole: string;
  };
};

export type UndergroundDeepCanvasReadModel = {
  readonly kind: "underground_deep_canvas";
  readonly task: {
    readonly goalId: string;
    readonly traceId: string;
    readonly goalSummary: string;
  };
  readonly underground: {
    readonly status: UndergroundDirectionSessionResult["terminalStatus"];
    readonly packageRef: {
      readonly packageId: string;
      readonly directionId: string;
      readonly version: number;
      readonly status: string;
      readonly validationPassed: boolean;
    };
    readonly recommendedDirection: {
      readonly optionId?: string;
      readonly summary: string;
      readonly reason: string;
    };
    readonly keyEvidenceRefs: readonly string[];
    readonly uncertainty: readonly string[];
    readonly openQuestions: readonly string[];
    readonly rootletCount: number;
    readonly childRunCount: number;
    readonly parentSynthesisCount: number;
    readonly convergenceSummary: string;
  };
  readonly agentRunTree?: SafeAgentRunTreeView;
  readonly explanation: {
    readonly resultWhyReasonable: string;
    readonly observationPanelRole: string;
  };
};

export function createPanelRunCanvas(input: {
  readonly result: MinimalLoopResult;
  readonly observation: PanelObservationReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly transcript: PanelRunTranscript;
}): LegacyPanelRunCanvasReadModel {
  const handoff = input.result.directionHandoff;
  const retainedOption = handoff.options.find((option) => option.optionId === handoff.decisionRecord.retainedOptionId);
  const recommendedOption =
    handoff.options.find((option) => option.optionId === handoff.recommendedOptionId) ?? retainedOption;
  const keyEvidenceRefs = unique([
    ...handoff.evidenceRefs,
    ...(recommendedOption?.supportingEvidenceRefs ?? []),
    ...handoff.decisionRecord.rationaleEvidenceRefs,
    ...input.observation.underground.evidenceLedger.recommendedEvidenceRefs,
  ]).slice(0, 12);
  const uncertainty = unique([
    ...handoff.missingInformation,
    ...(recommendedOption?.unknowns ?? []),
    ...input.observation.underground.convergence.openQuestions.map((question) => question.question),
  ]).slice(0, 8);

  return {
    kind: "desktop_shell_canvas",
    taskSoil: {
      taskSoilId: input.result.taskSoil.taskSoilId,
      goalId: input.result.taskSoil.goalId,
      traceId: input.result.taskSoil.traceId,
      goalSummary: safeText(input.result.taskSoil.rawGoal, 600),
      contextRefs: input.result.taskSoil.contextRefs.map((ref) => ({
        ref: ref.ref,
        kind: ref.kind,
        summary: ref.summary === undefined ? undefined : safeText(ref.summary, 240),
        readonlyPreview:
          ref.readonlyPreview === undefined
            ? undefined
            : {
                title:
                  ref.readonlyPreview.title === undefined ? undefined : safeText(ref.readonlyPreview.title, 120),
                text: safeText(ref.readonlyPreview.text, 360),
                truncated: ref.readonlyPreview.truncated || ref.readonlyPreview.text.length > 360,
              },
      })),
      permissionBoundaryRefs: [...input.result.taskSoil.permissionBoundaryRefs],
    },
    plan: {
      packageRef: {
        packageId: input.result.loadedDirectionHandoffPackage.manifest.packageId,
        directionId: input.result.loadedDirectionHandoffPackage.manifest.directionId,
        version: input.result.loadedDirectionHandoffPackage.manifest.directionVersion,
      },
      status: input.result.loadedDirectionHandoffPackage.manifest.status,
      validationPassed: input.result.loadedDirectionHandoffPackage.validation.passed,
      recommendedDirection: {
        optionId: recommendedOption?.optionId,
        summary: safeText(recommendedOption?.directionSummary ?? handoff.clarifiedGoal, 520),
        reason: planReason(input, keyEvidenceRefs.length),
      },
      keyEvidenceRefs,
      uncertainty,
    },
    aboveground: {
      consumer: "Aboveground Execution Runtime",
      status: input.observation.aboveground.status,
      executionPlanId: input.observation.aboveground.growthPlanId,
      workflowId: input.observation.aboveground.workflowId,
      task: {
        taskId: input.result.task.id,
        title: safeText(input.result.task.title, 220),
        status: input.result.task.status,
      },
      artifact: {
        artifactId: input.result.artifact.ref.id,
        type: input.result.artifact.ref.type,
        summary: safeText(input.result.artifact.summary, 260),
      },
      verification: {
        reportId: input.result.verification.id,
        status: input.result.verification.status,
        passedChecks: input.result.verification.checks.filter((check) => check.status === "passed").length,
        totalChecks: input.result.verification.checks.length,
      },
    },
    fruits: {
      fruit: {
        fruitId: input.result.fruit.id,
        status: input.result.fruit.governanceStatus,
        artifactIds: [...input.result.fruit.artifactIds],
        verificationIds: [...input.result.fruit.verificationIds],
      },
      runMemory: {
        runMemoryId: input.result.runMemory.id,
        actualPathLength: input.result.runMemory.actualPath.length,
        reusableSignals: input.result.runMemory.reusableSignals.map((value) => safeText(value, 220)),
      },
      experienceCandidate: {
        candidateId: input.result.experienceCandidate.id,
        confidence: input.result.experienceCandidate.confidence,
        governanceStatus: input.result.experienceCandidate.governanceStatus,
        reusablePattern: safeText(input.result.experienceCandidate.reusablePattern, 320),
      },
      pathBias: {
        pathBiasId: input.result.pathBias.id,
        confidence: input.result.pathBias.confidence,
        preferredNodes: [...input.result.pathBias.preferredNodes],
        requiredVerificationGates: [...input.result.pathBias.requiredVerificationGates],
      },
    },
    explanation: {
      resultWhyReasonable:
        "方案来自父层 synthesis 和 Convergence Judge 收束后的候选，并通过校验后才进入执行阶段。",
      observationPanelRole:
        `开发者详情保留运行树、delegation、parent synthesis、模型/工具 refs 和 trace；当前活动流安全事件 ${input.transcript.events.length} 条。`,
    },
  };
}

export function createWorkSessionCanvas(input: {
  readonly result: CognitiveWorkSessionResult;
  readonly transcript: PanelRunTranscript;
}): WorkSessionCanvasReadModel {
  return {
    kind: "work_session_canvas",
    taskSoil: taskSoilCanvas(input.result),
    workSession: {
      status: input.result.status,
      artifact:
        input.result.finalArtifact === undefined
          ? undefined
          : {
              artifactId: input.result.finalArtifact.ref.id,
              type: input.result.finalArtifact.ref.type,
              summary: safeText(input.result.finalArtifact.summary, 260),
            },
      directAnswer:
        input.result.directAnswer === undefined
          ? undefined
          : {
              answer: safeText(input.result.directAnswer.answer, 1200),
              evidenceRefs: input.result.directAnswer.evidenceRefs.map((value) => safeText(value, 180)),
              uncertainty: input.result.directAnswer.uncertainty.map((value) => safeText(value, 320)),
              followUpSuggestions: input.result.directAnswer.followUpSuggestions.map((value) => safeText(value, 320)),
              decisionSummary: safeText(input.result.directAnswer.decisionSummary, 420),
              confidence: input.result.directAnswer.confidence,
            },
      report:
        input.result.report === undefined
          ? undefined
          : {
              title: safeText(input.result.report.title, 220),
              keyFindings: input.result.report.keyFindings.map((value) => safeText(value, 420)),
              recommendations: input.result.report.recommendations.map((value) => safeText(value, 420)),
              evidenceRefs: input.result.report.evidenceRefs.map((value) => safeText(value, 180)),
              uncertainty: input.result.report.uncertainty.map((value) => safeText(value, 320)),
              nextActions: input.result.report.nextActions.map((value) => safeText(value, 320)),
              decisionSummary: safeText(input.result.report.decisionSummary, 420),
              confidence: input.result.report.confidence,
            },
      openQuestions: input.result.openQuestions.map((value) => safeText(value, 320)),
      modelCallRefs: [...input.result.modelCallRefs],
      toolCallRefs: [...input.result.toolCallRefs],
      steps: input.result.steps.map((step) => ({
        stepIndex: step.stepIndex,
        action: step.action,
        status: step.status,
        summary: safeText(step.summary, 360),
        evidenceRefs: step.evidenceRefs.map((value) => safeText(value, 180)),
        toolCallRefs: [...step.toolCallRefs],
        childRunIds: [...step.childRunIds],
        synthesisId: step.synthesisId,
      })),
    },
    agentRunTree: createSafeAgentRunTreeView(input.result.agentRunTree),
    explanation: {
      resultWhyReasonable:
        input.result.directAnswer !== undefined
          ? "这是一条直接回答：任务不需要读取工作区、派生子 Agent 或生成报告。"
          : input.result.status === "completed"
          ? "报告来自主会话分工检查后的父层 synthesis；局部材料没有绕过父层进入最终结果。"
          : "工作会话没有完成结果，当前只展示停止原因、开放问题和安全运行证据。",
      observationPanelRole:
        `开发者详情展示主 Agent / child run tree、父层 synthesis、模型/工具 refs 和活动流；当前安全事件 ${input.transcript.events.length} 条。`,
    },
  };
}

export function createUndergroundDeepCanvas(input: {
  readonly result: UndergroundDirectionSessionResult;
  readonly transcript: PanelRunTranscript;
}): UndergroundDeepCanvasReadModel {
  const pkg = input.result.loadedDirectionHandoffPackage;
  const handoff = pkg.directionHandoff;
  const retainedOption = handoff.options.find((option) => option.optionId === handoff.decisionRecord.retainedOptionId);
  const recommendedOption =
    handoff.options.find((option) => option.optionId === handoff.recommendedOptionId) ?? retainedOption;
  const convergence = input.result.undergroundReport.convergenceReport;
  const keyEvidenceRefs = unique([
    ...handoff.evidenceRefs,
    ...(recommendedOption?.supportingEvidenceRefs ?? []),
    ...handoff.decisionRecord.rationaleEvidenceRefs,
    ...convergence.provenanceRefs,
    ...convergence.conflictResolutionRefs,
  ]).slice(0, 12);
  const uncertainty = unique([
    ...handoff.missingInformation,
    ...(recommendedOption?.unknowns ?? []),
    ...convergence.openQuestions.map((question) => question.question),
  ]).slice(0, 8);
  return {
    kind: "underground_deep_canvas",
    task: {
      goalId: input.result.goalId,
      traceId: input.result.traceId,
      goalSummary: safeText(input.result.undergroundReport.goalIntentProfile?.rawGoal ?? handoff.clarifiedGoal, 600),
    },
    underground: {
      status: input.result.terminalStatus,
      packageRef: {
        packageId: pkg.manifest.packageId,
        directionId: pkg.manifest.directionId,
        version: pkg.manifest.directionVersion,
        status: pkg.manifest.status,
        validationPassed: pkg.validation.passed,
      },
      recommendedDirection: {
        optionId: recommendedOption?.optionId,
        summary: safeText(recommendedOption?.directionSummary ?? handoff.clarifiedGoal, 520),
        reason:
          input.result.terminalStatus === "approved_package_created"
            ? `地下组织已完成父层综合和收束，保留 ${keyEvidenceRefs.length} 个关键依据引用。`
            : "地下组织没有批准进入执行，当前只展示停止、等待或不确定材料。",
      },
      keyEvidenceRefs,
      uncertainty,
      openQuestions: convergence.openQuestions.map((question) => safeText(question.question, 320)),
      rootletCount: input.result.undergroundReport.plan.rootletClusters.length,
      childRunCount: input.result.undergroundOrchestratorRun.agentRunTree.childRuns.length,
      parentSynthesisCount: input.result.undergroundOrchestratorRun.agentRunTree.parentSyntheses.length,
      convergenceSummary: safeText(convergence.summary, 420),
    },
    agentRunTree: createSafeAgentRunTreeView(input.result.undergroundOrchestratorRun.agentRunTree),
    explanation: {
      resultWhyReasonable:
        "这是显式深度模式：只运行 Underground Cognitive Runtime 做方向组织、child/rootlet 探索、父层 synthesis 和收束；当前不进入 Aboveground 执行。",
      observationPanelRole:
        `详情里展示地下组织的 agent tree、父层 synthesis、模型/工具 refs 和安全事件；当前安全事件 ${input.transcript.events.length} 条。`,
    },
  };
}

function planReason(
  input: {
    readonly tracking: PanelRunTrackingReadModel;
  },
  evidenceCount: number
): string {
  const childCount = input.tracking.agentRunTree?.childRuns.length ?? 0;
  return `推荐方向已由 ${childCount} 路局部材料和 ${evidenceCount} 个关键证据引用支撑，并通过父层收束。`;
}
