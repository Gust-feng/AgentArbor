import type { ArborMessage } from "../../domain/common.js";
import type { IntelligenceChannel } from "../../domain/intelligence/index.js";
import type { ToolExecutionBroker } from "../../domain/tools/index.js";
import type { Constraint } from "../../domain/constraints.js";
import type { DirectionHandoffPackage } from "../../domain/agentarbor/direction-handoff-package.js";
import {
  InMemoryMailbox,
  InMemoryWorkspace,
  type AgentLoop,
  type AgentRunContext,
  type GuardedActionOutput,
  type WorkspaceSnapshot,
  type GoalIntentProfile,
  type UndergroundExplorationPlan,
  type RootletClusterPlan,
  type RootletOutput,
  type UndergroundAgentInvocation,
  type CandidatePool,
  type UndergroundAutonomyDecision,
  type UndergroundConvergenceReport,
  type UndergroundEvidenceLedger,
  type UndergroundExplorationCycle,
  type UndergroundAutonomyReview,
  createWorkspaceProjectionView,
  runAgentLoopRound,
} from "../../domain/underground/index.js";
import { createId } from "../../kernel/id.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/index.js";
import type { MinimalRuntime } from "../runtime.js";
import { type UndergroundAgentRunnerResult } from "./cluster/agent-runner.js";
import { IntentCoreAgent } from "./agents/intent-core.js";
import { GrowthGovernorAgent } from "./agents/growth-governor.js";
import { RootletExplorerAgent } from "./agents/rootlet-explorer.js";
import { CandidateCollectorAgent, type CandidateCollectorWorkspace } from "./agents/candidate-collector.js";
import { AutonomyReviewerAgent, type AutonomyReviewerWorkspace } from "./agents/autonomy-reviewer.js";
import { ConvergenceJudgeAgent, type ConvergenceJudgeWorkspace } from "./agents/convergence-judge.js";
import { HandoffStewardAgent, type HandoffStewardWorkspace } from "./agents/handoff-steward.js";
import { createUndergroundExplorationReport } from "../underground-report.js";
import { completeUndergroundRootletInvocations } from "../underground-agent-cluster-runtime.js";
import { createMessage } from "../../kernel/messages/create-message.js";

type DirectionSessionGoalMessage = ArborMessage<{ readonly goalId: string; readonly goal: string }>;

export type UndergroundAgentOrchestratorOptions = {
  readonly runtime: MinimalRuntime;
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly toolCenter?: ToolExecutionBroker;
  readonly agentTurnRuntime?: AgentTurnRuntime;
  readonly enableAutonomy?: boolean;
  readonly maxAutonomyCycles?: number;
  readonly maxDispatchSteps?: number;
};

type UndergroundWorkspaceData = Readonly<{
  goalId: string;
  rawGoal: string;
  goalIntentProfile?: GoalIntentProfile;
  explorationPlan?: UndergroundExplorationPlan;
  startedPlan?: UndergroundExplorationPlan;
  rootletClusters?: RootletClusterPlan[];
  runningRootletInvocations?: UndergroundAgentInvocation[];
  completedRootletInvocations?: UndergroundAgentInvocation[];
  centerInvocations?: UndergroundAgentInvocation[];
  rootletOutputs?: RootletOutput[];
  candidatePool?: CandidatePool;
  autonomyDecision?: UndergroundAutonomyDecision;
  autonomyDecisions?: readonly UndergroundAutonomyDecision[];
  convergenceReport?: UndergroundConvergenceReport;
  evidenceLedger?: UndergroundEvidenceLedger;
  directionHandoffPackage?: DirectionHandoffPackage;
  currentCycle?: UndergroundExplorationCycle;
  autonomyCycles?: UndergroundExplorationCycle[];
  constraints?: readonly Constraint[];
  maxAutonomyCycles?: number;
}>;

type UndergroundWorkspaceSnapshot = WorkspaceSnapshot<UndergroundWorkspaceData>;

export type UndergroundAgentOrchestratorRunTrace = {
  readonly orchestratorRunId: string;
  readonly route: "cognitive_manager";
  readonly agentLoopIds: readonly string[];
  readonly managerDecisions: readonly string[];
  readonly guardedStatuses: Readonly<Record<string, "accepted" | "rejected" | "fallback">>;
  readonly outputRefs: readonly string[];
};

export type UndergroundAgentOrchestratorResult = UndergroundAgentRunnerResult & {
  readonly orchestratorRun: UndergroundAgentOrchestratorRunTrace;
};

export class UndergroundAgentOrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndergroundAgentOrchestratorError";
  }
}

export class UndergroundAgentOrchestrator {
  private readonly intentCore: IntentCoreAgent;
  private readonly growthGovernor: GrowthGovernorAgent;
  private readonly candidateCollector: CandidateCollectorAgent;
  private readonly autonomyReviewer: AutonomyReviewerAgent;
  private readonly convergenceJudge: ConvergenceJudgeAgent;
  private readonly handoffSteward: HandoffStewardAgent;

  constructor(private readonly options: UndergroundAgentOrchestratorOptions) {
    this.intentCore = new IntentCoreAgent();
    this.growthGovernor = new GrowthGovernorAgent();
    this.candidateCollector = new CandidateCollectorAgent();
    this.autonomyReviewer = new AutonomyReviewerAgent();
    this.convergenceJudge = new ConvergenceJudgeAgent();
    this.handoffSteward = new HandoffStewardAgent();
  }

  async run(goalMessage: DirectionSessionGoalMessage): Promise<UndergroundAgentOrchestratorResult> {
    return this.executeCognitiveManager(goalMessage);
  }

  async runAsync(goalMessage: DirectionSessionGoalMessage): Promise<UndergroundAgentOrchestratorResult> {
    return this.executeCognitiveManager(goalMessage);
  }

  private async executeCognitiveManager(goalMessage: DirectionSessionGoalMessage): Promise<UndergroundAgentOrchestratorResult> {
    const { workspace, mailbox } = this.createWorkspaceAndMailbox(goalMessage);
    const constraints = this.options.runtime.constraints;
    const agentLoopIds: string[] = [];
    const managerDecisions: string[] = ["receive_goal"];
    const guardedStatuses: Record<string, "accepted" | "rejected" | "fallback"> = {};
    const allOutputRefs: string[] = [];
    const maxAutonomyCycles = this.options.maxAutonomyCycles ?? 3;
    let currentCycleIndex = 0;

    const intentCoreCapabilities = { constraints };
    const intentCoreCtx = this.createIntentCoreContext(workspace, mailbox, intentCoreCapabilities);
    const intentCoreResult = await this.runAgentLoop(this.intentCore, intentCoreCtx);
    agentLoopIds.push(this.intentCore.agentId);
    guardedStatuses[this.intentCore.agentId] = intentCoreResult.guarded.status;
    allOutputRefs.push(...intentCoreResult.output.outputRefs);
    this.assertGuardAccepted(intentCoreResult.guarded, this.intentCore.agentId);
    managerDecisions.push("shape_goal_intent");
    workspace.patch(this.intentCore.agentId, {
      data: {
        ...workspace.snapshot().data,
        goalIntentProfile: intentCoreResult.output.goalIntentProfile,
        explorationPlan: intentCoreResult.output.explorationPlan,
      },
    });

    let autonomyLoopActive = true;
    while (autonomyLoopActive) {
      const growthCapabilities = { constraints };
      const growthCtx = this.createGrowthGovernorContext(workspace, mailbox, growthCapabilities);
      const growthResult = await this.runAgentLoop(this.growthGovernor, growthCtx);
      agentLoopIds.push(this.growthGovernor.agentId);
      guardedStatuses[this.growthGovernor.agentId] = growthResult.guarded.status;
      allOutputRefs.push(...growthResult.output.outputRefs);
      this.assertGuardAccepted(growthResult.guarded, this.growthGovernor.agentId);
      managerDecisions.push("dispatch_rootlets");
      workspace.patch(this.growthGovernor.agentId, {
        data: {
          ...workspace.snapshot().data,
          startedPlan: growthResult.output.startedPlan,
          runningRootletInvocations: growthResult.output.runningRootletInvocations,
          centerInvocations: growthResult.output.centerInvocations,
          rootletClusters: growthResult.output.startedPlan.rootletClusters,
        },
      });

      const snap = workspace.snapshot();
      const startedPlan = snap.data.startedPlan!;
      const runningInvocations = snap.data.runningRootletInvocations!;
      const previousCompletedRootletInvocations = snap.data.completedRootletInvocations ?? [];
      const accumulatedRootletOutputs: RootletOutput[] = [...(snap.data.rootletOutputs ?? [])];
      const cycleRootletOutputs: RootletOutput[] = [];

      const clusterKinds = [...new Set(startedPlan.rootletClusters.map((c) => c.kind))];
      for (const kind of clusterKinds) {
        const rootletAgent = new RootletExplorerAgent(kind);
        const rootletCapabilities = { agentTurnRuntime: this.options.agentTurnRuntime, constraints };
        const rootletCtx = this.createRootletExplorerContext(workspace, mailbox, rootletCapabilities);
        const rootletResult = await this.runAgentLoop(rootletAgent, rootletCtx);
        agentLoopIds.push(rootletAgent.agentId);
        guardedStatuses[rootletAgent.agentId] = rootletResult.guarded.status;
        allOutputRefs.push(...rootletResult.output.outputRefs);
        accumulatedRootletOutputs.push(...rootletResult.output.rootletOutputs);
        cycleRootletOutputs.push(...rootletResult.output.rootletOutputs);
      }

      const completedRootletInvocations = [
        ...previousCompletedRootletInvocations,
        ...completeUndergroundRootletInvocations(runningInvocations, cycleRootletOutputs),
      ];
      workspace.patch("orchestrator", {
        data: {
          ...workspace.snapshot().data,
          rootletOutputs: accumulatedRootletOutputs,
          completedRootletInvocations,
        },
      });

      const candidateCapabilities = { agentTurnRuntime: this.options.agentTurnRuntime };
      const candidateCtx = this.createCandidateCollectorContext(workspace, mailbox, candidateCapabilities);
      const candidateResult = await this.runAgentLoop(this.candidateCollector, candidateCtx);
      agentLoopIds.push(this.candidateCollector.agentId);
      guardedStatuses[this.candidateCollector.agentId] = candidateResult.guarded.status;
      allOutputRefs.push(...candidateResult.output.outputRefs);
      this.assertGuardAccepted(candidateResult.guarded, this.candidateCollector.agentId);
      managerDecisions.push("wait_rootlets_then_collect_candidates");
      workspace.patch(this.candidateCollector.agentId, {
        data: {
          ...workspace.snapshot().data,
          candidatePool: candidateResult.output.candidatePool,
        },
      });

      if (this.options.enableAutonomy ?? true) {
        const cycle = createExplorationCycle(currentCycleIndex, startedPlan, workspace.snapshot().data.candidatePool);
        const prevCycles = [...(workspace.snapshot().data.autonomyCycles ?? []), cycle];
        workspace.patch("orchestrator", {
          data: {
            ...workspace.snapshot().data,
            currentCycle: cycle,
            autonomyCycles: prevCycles,
            maxAutonomyCycles,
          },
        });

        const autonomyCapabilities = { agentTurnRuntime: this.options.agentTurnRuntime };
        const autonomyCtx = this.createAutonomyReviewerContext(workspace, mailbox, constraints, maxAutonomyCycles, autonomyCapabilities);
        const autonomyResult = await this.runAgentLoop(this.autonomyReviewer, autonomyCtx);
        agentLoopIds.push(this.autonomyReviewer.agentId);
        guardedStatuses[this.autonomyReviewer.agentId] = autonomyResult.guarded.status;
        allOutputRefs.push(...autonomyResult.output.outputRefs);
        this.assertGuardAccepted(autonomyResult.guarded, this.autonomyReviewer.agentId);
        const priorAutonomyDecisions = workspace.snapshot().data.autonomyDecisions ?? [];
        workspace.patch(this.autonomyReviewer.agentId, {
          data: {
            ...workspace.snapshot().data,
            autonomyDecision: autonomyResult.output.decision,
            autonomyDecisions: [...priorAutonomyDecisions, autonomyResult.output.decision],
          },
        });

        const decision = autonomyResult.output.decision;
        if (decision.action === "continue_exploration" && currentCycleIndex < maxAutonomyCycles - 1) {
          managerDecisions.push("continue_exploration");
          currentCycleIndex++;
          continue;
        }
        managerDecisions.push(decision.action);
      }

      autonomyLoopActive = false;
    }

    const convergenceCapabilities = { agentTurnRuntime: this.options.agentTurnRuntime };
    const convergenceCtx = this.createConvergenceJudgeContext(workspace, mailbox, constraints, convergenceCapabilities);
    const convergenceResult = await this.runAgentLoop(this.convergenceJudge, convergenceCtx);
    agentLoopIds.push(this.convergenceJudge.agentId);
    guardedStatuses[this.convergenceJudge.agentId] = convergenceResult.guarded.status;
    allOutputRefs.push(...convergenceResult.output.outputRefs);
    this.assertGuardAccepted(convergenceResult.guarded, this.convergenceJudge.agentId);
    managerDecisions.push("synthesize_convergence");
    workspace.patch(this.convergenceJudge.agentId, {
      data: {
        ...workspace.snapshot().data,
        convergenceReport: convergenceResult.output.convergenceReport,
        evidenceLedger: convergenceResult.output.evidenceLedger,
        candidatePool: convergenceResult.output.candidatePool,
      },
    });

    const handoffCapabilities = {
      agentTurnRuntime: this.options.agentTurnRuntime,
      directionHandoffPackageStore: this.options.runtime.directionHandoffPackageStore,
    };
    const handoffCtx = this.createHandoffStewardContext(workspace, mailbox, constraints, handoffCapabilities);
    const handoffResult = await this.runAgentLoop(this.handoffSteward, handoffCtx);
    agentLoopIds.push(this.handoffSteward.agentId);
    guardedStatuses[this.handoffSteward.agentId] = handoffResult.guarded.status;
    allOutputRefs.push(...handoffResult.output.outputRefs);
    this.assertGuardAccepted(handoffResult.guarded, this.handoffSteward.agentId);
    managerDecisions.push(
      handoffResult.output.terminalStatus === "approved_package_created"
        ? "package_handoff"
        : handoffResult.output.terminalStatus,
    );

    const finalSnap = workspace.snapshot();
    const handoffOutput = handoffResult.output;
    const undergroundReport = createUndergroundExplorationReport({
      plan: finalSnap.data.startedPlan ?? finalSnap.data.explorationPlan!,
      goalIntentProfile: finalSnap.data.goalIntentProfile,
      evidenceLedger: finalSnap.data.evidenceLedger,
      rootletOutputs: [...(finalSnap.data.rootletOutputs ?? [])],
      candidatePool: convergenceResult.output.candidatePool,
      convergenceReport: convergenceResult.output.convergenceReport,
      autonomy: createAutonomyReview(finalSnap.data.autonomyDecisions, finalSnap.data.autonomyCycles),
    });

    const store = this.options.runtime.directionHandoffPackageStore;
    const loadedDirectionHandoffPackage = store.load(
      handoffOutput.directionHandoffPackage.manifest.directionId,
      handoffOutput.directionHandoffPackage.manifest.directionVersion,
    );

    this.publishCompletionEvent(handoffOutput, finalSnap.data.goalId, finalSnap.traceId);

    return {
      terminalStatus: handoffOutput.terminalStatus,
      undergroundReport,
      directionHandoff: handoffOutput.directionHandoffPackage.directionHandoff,
      directionHandoffPackage: handoffOutput.directionHandoffPackage,
      directionHandoffPackageRef: handoffOutput.directionHandoffPackageRef,
      loadedDirectionHandoffPackage,
      processedMessageIds: [],
      dispatchSteps: agentLoopIds.length,
      orchestratorRun: {
        orchestratorRunId: createId("underground-orchestrator-run"),
        route: "cognitive_manager",
        agentLoopIds,
        managerDecisions,
        guardedStatuses,
        outputRefs: allOutputRefs,
      },
    };
  }

  private createWorkspaceAndMailbox(goalMessage: DirectionSessionGoalMessage): {
    workspace: InMemoryWorkspace<UndergroundWorkspaceSnapshot>;
    mailbox: InMemoryMailbox;
  } {
    const mailbox = new InMemoryMailbox();
    mailbox.route({
      id: createId("agent-message"),
      traceId: goalMessage.traceId,
      fromAgentId: goalMessage.from.id,
      toAgentId: this.intentCore.agentId,
      type: goalMessage.type,
      payload: goalMessage.payload,
      createdAt: goalMessage.createdAt,
      sourceRef: goalMessage.id,
    });
    const workspace = new InMemoryWorkspace<UndergroundWorkspaceSnapshot>({
      traceId: goalMessage.traceId,
      goalId: goalMessage.payload.goalId,
      goal: goalMessage.payload.goal,
      data: {
        goalId: goalMessage.payload.goalId,
        rawGoal: goalMessage.payload.goal,
        constraints: this.options.runtime.constraints,
      },
    });
    return { workspace, mailbox };
  }

  private createIntentCoreContext(
    workspace: InMemoryWorkspace<UndergroundWorkspaceSnapshot>,
    mailbox: InMemoryMailbox,
    capabilities: { readonly constraints: readonly Constraint[] },
  ): AgentRunContext<WorkspaceSnapshot<unknown>, { readonly constraints: readonly Constraint[] }> {
    return { workspace, mailbox, capabilities };
  }

  private createGrowthGovernorContext(
    workspace: InMemoryWorkspace<UndergroundWorkspaceSnapshot>,
    mailbox: InMemoryMailbox,
    capabilities: { readonly constraints: readonly Constraint[] },
  ): AgentRunContext<WorkspaceSnapshot<unknown>, { readonly constraints: readonly Constraint[] }> {
    return { workspace, mailbox, capabilities };
  }

  private createRootletExplorerContext(
    workspace: InMemoryWorkspace<UndergroundWorkspaceSnapshot>,
    mailbox: InMemoryMailbox,
    capabilities: { readonly agentTurnRuntime?: AgentTurnRuntime; readonly constraints: readonly Constraint[] },
  ): AgentRunContext<WorkspaceSnapshot<unknown>, { readonly agentTurnRuntime?: AgentTurnRuntime; readonly constraints: readonly Constraint[] }> {
    return { workspace, mailbox, capabilities };
  }

  private createCandidateCollectorContext(
    workspace: InMemoryWorkspace<UndergroundWorkspaceSnapshot>,
    mailbox: InMemoryMailbox,
    capabilities: { readonly agentTurnRuntime?: AgentTurnRuntime },
  ): AgentRunContext<CandidateCollectorWorkspace, { readonly agentTurnRuntime?: AgentTurnRuntime }> {
    const snap = workspace.snapshot();
    const projected: CandidateCollectorWorkspace = {
      goalId: snap.data.goalId,
      rootletOutputs: snap.data.rootletOutputs ?? [],
      completedRootletInvocations: snap.data.completedRootletInvocations ?? [],
      centerInvocations: snap.data.centerInvocations ?? [],
    };
    return {
      workspace: createWorkspaceProjectionView(projected),
      mailbox,
      capabilities,
    };
  }

  private createAutonomyReviewerContext(
    workspace: InMemoryWorkspace<UndergroundWorkspaceSnapshot>,
    mailbox: InMemoryMailbox,
    constraints: readonly Constraint[],
    maxAutonomyCycles: number,
    capabilities: { readonly agentTurnRuntime?: AgentTurnRuntime },
  ): AgentRunContext<AutonomyReviewerWorkspace, { readonly agentTurnRuntime?: AgentTurnRuntime }> {
    const snap = workspace.snapshot();
    const projected: AutonomyReviewerWorkspace = {
      goalId: snap.data.goalId,
      rawGoal: snap.data.rawGoal,
      goalIntentProfile: snap.data.goalIntentProfile,
      candidatePool: snap.data.candidatePool,
      currentCycle: snap.data.currentCycle,
      autonomyCycles: snap.data.autonomyCycles ?? [],
      rootletOutputs: snap.data.rootletOutputs ?? [],
      constraints,
      maxAutonomyCycles,
    };
    return {
      workspace: createWorkspaceProjectionView(projected),
      mailbox,
      capabilities,
    };
  }

  private createConvergenceJudgeContext(
    workspace: InMemoryWorkspace<UndergroundWorkspaceSnapshot>,
    mailbox: InMemoryMailbox,
    constraints: readonly Constraint[],
    capabilities: { readonly agentTurnRuntime?: AgentTurnRuntime },
  ): AgentRunContext<ConvergenceJudgeWorkspace, { readonly agentTurnRuntime?: AgentTurnRuntime }> {
    const snap = workspace.snapshot();
    const projected: ConvergenceJudgeWorkspace = {
      goalId: snap.data.goalId,
      rawGoal: snap.data.rawGoal,
      goalIntentProfile: snap.data.goalIntentProfile,
      candidatePool: snap.data.candidatePool,
      rootletOutputs: snap.data.rootletOutputs ?? [],
      constraints,
      startedPlan: snap.data.startedPlan,
      evidenceLedger: snap.data.evidenceLedger,
      autonomyDecision: snap.data.autonomyDecision,
    };
    return {
      workspace: createWorkspaceProjectionView(projected),
      mailbox,
      capabilities,
    };
  }

  private createHandoffStewardContext(
    workspace: InMemoryWorkspace<UndergroundWorkspaceSnapshot>,
    mailbox: InMemoryMailbox,
    constraints: readonly Constraint[],
    capabilities: { readonly agentTurnRuntime?: AgentTurnRuntime; readonly directionHandoffPackageStore: import("../../domain/agentarbor/direction-handoff-package.js").DirectionHandoffPackageStore },
  ): AgentRunContext<HandoffStewardWorkspace, { readonly agentTurnRuntime?: AgentTurnRuntime; readonly directionHandoffPackageStore: import("../../domain/agentarbor/direction-handoff-package.js").DirectionHandoffPackageStore }> {
    const snap = workspace.snapshot();
    const projected: HandoffStewardWorkspace = {
      goalId: snap.data.goalId,
      rawGoal: snap.data.rawGoal,
      goalIntentProfile: snap.data.goalIntentProfile,
      convergenceReport: snap.data.convergenceReport,
      candidatePool: snap.data.candidatePool,
      constraints,
    };
    return {
      workspace: createWorkspaceProjectionView(projected),
      mailbox,
      capabilities,
    };
  }

  private async runAgentLoop<P, D, A, W, C>(
    agent: AgentLoop<P, D, A, W, C>,
    ctx: AgentRunContext<W, C>,
  ): Promise<{ output: A; guarded: GuardedActionOutput<A> }> {
    const result = await runAgentLoopRound(agent, ctx);
    return { output: result.guarded.output, guarded: result.guarded };
  }

  private assertGuardAccepted<A>(guarded: GuardedActionOutput<A>, agentId: string): void {
    if (guarded.status === "rejected") {
      const reason = guarded.guard.violations[0]?.message ?? `Agent ${agentId} guard rejected.`;
      throw new UndergroundAgentOrchestratorError(reason);
    }
  }

  private publishCompletionEvent(
    handoffOutput: { readonly directionHandoffPackage: DirectionHandoffPackage; readonly terminalStatus: string },
    goalId: string,
    traceId: string,
  ): void {
    if (handoffOutput.terminalStatus === "approved_package_created" || handoffOutput.terminalStatus === "awaiting_user") {
      this.options.runtime.bus.publish(
        createMessage({
          traceId,
          from: { id: this.handoffSteward.agentId, role: "handoff_steward" },
          to: { role: "underground_center" },
          type: "direction_handoff.completed",
          intent: "direction_handoff_completed",
          payload: {
            directionId: handoffOutput.directionHandoffPackage.manifest.directionId,
            packageId: handoffOutput.directionHandoffPackage.manifest.packageId,
            terminalStatus: handoffOutput.terminalStatus,
          },
        }),
      );
    }
  }
}

function createExplorationCycle(
  cycleIndex: number,
  startedPlan: UndergroundExplorationPlan,
  candidatePool?: CandidatePool,
): UndergroundExplorationCycle {
  return {
    explorationCycleId: createId("exploration-cycle"),
    cycleIndex,
    rootletKinds: startedPlan.rootletClusters.map((c) => c.kind),
    candidatePoolId: candidatePool?.poolId,
    spawnedRootletCount: startedPlan.rootletClusters.length,
    status: "running",
  };
}

function createAutonomyReview(
  decisions: readonly UndergroundAutonomyDecision[] | undefined,
  cycles: readonly UndergroundExplorationCycle[] | undefined,
): UndergroundAutonomyReview | undefined {
  if (decisions === undefined || decisions.length === 0) {
    return undefined;
  }
  const latestDecision = decisions.at(-1);
  return {
    enabled: true,
    latestDecision,
    decisions: [...decisions],
    cycles: [...(cycles ?? [])],
    stopReason: latestDecision?.stopReason,
  };
}
