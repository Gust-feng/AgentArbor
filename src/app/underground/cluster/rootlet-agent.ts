import { undergroundRootletAgentId } from "../../agents/manifests.js";
import {
  completeUndergroundAgentInvocation,
  cloneUndergroundAgentInvocation,
} from "../../underground-agent-cluster-runtime.js";
import { createRootletOutputsForInvocation } from "../../underground-rootlets.js";
import { requestUndergroundRootletCandidateAdvice } from "../../underground-intelligence.js";
import { publishExplorationCandidatesProduced } from "../../underground-events.js";
import type { RootletClusterKind, RootletOutput, UndergroundAgentInvocation } from "../../../domain/underground/index.js";
import type {
  RootletInvocationRequestedMessage,
  UndergroundAgent,
  UndergroundAgentContext,
} from "./agent-context.js";
import { ROOTLET_INVOCATION_REQUESTED, ensurePayloadStringEquals, requireValue } from "./agent-context.js";

export class RootletAgent implements UndergroundAgent {
  readonly agentId: string;
  private subscriptions: Array<() => void> = [];

  constructor(readonly kind: RootletClusterKind) {
    this.agentId = undergroundRootletAgentId(kind);
  }

  start(ctx: UndergroundAgentContext): void {
    this.subscriptions.push(
      ctx.subscribeInternal(
        this.agentId,
        ROOTLET_INVOCATION_REQUESTED,
        (message) => this.handleInvocationRequested(ctx, message),
        { requiresAsync: () => ctx.intelligenceChannel !== undefined }
      )
    );
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
  }

  private handleInvocationRequested(
    ctx: UndergroundAgentContext,
    message: RootletInvocationRequestedMessage
  ): void | Promise<void> {
    if (message.payload.rootletKind !== this.kind) {
      return;
    }
    const state = ctx.shared.snapshot();
    const startedPlan = requireValue(state.startedPlan, "startedPlan");
    const goalId = requireValue(state.goalId, "goalId");
    const rawGoal = requireValue(state.rawGoal, "rawGoal");
    const runningRootletInvocations = requireValue(
      state.runningRootletInvocations,
      "runningRootletInvocations"
    );
    ensurePayloadStringEquals(message.payload, "goalId", goalId, message.type);
    ensurePayloadStringEquals(message.payload, "planId", startedPlan.planId, message.type);
    const cluster = requireValue(
      startedPlan.rootletClusters.find((candidate) => candidate.clusterId === message.payload.clusterId),
      `rootlet cluster ${message.payload.clusterId}`
    );
    const invocation = requireValue(
      runningRootletInvocations.find((candidate) => candidate.invocationId === message.payload.invocationId),
      `rootlet invocation ${message.payload.invocationId}`
    );
    const baseSourceRefs = [message.id, message.type];
    if (ctx.intelligenceChannel !== undefined && state.goalIntentProfile !== undefined) {
      return this.requestModelOutputs(ctx, message, cluster, invocation, goalId, rawGoal).then((modelAdvice) => {
        if (modelAdvice.rootletOutputs.length > 0) {
          this.completeRootletInvocation(
            ctx,
            message,
            modelAdvice.rootletOutputs.slice(0, cluster.budget.maxCandidateOutputs)
          );
          return;
        }
        const deterministicRootletOutputs = createRootletOutputsForInvocation({
          goalId,
          cluster,
          invocation,
          constraints: ctx.runtime.constraints,
          goalIntentProfile: state.goalIntentProfile,
          sourceRefs: [...baseSourceRefs, ...modelAdvice.fallbackSourceRefs],
        });
        this.completeRootletInvocation(ctx, message, deterministicRootletOutputs);
      });
    }
    const deterministicRootletOutputs = createRootletOutputsForInvocation({
      goalId,
      cluster,
      invocation,
      constraints: ctx.runtime.constraints,
      goalIntentProfile: state.goalIntentProfile,
      sourceRefs: baseSourceRefs,
    });
    this.completeRootletInvocation(ctx, message, deterministicRootletOutputs);
  }

  private completeRootletInvocation(
    ctx: UndergroundAgentContext,
    message: RootletInvocationRequestedMessage,
    outputs: readonly RootletOutput[]
  ): void {
    const state = ctx.shared.snapshot();
    const startedPlan = requireValue(state.startedPlan, "startedPlan");
    const agentClusterPlan = requireValue(state.agentClusterPlan, "agentClusterPlan");
    const goalId = requireValue(state.goalId, "goalId");
    const runningRootletInvocations = requireValue(
      state.runningRootletInvocations,
      "runningRootletInvocations"
    );
    const invocation = requireValue(
      runningRootletInvocations.find((candidate) => candidate.invocationId === message.payload.invocationId),
      `rootlet invocation ${message.payload.invocationId}`
    );
    const completedInvocation = completeUndergroundAgentInvocation(
      invocation,
      outputs.map((output) => output.outputId)
    );
    const nextRootletOutputs = [...state.rootletOutputs, ...outputs];
    const nextCompletedInvocations = [...state.completedRootletInvocations, completedInvocation];

    ctx.shared.write(this.agentId, {
      rootletOutputs: nextRootletOutputs,
      completedRootletInvocations: nextCompletedInvocations,
    });

    if (!allExpectedRootletsCompleted(ctx, nextCompletedInvocations)) {
      return;
    }

    publishExplorationCandidatesProduced({
      runtime: ctx.runtime,
      traceId: message.traceId,
      agentId: this.agentId,
      goalId,
      planId: startedPlan.planId,
      rootletOutputs: nextRootletOutputs,
      agentCluster: {
        plan: agentClusterPlan,
        invocations: [...state.centerInvocations, ...nextCompletedInvocations.map(cloneUndergroundAgentInvocation)],
      },
    });
  }

  private async requestModelOutputs(
    ctx: UndergroundAgentContext,
    message: RootletInvocationRequestedMessage,
    cluster: Parameters<typeof requestUndergroundRootletCandidateAdvice>[0]["cluster"],
    invocation: UndergroundAgentInvocation,
    goalId: string,
    rawGoal: string
  ): Promise<Awaited<ReturnType<typeof requestUndergroundRootletCandidateAdvice>>> {
    const goalIntentProfile = ctx.shared.require("goalIntentProfile", "goalIntentProfile");
    if (ctx.intelligenceChannel === undefined) {
      return {
        rootletOutputs: [],
        modelRequestId: "",
        status: "empty",
        validationStatus: "pending",
        fallbackSourceRefs: [],
      };
    }
    return requestUndergroundRootletCandidateAdvice({
      intelligenceChannel: ctx.intelligenceChannel,
      traceId: message.traceId,
      goalId,
      goal: rawGoal,
      goalIntentProfile,
      cluster,
      invocation,
      constraints: ctx.runtime.constraints,
      sourceRefs: [message.id, message.type],
    });
  }
}

function allExpectedRootletsCompleted(
  ctx: UndergroundAgentContext,
  completedRootletInvocations: readonly UndergroundAgentInvocation[]
): boolean {
  const expectedRootletKinds = ctx.shared.require("expectedRootletKinds", "expectedRootletKinds");
  const completedKinds = new Set(
    completedRootletInvocations.map((invocation) => invocation.agentId.replace("underground-rootlet-", "").replace("-", "_"))
  );
  return expectedRootletKinds.every((kind) => completedKinds.has(kind));
}
