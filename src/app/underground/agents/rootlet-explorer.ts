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
  fallbackGuardedAction,
  rejectGuardedAction,
} from "../../../domain/underground/index.js";
import { sanitizeUndergroundConvergenceAiAdvisoryText } from "../../../domain/underground/radial-growth.js";
import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { createRootletOutputsForInvocation } from "../../underground-rootlets.js";
import { createDeterministicFallbackRootletOutputs } from "../fallback.js";
import {
  getRootletKindStrategy,
  getUndergroundRootletCandidateAdviceContract,
  buildUndergroundRootletCandidateAdviceMessages,
  parseUndergroundRootletCandidateAdviceOutput,
} from "./rootlet-strategies.js";

type RootletExplorerWorkspaceData = Readonly<{
  startedPlan?: UndergroundExplorationPlan;
  goalId?: string;
  rawGoal?: string;
  rootletClusters?: RootletClusterPlan[];
  runningRootletInvocations?: UndergroundAgentInvocation[];
  goalIntentProfile?: GoalIntentProfile;
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
};

type RootletExplorerDecision = AgentDecision & {
  readonly useAi: boolean;
  readonly cluster: RootletClusterPlan;
  readonly invocation: UndergroundAgentInvocation;
  readonly goalId: string;
  readonly rawGoal: string;
};

type RootletExplorerActionOutput = AgentActionOutput & {
  readonly rootletOutputs: RootletOutput[];
  readonly source: "ai" | "deterministic_fallback";
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
    if (cluster === undefined || invocation === undefined) {
      return {
        observedAt: new Date().toISOString(),
        inputRefs: [],
        cluster: { clusterId: "", kind: this.kind, stewardRole: "intent_core", objective: "", inputRefs: [], exitCriteria: [], status: "planned", budget: { maxCandidateOutputs: 0 } },
        invocation: { invocationId: "", agentId: this.agentId, role: "rootlet_agent", inputRefs: [], outputRefs: [], status: "running", startedAt: "" },
        goalId,
        rawGoal,
      };
    }
    return {
      observedAt: new Date().toISOString(),
      inputRefs: [cluster.clusterId, invocation.invocationId],
      cluster,
      invocation,
      goalId,
      rawGoal,
    };
  }

  reason(
    ctx: AgentRunContext<RootletExplorerWorkspaceSnapshot, RootletExplorerCapabilities>,
    percept: RootletExplorerPercept
  ): RootletExplorerDecision {
    const useAi = ctx.capabilities?.agentTurnRuntime !== undefined;
    return {
      decidedAt: new Date().toISOString(),
      rationaleRefs: useAi ? ["rootlet-explorer:ai-path"] : ["rootlet-explorer:deterministic-fallback"],
      useAi,
      cluster: percept.cluster,
      invocation: percept.invocation,
      goalId: percept.goalId,
      rawGoal: percept.rawGoal,
    };
  }

  async act(
    ctx: AgentRunContext<RootletExplorerWorkspaceSnapshot, RootletExplorerCapabilities>,
    decision: RootletExplorerDecision
  ): Promise<RootletExplorerActionOutput> {
    if (decision.useAi && ctx.capabilities?.agentTurnRuntime !== undefined) {
      return this.actWithAi(ctx, decision);
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

  private async actWithAi(
    ctx: AgentRunContext<RootletExplorerWorkspaceSnapshot, RootletExplorerCapabilities>,
    decision: RootletExplorerDecision
  ): Promise<RootletExplorerActionOutput> {
    const agentTurnRuntime = ctx.capabilities!.agentTurnRuntime!;
    const strategy = getRootletKindStrategy(decision.cluster.kind);
    const adviceContract = getUndergroundRootletCandidateAdviceContract(decision.cluster.kind);
    const goalIntentProfile = ctx.workspace.snapshot().data.goalIntentProfile;
    const constraints = [...(ctx.capabilities?.constraints ?? [])];
    const messages = buildUndergroundRootletCandidateAdviceMessages({
      goal: decision.rawGoal,
      goalIntentProfile: goalIntentProfile!,
      cluster: decision.cluster,
      constraints,
    });
    const turn = await agentTurnRuntime.execute({
      policy: {
        allowModel: true,
        allowedTools: strategy.availableTools,
        maxModelRounds: 3,
        maxToolRounds: 2,
        fallback: "deterministic",
        callerAgentId: this.agentId,
        traceId: ctx.workspace.snapshot().traceId,
        goalId: decision.goalId,
        purpose: "rootlet_candidate",
        outputContract: adviceContract.modelOutputContract,
        budget: { maxOutputTokens: 256, maxLatencyMs: 30_000 },
        sensitivity: "internal",
      },
      callerRef: { kind: "rootlet", id: decision.cluster.clusterId, label: decision.cluster.kind },
      inputRefs: [
        { kind: "goal", id: decision.goalId },
        { kind: "rootlet", id: decision.cluster.clusterId, label: decision.cluster.kind },
      ],
      sanitizedMessages: messages,
      constraintRefs: constraints.map((c) => ({
        constraintId: c.id,
        requiredLevel: c.level,
        enforcementGate: c.enforcementGate,
      })),
    });
    const response = turn.finalOutput;
    if (
      response === undefined ||
      turn.status !== "completed" ||
      turn.stoppedReason === "max_tool_rounds" ||
      turn.stoppedReason === "max_model_rounds"
    ) {
      return this.actDeterministic(ctx, decision);
    }
    if (response.status !== "completed" || response.validation.status !== "passed") {
      return this.actDeterministic(ctx, decision);
    }
    const parsed = parseUndergroundRootletCandidateAdviceOutput({
      kind: decision.cluster.kind,
      output: response.structuredOutput,
      maxCandidates: decision.cluster.budget.maxCandidateOutputs,
    });
    if (parsed.candidates.length === 0) {
      return this.actDeterministic(ctx, decision);
    }
    const aiOutputs = parsed.candidates.map((candidate) => {
      const base = createRootletOutputsForInvocation({
        goalId: decision.goalId,
        cluster: decision.cluster,
        invocation: decision.invocation,
        constraints,
        goalIntentProfile,
        sourceRefs: [response.requestId, response.responseId],
      });
      const matching = base[candidate.sourceIndex] ?? base[0];
      return {
        ...matching,
        summary: sanitizeUndergroundConvergenceAiAdvisoryText(
          candidate.summary + (candidate.details ? ` ${Object.values(candidate.details).flat().join("; ")}` : "")
        ),
        source: "ai" as const,
        sourceRefs: [
          ...matching.sourceRefs,
          "model.requested",
          "model.completed",
          response.requestId,
          response.responseId,
        ],
      };
    });
    return {
      outputRefs: aiOutputs.map((o: RootletOutput) => o.outputId),
      rootletOutputs: aiOutputs,
      source: "ai",
    };
  }

  private actDeterministic(
    ctx: AgentRunContext<RootletExplorerWorkspaceSnapshot, RootletExplorerCapabilities>,
    decision: RootletExplorerDecision
  ): RootletExplorerActionOutput {
    const constraints = [...(ctx.capabilities?.constraints ?? [])];
    const goalIntentProfile = ctx.workspace.snapshot().data.goalIntentProfile;
    const rootletOutputs = createDeterministicFallbackRootletOutputs({
      goalId: decision.goalId,
      cluster: decision.cluster,
      invocation: decision.invocation,
      constraints,
      goalIntentProfile,
    });
    return {
      outputRefs: rootletOutputs.map((o: RootletOutput) => o.outputId),
      rootletOutputs,
      source: "deterministic_fallback",
    };
  }
}
