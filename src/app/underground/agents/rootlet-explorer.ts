/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ②' 固定拓扑主体（强耦合 directionHandoffPackage/Plan，不做本期主线）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import type { Constraint } from "../../../domain/contracts.js";
import type {
  AgentActionOutput,
  AgentDecision,
  AgentLoop,
  AgentPercept,
  AgentProtocol,
  AgentRunContext,
  GuardedActionOutput,
  GuardViolation,
  GoalIntentProfile,
  RootletClusterKind,
  RootletClusterPlan,
  RootletOutput,
  UndergroundAgentInvocation,
  UndergroundExplorationPlan,
  WorkspaceSnapshot,
} from "../../../domain/underground/index.js";
import {
  acceptGuardedAction,
  evidenceId,
  fallbackGuardedAction,
  rejectGuardedAction,
} from "../../../domain/underground/index.js";
import { sanitizeUndergroundConvergenceAiAdvisoryText } from "../../../domain/underground/radial-growth.js";
import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { createGoalIntentProfileForMinimalUnderground } from "../primitives/underground-goal-profile.js";
import { createRootletOutputForInvocation } from "../primitives/underground-rootlets.js";
import { createDeterministicFallbackRootletOutputs } from "../fallback.js";
import {
  getRootletKindStrategy,
  getUndergroundRootletCandidateAdviceContract,
  buildUndergroundRootletCandidateAdviceMessages,
  parseUndergroundRootletCandidateAdviceOutput,
  formatUndergroundRootletCandidateAdviceSummary,
} from "./rootlet-strategies.js";
import {
  reasonWithAgentTurn,
  reasoningTraceRefs,
  type UndergroundReasoningResult,
  type UndergroundReasoningTraceEntry,
} from "./reasoning.js";

type RootletExplorerWorkspaceData = Readonly<{
  startedPlan?: UndergroundExplorationPlan;
  goalId?: string;
  rawGoal?: string;
  rootletClusters?: RootletClusterPlan[];
  runningRootletInvocations?: UndergroundAgentInvocation[];
  goalIntentProfile?: GoalIntentProfile;
  rootletOutputs?: readonly RootletOutput[];
}>;

type RootletExplorerWorkspaceSnapshot = WorkspaceSnapshot<RootletExplorerWorkspaceData>;

type RootletExplorerCapabilities = {
  readonly agentTurnRuntime?: AgentTurnRuntime;
  readonly constraints: readonly Constraint[];
};

type RootletExplorerPercept = AgentPercept & {
  readonly cluster: RootletClusterPlan;
  readonly invocation: UndergroundAgentInvocation;
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly constraints: readonly Constraint[];
  readonly siblingRootletSummaries: readonly { readonly kind: string; readonly summary: string }[];
};

type RootletExplorerDecision = AgentDecision & {
  readonly cluster: RootletClusterPlan;
  readonly invocation: UndergroundAgentInvocation;
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly candidateMaterials: readonly RootletExplorerCandidateMaterial[];
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
  readonly sourceRefs: readonly string[];
  readonly fallbackRefs: readonly string[];
};

type RootletExplorerActionOutput = AgentActionOutput & {
  readonly rootletOutputs: RootletOutput[];
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

type RootletExplorerCandidateMaterial = {
  readonly summary: string;
  readonly sourceIndex: number;
  readonly sourceRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
};

export class RootletExplorerAgent
  implements
    AgentLoop<
      RootletExplorerPercept,
      RootletExplorerDecision,
      RootletExplorerActionOutput,
      RootletExplorerWorkspaceSnapshot,
      RootletExplorerCapabilities
    >
{
  readonly agentId: string;
  readonly protocol: AgentProtocol = {
    inputs: [
      { source: "workspace", key: "startedPlan", required: true },
      { source: "workspace", key: "rootletClusters", required: true },
      { source: "workspace", key: "runningRootletInvocations", required: true },
      { source: "workspace", key: "goalId", required: true },
      { source: "workspace", key: "rawGoal", required: true },
    ],
    outputs: [
      { type: "rootlet_output", payloadSchema: "underground.rootlet_explorer.output.v1" },
    ],
  };

  constructor(readonly kind: RootletClusterKind) {
    this.agentId = `rootlet-explorer-${kind.replace("_", "-")}`;
  }

  observe(ctx: AgentRunContext<RootletExplorerWorkspaceSnapshot, RootletExplorerCapabilities>): RootletExplorerPercept {
    const snapshot = ctx.workspace.snapshot();
    const startedPlan = snapshot.data.startedPlan;
    const goalId = snapshot.data.goalId ?? "";
    const rawGoal = snapshot.data.rawGoal ?? "";
    const clusters = snapshot.data.rootletClusters ?? startedPlan?.rootletClusters ?? [];
    const invocations = snapshot.data.runningRootletInvocations ?? [];
    const cluster = clusters.find((c: RootletClusterPlan) => c.kind === this.kind);
    const invocation = invocations.find((inv: UndergroundAgentInvocation) => inv.agentId === this.agentId);
    const siblingRootletSummaries = (snapshot.data.rootletOutputs ?? [])
      .filter((output: RootletOutput) => output.kind !== this.kind)
      .map((output: RootletOutput) => ({ kind: output.kind, summary: output.summary }));
    if (cluster === undefined || invocation === undefined) {
      return {
        observedAt: new Date().toISOString(),
        inputRefs: [],
        cluster: { clusterId: "", kind: this.kind, stewardRole: "intent_core", objective: "", inputRefs: [], exitCriteria: [], status: "planned", budget: { maxCandidateOutputs: 0 } },
        invocation: { invocationId: "", agentId: this.agentId, role: "rootlet_agent", inputRefs: [], outputRefs: [], status: "running", startedAt: "" },
        goalId,
        rawGoal,
        goalIntentProfile: snapshot.data.goalIntentProfile,
        constraints: ctx.capabilities?.constraints ?? [],
        siblingRootletSummaries,
      };
    }
    return {
      observedAt: new Date().toISOString(),
      inputRefs: [cluster.clusterId, invocation.invocationId],
      cluster,
      invocation,
      goalId,
      rawGoal,
      goalIntentProfile: snapshot.data.goalIntentProfile,
      constraints: ctx.capabilities?.constraints ?? [],
      siblingRootletSummaries,
    };
  }

  async reason(
    ctx: AgentRunContext<RootletExplorerWorkspaceSnapshot, RootletExplorerCapabilities>,
    percept: RootletExplorerPercept
  ): Promise<RootletExplorerDecision> {
    const goalIntentProfile = percept.goalIntentProfile ?? createGoalIntentProfileForMinimalUnderground({
      goalId: percept.goalId,
      rawGoal: percept.rawGoal,
      constraints: percept.constraints,
    });
    const strategy = getRootletKindStrategy(percept.cluster.kind);
    const adviceContract = getUndergroundRootletCandidateAdviceContract(percept.cluster.kind);
    const ai = await reasonWithAgentTurn<readonly RootletExplorerCandidateMaterial[]>({
      agentId: this.agentId,
      agentTurnRuntime: ctx.capabilities?.agentTurnRuntime,
      traceId: ctx.workspace.snapshot().traceId,
      goalId: percept.goalId,
      purpose: "rootlet_candidate",
      outputContract: adviceContract.modelOutputContract,
      callerRef: { kind: "rootlet", id: percept.cluster.clusterId, label: percept.cluster.kind },
      inputRefs: [
        { kind: "goal", id: percept.goalId },
        { kind: "rootlet", id: percept.cluster.clusterId, label: percept.cluster.kind },
      ],
      inputRefIds: percept.inputRefs,
      messages: buildUndergroundRootletCandidateAdviceMessages({
        goal: percept.rawGoal,
        goalIntentProfile,
        cluster: percept.cluster,
        constraints: percept.constraints,
        siblingRootletSummaries: percept.siblingRootletSummaries.length > 0 ? percept.siblingRootletSummaries : undefined,
      }),
      constraints: percept.constraints,
      allowedTools: strategy.availableTools,
      maxModelRounds: 3,
      maxToolRounds: 2,
      fallback: "deterministic",
      budget: { maxOutputTokens: 256, maxLatencyMs: 30_000 },
      parse: (output, response) => {
        const parsed = parseUndergroundRootletCandidateAdviceOutput({
          kind: percept.cluster.kind,
          output,
          maxCandidates: percept.cluster.budget.maxCandidateOutputs,
        });
        if (parsed.candidates.length === 0) {
          return {
            ok: false,
            reason: parsed.issues.length > 0 ? "rootlet_candidate:parser_rejected_all_candidates" : "rootlet_candidate:no_candidates",
            decisionSummary: "Rootlet model output did not produce any parser-accepted candidate material.",
            uncertainty: "Rootlet Explorer will materialize deterministic fallback output with explicit fallback refs.",
            confidence: 0.18,
          };
        }
        return {
          ok: true,
          value: parsed.candidates.map((candidate) => ({
            summary: formatUndergroundRootletCandidateAdviceSummary(candidate),
            sourceIndex: candidate.sourceIndex,
            sourceRefs: [
              adviceContract.modelOutputContract.contractId,
              `rootlet-variant:${percept.cluster.kind}:${candidate.sourceIndex + 1}`,
              `model-candidate:${percept.cluster.kind}:${candidate.sourceIndex + 1}`,
              response.requestId,
              response.responseId,
            ],
            evidenceRefs: [
              evidenceId(percept.goalId, `rootlet:${percept.cluster.kind}:${candidate.sourceIndex + 1}`),
              `model-call:${response.responseId}`,
            ],
          })),
          decisionSummary: `Rootlet Explorer accepted ${parsed.candidates.length} ${percept.cluster.kind} candidate material item(s) from parser-validated model output.`,
          uncertainty: parsed.discardedCount > 0
            ? `${parsed.discardedCount} rootlet candidate item(s) were discarded by the app parser before act.`
            : "Rootlet candidate material remains lower-layer evidence for parent convergence.",
          confidence: confidenceFromRootletOutput(response.structuredOutput) ?? 0.72,
        };
      },
    });
    const reasoningRefs = reasoningTraceRefs(ai.reasoningTrace);
    const fallbackRefs = rootletFallbackRefs(percept.cluster.kind, ai);
    const baseSourceRefs = rootletReasoningSourceRefs(ai);
    const candidateMaterials =
      ai.source === "ai" && ai.value !== undefined
        ? ai.value.map((material) => ({
            ...material,
            sourceRefs: unique([...baseSourceRefs, ...material.sourceRefs]),
            evidenceRefs: unique([...material.evidenceRefs, ...ai.toolCallRefs]),
          }))
        : [];
    return {
      decidedAt: new Date().toISOString(),
      rationaleRefs: [
        percept.cluster.clusterId,
        percept.invocation.invocationId,
        ...reasoningRefs,
        ...(candidateMaterials.length > 0 ? ["rootlet-explorer:ai-parser-accepted"] : fallbackRefs),
      ],
      cluster: percept.cluster,
      invocation: percept.invocation,
      goalId: percept.goalId,
      rawGoal: percept.rawGoal,
      goalIntentProfile,
      candidateMaterials,
      source: candidateMaterials.length > 0 ? "ai" : "deterministic_fallback",
      confidence: ai.confidence,
      reasoningTrace: ai.reasoningTrace,
      sourceRefs: candidateMaterials.length > 0 ? baseSourceRefs : unique([...baseSourceRefs, ...fallbackRefs]),
      fallbackRefs,
    };
  }

  async act(
    ctx: AgentRunContext<RootletExplorerWorkspaceSnapshot, RootletExplorerCapabilities>,
    decision: RootletExplorerDecision
  ): Promise<RootletExplorerActionOutput> {
    if (decision.source === "ai" && decision.candidateMaterials.length > 0) {
      const constraints = [...(ctx.capabilities?.constraints ?? [])];
      const rootletOutputs = decision.candidateMaterials.map((material) =>
        createRootletOutputForInvocation({
          goalId: decision.goalId,
          cluster: decision.cluster,
          invocation: decision.invocation,
          constraints,
          goalIntentProfile: decision.goalIntentProfile,
          summary: material.summary,
          source: "ai",
          sourceRefs: unique([...decision.sourceRefs, ...material.sourceRefs]),
          evidenceRefs: material.evidenceRefs,
        })
      );
      return {
        outputRefs: rootletOutputs.map((o: RootletOutput) => o.outputId),
        rootletOutputs,
        source: "ai",
        confidence: decision.confidence,
        reasoningTrace: decision.reasoningTrace,
      };
    }
    return this.actDeterministic(ctx, decision);
  }

  guard(
    ctx: AgentRunContext<RootletExplorerWorkspaceSnapshot, RootletExplorerCapabilities>,
    output: RootletExplorerActionOutput
  ): GuardedActionOutput<RootletExplorerActionOutput> {
    const violations: GuardViolation[] = [];
    for (const rootletOutput of output.rootletOutputs) {
      if (rootletOutput.outputId.length === 0) {
        violations.push({ code: "ROOTLET_EXPLORER_EMPTY_OUTPUT_ID", message: "Rootlet output must have a non-empty outputId." });
      }
      if (rootletOutput.clusterId.length === 0) {
        violations.push({ code: "ROOTLET_EXPLORER_EMPTY_CLUSTER_ID", message: "Rootlet output must have a non-empty clusterId." });
      }
      if (rootletOutput.summary.length === 0) {
        violations.push({ code: "ROOTLET_EXPLORER_EMPTY_SUMMARY", message: "Rootlet output must have a non-empty summary." });
      }
    }
    const budget = ctx.workspace.snapshot().data.startedPlan?.budget;
    if (budget !== undefined && budget.exhausted) {
      violations.push({ code: "ROOTLET_EXPLORER_BUDGET_EXHAUSTED", message: "Exploration budget is exhausted.", severity: "warning" });
    }
    const constraints = ctx.capabilities?.constraints ?? [];
    for (const constraint of constraints) {
      if (constraint.level === "hard" && constraint.status === "violated") {
        violations.push({ code: "ROOTLET_EXPLORER_HARD_CONSTRAINT_VIOLATED", message: `Hard constraint ${constraint.id} is violated.`, severity: "error" });
      }
    }
    const sanitizedOutputs = output.rootletOutputs.map((rootletOutput: RootletOutput) => ({
      ...rootletOutput,
      summary: sanitizeUndergroundConvergenceAiAdvisoryText(rootletOutput.summary),
    }));
    const sanitizedOutput: RootletExplorerActionOutput = {
      ...output,
      rootletOutputs: sanitizedOutputs,
    };
    if (violations.some((v) => v.severity !== "warning")) {
      return rejectGuardedAction({ output: sanitizedOutput, violations });
    }
    if (violations.length > 0) {
      return fallbackGuardedAction({
        output: sanitizedOutput,
        violations,
        sourceRefs: ["rootlet-explorer:guard-warning"],
        reason: "Guard warnings detected.",
      });
    }
    return acceptGuardedAction(sanitizedOutput);
  }

  private actDeterministic(
    ctx: AgentRunContext<RootletExplorerWorkspaceSnapshot, RootletExplorerCapabilities>,
    decision: RootletExplorerDecision
  ): RootletExplorerActionOutput {
    const constraints = [...(ctx.capabilities?.constraints ?? [])];
    const rootletOutputs = createDeterministicFallbackRootletOutputs({
      goalId: decision.goalId,
      cluster: decision.cluster,
      invocation: decision.invocation,
      constraints,
      sourceRefs: unique([...decision.sourceRefs, ...decision.fallbackRefs]),
      goalIntentProfile: decision.goalIntentProfile,
    });
    return {
      outputRefs: rootletOutputs.map((o: RootletOutput) => o.outputId),
      rootletOutputs,
      source: "deterministic_fallback",
      confidence: decision.confidence,
      reasoningTrace: decision.reasoningTrace,
    };
  }
}

function rootletReasoningSourceRefs(ai: UndergroundReasoningResult<unknown>): string[] {
  return unique([
    ...ai.modelCallRefs.flatMap((ref) => [
      "model.requested",
      ref.validationStatus === "passed" ? "model.completed" : "model.failed",
      ref.requestId,
      ref.responseId,
    ]),
    ...ai.toolCallRefs,
    ...ai.fallbackRefs,
  ].filter((value): value is string => typeof value === "string" && value.length > 0));
}

function rootletFallbackRefs(
  kind: RootletClusterKind,
  ai: UndergroundReasoningResult<unknown>
): string[] {
  return unique([
    `ai-fallback:${kind}`,
    ...ai.fallbackRefs,
    ai.failureReason === undefined ? undefined : `ai-fallback-reason:${fallbackReasonRef(ai.failureReason)}`,
  ].filter((value): value is string => typeof value === "string" && value.length > 0));
}

function fallbackReasonRef(value: string): string {
  const sanitized = sanitizeUndergroundConvergenceAiAdvisoryText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "unknown";
}

function confidenceFromRootletOutput(output: unknown): number | undefined {
  const record = typeof output === "object" && output !== null && !Array.isArray(output)
    ? (output as Readonly<Record<string, unknown>>)
    : {};
  const value = record.confidence;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
