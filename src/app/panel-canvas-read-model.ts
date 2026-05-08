import type { MinimalLoopResult } from "./minimal-loop.js";
import type {
  PanelObservationReadModel,
  PanelRunTrackingReadModel,
  PanelRunTranscript,
} from "./panel-run-read-model.js";
import { redactSensitiveText } from "../kernel/redaction.js";

export type PanelRunCanvasReadModel = {
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

export function createPanelRunCanvas(input: {
  readonly result: MinimalLoopResult;
  readonly observation: PanelObservationReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly transcript: PanelRunTranscript;
}): PanelRunCanvasReadModel {
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
        "Plan 来自父层 synthesis 和 Convergence Judge 收束后的候选，并通过 Plan Package validation 后才交给 Aboveground Execution Runtime。",
      observationPanelRole:
        `Observation Panel 保留 Agent Run Tree、delegation、parent synthesis、模型/工具 refs 和 trace；当前 transcript 安全事件 ${input.transcript.events.length} 条。`,
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
  return `推荐方向已由 ${childCount} 个 child/rootlet run 和 ${evidenceCount} 个关键 evidence ref 支撑，并进入 approved Plan Package。`;
}

function safeText(value: string, maxLength: number): string {
  const redacted = redactSensitiveText(value);
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}…`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
