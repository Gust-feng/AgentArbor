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
import type { ArborMessage } from "../../domain/common.js";
import type { IntelligenceChannel } from "../../domain/intelligence/index.js";
import type { ToolExecutionBroker } from "../../domain/tools/index.js";
import type { Constraint } from "../../domain/constraints.js";
import {
  createDirectionHandoffPackageRef,
  type DirectionHandoffPackage,
  type DirectionHandoffPackageRef,
} from "../../domain/agentarbor/direction-handoff-package.js";
import type { DirectionHandoff, UndergroundExplorationReport } from "../../domain/underground/index.js";
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
  type AgentRunTree,
  type ChildAgentRun,
  type ParentSynthesisResult,
  appendChildRunToTree,
  appendDelegationDecisionToTree,
  appendParentSynthesisToTree,
  completeAgentRunTree,
  completeChildAgentRun,
  createAgentRunTree,
  createWorkspaceProjectionView,
  replaceChildRunInTree,
  runAgentLoopRound,
  startChildAgentRun,
} from "../../domain/underground/index.js";
import { createId } from "../../kernel/id.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/index.js";
import type { MinimalRuntime } from "../runtime.js";
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
import {
  publishAgentDelegationPlanned,
  publishAutonomyReviewCompleted,
  publishCandidatePoolUpdated,
  publishChildAgentRunCompleted,
  publishChildAgentRunStarted,
  publishChildAgentRunWaiting,
  publishConvergenceReviewCompleted,
  publishConvergenceReviewRequested,
  publishExplorationCandidatesProduced,
  publishParentSynthesisCompleted,
  publishRootletClustersStarted,
  publishUndergroundExplorationPlanned,
} from "../underground-events.js";
import {
  UNDERGROUND_CENTER_MANAGER_AGENT_ID,
  createAutonomyReview,
  createDelegationDecisionFromGrowth,
  createExplorationCycle,
  createExplorationPlanFromAutonomyDecision,
  createManagerAgentSpec,
  createParentSynthesisFromCandidatePool,
  createRootletChildRuns,
} from "./orchestrator-factories.js";

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
  agentRunTree?: AgentRunTree;
  parentSynthesis?: ParentSynthesisResult;
  currentCycle?: UndergroundExplorationCycle;
  autonomyCycles?: UndergroundExplorationCycle[];
  constraints?: readonly Constraint[];
  maxAutonomyCycles?: number;
}>;

type UndergroundWorkspaceSnapshot = WorkspaceSnapshot<UndergroundWorkspaceData>;

export type UndergroundAgentOrchestratorRunTrace = {
  readonly orchestratorRunId: string;
  readonly route: "underground_cognitive_runtime";
  readonly agentLoopIds: readonly string[];
  readonly agentRunTree: AgentRunTree;
  readonly parentSynthesisRefs: readonly string[];
  readonly managerDecisions: readonly string[];
  readonly guardedStatuses: Readonly<Record<string, "accepted" | "rejected" | "fallback">>;
  readonly outputRefs: readonly string[];
};

export type UndergroundAgentOrchestratorBaseResult = {
  readonly terminalStatus: "approved_package_created" | "awaiting_user" | "stopped";
  readonly undergroundReport: UndergroundExplorationReport;
  readonly directionHandoff?: DirectionHandoff;
  readonly directionHandoffPackage: DirectionHandoffPackage;
  readonly directionHandoffPackageRef: DirectionHandoffPackageRef;
  readonly loadedDirectionHandoffPackage: DirectionHandoffPackage;
  readonly processedMessageIds: readonly string[];
  readonly dispatchSteps: number;
};

export type UndergroundAgentOrchestratorResult = UndergroundAgentOrchestratorBaseResult & {
  readonly orchestratorRun: UndergroundAgentOrchestratorRunTrace;
};

export class UndergroundAgentOrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndergroundAgentOrchestratorError";
  }
}

// Compatibility class name retained; this is the Underground Cognitive Runtime scheduler for
// directional intelligence, child delegation, parent synthesis, convergence, and Plan Package creation.
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
    const orchestratorRunId = createId("underground-orchestrator-run");
    let agentRunTree = createAgentRunTree({
      treeId: createId("agent-run-tree"),
      rootRunId: orchestratorRunId,
      rootAgentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
      rootSpec: createManagerAgentSpec(goalMessage.createdAt),
      createdAt: goalMessage.createdAt,
    });
    workspace.patch(UNDERGROUND_CENTER_MANAGER_AGENT_ID, {
      data: {
        ...workspace.snapshot().data,
        agentRunTree,
      },
    });
    this.publishGoalMessageIfMissing(goalMessage);
    const agentLoopIds: string[] = [];
    const parentSynthesisRefs: string[] = [];
    const managerDecisions: string[] = ["receive_goal"];
    const guardedStatuses: Record<string, "accepted" | "rejected" | "fallback"> = {};
    const allOutputRefs: string[] = [];
    const maxAutonomyCycles = this.options.maxAutonomyCycles ?? 3;
    let currentCycleIndex = 0;

    const intentCoreCapabilities = {
      constraints,
      agentTurnRuntime: this.options.agentTurnRuntime,
    };
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
    publishUndergroundExplorationPlanned({
      runtime: this.options.runtime,
      traceId: goalMessage.traceId,
      agentId: this.intentCore.agentId,
      plan: intentCoreResult.output.explorationPlan,
    });

    let autonomyLoopActive = true;
    while (autonomyLoopActive) {
      const growthCapabilities = {
        constraints,
        agentTurnRuntime: this.options.agentTurnRuntime,
      };
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
      let delegation = createDelegationDecisionFromGrowth({
        parentAgentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
        startedPlan,
        runningInvocations,
        growthResult: growthResult.output,
      });
      const plannedChildRuns = createRootletChildRuns({
        parentAgentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
        startedPlan,
        runningInvocations,
        createdAt: new Date().toISOString(),
      });
      delegation = {
        ...delegation,
        childRunIds: plannedChildRuns.map((run) => run.childRunId),
      };
      agentRunTree = appendDelegationDecisionToTree(agentRunTree, delegation, new Date().toISOString());
      for (const childRun of plannedChildRuns) {
        agentRunTree = appendChildRunToTree(agentRunTree, childRun, new Date().toISOString());
      }
      workspace.patch(UNDERGROUND_CENTER_MANAGER_AGENT_ID, {
        data: {
          ...workspace.snapshot().data,
          agentRunTree,
        },
      });
      publishAgentDelegationPlanned({
        runtime: this.options.runtime,
        traceId: goalMessage.traceId,
        parentAgentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
        delegationDecision: delegation,
        childSpecs: plannedChildRuns.map((run) => run.spec),
        agentRunTree,
      });
      publishRootletClustersStarted({
        runtime: this.options.runtime,
        traceId: goalMessage.traceId,
        agentId: this.growthGovernor.agentId,
        plan: startedPlan,
      });
      publishChildAgentRunWaiting({
        runtime: this.options.runtime,
        traceId: goalMessage.traceId,
        parentAgentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
        childRunIds: plannedChildRuns.map((run) => run.childRunId),
        agentRunTree,
      });
      const previousCompletedRootletInvocations = snap.data.completedRootletInvocations ?? [];
      const accumulatedRootletOutputs: RootletOutput[] = [...(snap.data.rootletOutputs ?? [])];
      const cycleRootletOutputs: RootletOutput[] = [];

      const clusterKinds = [...new Set(startedPlan.rootletClusters.map((c) => c.kind))];
      for (const kind of clusterKinds) {
        const rootletAgent = new RootletExplorerAgent(kind);
        const plannedChildRun = plannedChildRuns.find((run) => run.spec.agentId === rootletAgent.agentId);
        let runningChildRun: ChildAgentRun | undefined;
        if (plannedChildRun !== undefined) {
          runningChildRun = startChildAgentRun(plannedChildRun, new Date().toISOString());
          agentRunTree = replaceChildRunInTree(agentRunTree, runningChildRun, new Date().toISOString());
          workspace.patch(UNDERGROUND_CENTER_MANAGER_AGENT_ID, {
            data: {
              ...workspace.snapshot().data,
              agentRunTree,
            },
          });
          publishChildAgentRunStarted({
            runtime: this.options.runtime,
            traceId: goalMessage.traceId,
            parentAgentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
            childRun: runningChildRun,
            agentRunTree,
          });
        }
        const rootletCapabilities = { agentTurnRuntime: this.options.agentTurnRuntime, constraints };
        const rootletCtx = this.createRootletExplorerContext(workspace, mailbox, rootletCapabilities);
        const rootletResult = await this.runAgentLoop(rootletAgent, rootletCtx);
        agentLoopIds.push(rootletAgent.agentId);
        guardedStatuses[rootletAgent.agentId] = rootletResult.guarded.status;
        allOutputRefs.push(...rootletResult.output.outputRefs);
        accumulatedRootletOutputs.push(...rootletResult.output.rootletOutputs);
        cycleRootletOutputs.push(...rootletResult.output.rootletOutputs);
        if (runningChildRun !== undefined) {
          const completedChildRun = completeChildAgentRun({
            run: runningChildRun,
            outputRefs: rootletResult.output.outputRefs,
            evidenceRefs: rootletResult.output.rootletOutputs.flatMap((output) => output.evidenceRefs),
            confidence: rootletResult.output.confidence,
            uncertainty: rootletResult.output.reasoningTrace.at(-1)?.uncertainty,
            completedAt: new Date().toISOString(),
          });
          agentRunTree = replaceChildRunInTree(agentRunTree, completedChildRun, new Date().toISOString());
          workspace.patch(UNDERGROUND_CENTER_MANAGER_AGENT_ID, {
            data: {
              ...workspace.snapshot().data,
              agentRunTree,
            },
          });
          publishChildAgentRunCompleted({
            runtime: this.options.runtime,
            traceId: goalMessage.traceId,
            parentAgentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
            childRun: completedChildRun,
            agentRunTree,
          });
        }
        // Patch workspace so subsequent rootlet explorers can see sibling outputs
        workspace.patch(rootletAgent.agentId, {
          data: {
            ...workspace.snapshot().data,
            rootletOutputs: [...accumulatedRootletOutputs],
          },
        });
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
          agentRunTree,
        },
      });
      publishExplorationCandidatesProduced({
        runtime: this.options.runtime,
        traceId: goalMessage.traceId,
        agentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
        goalId: goalMessage.payload.goalId,
        planId: startedPlan.planId,
        rootletOutputs: cycleRootletOutputs,
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
      publishCandidatePoolUpdated({
        runtime: this.options.runtime,
        traceId: goalMessage.traceId,
        agentId: this.candidateCollector.agentId,
        goalId: goalMessage.payload.goalId,
        planId: startedPlan.planId,
        candidatePool: candidateResult.output.candidatePool,
      });
      const parentSynthesis = createParentSynthesisFromCandidatePool({
        parentAgentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
        childRuns: agentRunTree.childRuns.filter((run) => delegation.childRunIds.includes(run.childRunId)),
        candidatePool: candidateResult.output.candidatePool,
        source: candidateResult.output.source,
        confidence: candidateResult.output.confidence,
        reasoningTraceRefs: candidateResult.output.reasoningTrace.flatMap((entry) => [
          ...entry.modelCallRefs,
          ...entry.toolCallRefs,
          ...entry.fallbackRefs,
        ]),
      });
      agentRunTree = appendParentSynthesisToTree(agentRunTree, parentSynthesis, new Date().toISOString());
      parentSynthesisRefs.push(parentSynthesis.synthesisId);
      workspace.patch(UNDERGROUND_CENTER_MANAGER_AGENT_ID, {
        data: {
          ...workspace.snapshot().data,
          parentSynthesis,
          agentRunTree,
        },
      });
      publishParentSynthesisCompleted({
        runtime: this.options.runtime,
        traceId: goalMessage.traceId,
        parentAgentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
        parentSynthesis,
        childRuns: agentRunTree.childRuns.filter((run) => parentSynthesis.childRunIds.includes(run.childRunId)),
        agentRunTree,
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
        publishAutonomyReviewCompleted({
          runtime: this.options.runtime,
          traceId: goalMessage.traceId,
          agentId: this.autonomyReviewer.agentId,
          goalId: goalMessage.payload.goalId,
          planId: startedPlan.planId,
          candidatePool: candidateResult.output.candidatePool,
          autonomyDecision: decision,
          cycle,
        });
        if (decision.action === "continue_exploration" && currentCycleIndex < maxAutonomyCycles - 1) {
          managerDecisions.push("continue_exploration");
          const nextPlan = createExplorationPlanFromAutonomyDecision({
            previousPlan: startedPlan,
            decision,
            goalId: goalMessage.payload.goalId,
          });
          workspace.patch(UNDERGROUND_CENTER_MANAGER_AGENT_ID, {
            data: {
              ...workspace.snapshot().data,
              explorationPlan: nextPlan,
            },
          });
          currentCycleIndex++;
          continue;
        }
        if (decision.action === "request_convergence") {
          publishConvergenceReviewRequested({
            runtime: this.options.runtime,
            traceId: goalMessage.traceId,
            agentId: this.autonomyReviewer.agentId,
            goalId: goalMessage.payload.goalId,
            planId: startedPlan.planId,
            candidatePool: candidateResult.output.candidatePool,
            autonomyDecision: decision,
            cycle,
          });
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
        agentRunTree,
      },
    });
    const convergenceSnap = workspace.snapshot();
    const convergenceUndergroundReport = createUndergroundExplorationReport({
      plan: convergenceSnap.data.startedPlan ?? convergenceSnap.data.explorationPlan!,
      agentRunTree,
      goalIntentProfile: convergenceSnap.data.goalIntentProfile,
      evidenceLedger: convergenceSnap.data.evidenceLedger,
      rootletOutputs: [...(convergenceSnap.data.rootletOutputs ?? [])],
      candidatePool: convergenceResult.output.candidatePool,
      convergenceReport: convergenceResult.output.convergenceReport,
      autonomy: createAutonomyReview(convergenceSnap.data.autonomyDecisions, convergenceSnap.data.autonomyCycles),
    });
    publishConvergenceReviewCompleted({
      runtime: this.options.runtime,
      traceId: goalMessage.traceId,
      agentId: this.convergenceJudge.agentId,
      goalId: goalMessage.payload.goalId,
      planId: (convergenceSnap.data.startedPlan ?? convergenceSnap.data.explorationPlan!).planId,
      convergenceReport: convergenceResult.output.convergenceReport,
      candidatePool: convergenceResult.output.candidatePool,
      undergroundReport: convergenceUndergroundReport,
    });

    const handoffCapabilities = {
      agentTurnRuntime: this.options.agentTurnRuntime,
      directionHandoffPackageStore: this.options.runtime.directionHandoffPackageStore,
    };
    this.options.runtime.bus.publish(
      createMessage({
        traceId: goalMessage.traceId,
        from: { id: this.convergenceJudge.agentId, role: "convergence_judge" },
        to: { role: "handoff_steward" },
        type: "direction_handoff.requested",
        intent: "request_direction_handoff",
        payload: {
          goalId: goalMessage.payload.goalId,
          reviewId: convergenceResult.output.convergenceReport.reviewId,
          parentSynthesisId: workspace.snapshot().data.parentSynthesis?.synthesisId,
        },
      }),
    );
    const handoffCtx = this.createHandoffStewardContext(workspace, mailbox, constraints, handoffCapabilities);
    const handoffResult = await this.runAgentLoop(this.handoffSteward, handoffCtx);
    agentLoopIds.push(this.handoffSteward.agentId);
    guardedStatuses[this.handoffSteward.agentId] = handoffResult.guarded.status;
    allOutputRefs.push(...handoffResult.output.outputRefs);
    this.assertGuardAccepted(handoffResult.guarded, this.handoffSteward.agentId);
    managerDecisions.push(
      handoffResult.output.terminalStatus === "approved_package_created"
        ? "plan_package_ready"
        : handoffResult.output.terminalStatus,
    );
    agentRunTree = completeAgentRunTree(
      agentRunTree,
      handoffResult.output.terminalStatus === "approved_package_created"
        ? "completed"
        : handoffResult.output.terminalStatus === "stopped"
          ? "stopped"
          : "running",
      new Date().toISOString(),
    );
    workspace.patch(UNDERGROUND_CENTER_MANAGER_AGENT_ID, {
      data: {
        ...workspace.snapshot().data,
        agentRunTree,
      },
    });

    const finalSnap = workspace.snapshot();
    const handoffOutput = handoffResult.output;
    const undergroundReport = createUndergroundExplorationReport({
      plan: finalSnap.data.startedPlan ?? finalSnap.data.explorationPlan!,
      agentRunTree,
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

    this.publishCompletionEvent(handoffOutput, finalSnap.traceId);

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
        orchestratorRunId,
        route: "underground_cognitive_runtime",
        agentLoopIds,
        agentRunTree,
        parentSynthesisRefs,
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
    capabilities: { readonly constraints: readonly Constraint[]; readonly agentTurnRuntime?: AgentTurnRuntime },
  ): AgentRunContext<WorkspaceSnapshot<unknown>, { readonly constraints: readonly Constraint[]; readonly agentTurnRuntime?: AgentTurnRuntime }> {
    return { workspace, mailbox, capabilities };
  }

  private createGrowthGovernorContext(
    workspace: InMemoryWorkspace<UndergroundWorkspaceSnapshot>,
    mailbox: InMemoryMailbox,
    capabilities: { readonly constraints: readonly Constraint[]; readonly agentTurnRuntime?: AgentTurnRuntime },
  ): AgentRunContext<WorkspaceSnapshot<unknown>, { readonly constraints: readonly Constraint[]; readonly agentTurnRuntime?: AgentTurnRuntime }> {
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
      traceId: snap.traceId,
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
      traceId: snap.traceId,
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
      traceId: snap.traceId,
      goalId: snap.data.goalId,
      rawGoal: snap.data.rawGoal,
      goalIntentProfile: snap.data.goalIntentProfile,
      candidatePool: snap.data.candidatePool,
      rootletOutputs: snap.data.rootletOutputs ?? [],
      constraints,
      startedPlan: snap.data.startedPlan,
      evidenceLedger: snap.data.evidenceLedger,
      autonomyDecision: snap.data.autonomyDecision,
      parentSynthesis: snap.data.parentSynthesis,
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
      traceId: snap.traceId,
      goalId: snap.data.goalId,
      rawGoal: snap.data.rawGoal,
      goalIntentProfile: snap.data.goalIntentProfile,
      convergenceReport: snap.data.convergenceReport,
      candidatePool: snap.data.candidatePool,
      parentSynthesis: snap.data.parentSynthesis,
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
            directionPackage: createDirectionHandoffPackageRef(handoffOutput.directionHandoffPackage),
            terminalStatus: handoffOutput.terminalStatus,
          },
        }),
      );
    }
  }

  private publishGoalMessageIfMissing(goalMessage: DirectionSessionGoalMessage): void {
    const alreadyPublished = this.options.runtime.bus
      .getMessages("goal.received")
      .some((message) => message.id === goalMessage.id);
    if (!alreadyPublished) {
      this.options.runtime.bus.publish(goalMessage);
    }
  }
}
