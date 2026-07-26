import { createId, nowIso } from "../../kernel/id.js";
import type {
  AgentRunTree,
  ChildAgentRun,
  DelegationDecision,
  DelegationDecisionAction,
  ParentSynthesisResult,
} from "../../domain/underground/agent-fabric.js";
import {
  appendDelegationDecisionToTree,
  appendParentSynthesisToTree,
  cloneAgentRunTree,
  cloneDelegationDecision,
  cloneParentSynthesisResult,
  completeAgentRunTree,
  replaceChildRunInTree,
} from "../../domain/underground/agent-fabric.js";
import type {
  DeepChildSummary,
  DeepConversation,
  DeepDelegationDecision,
  DeepExplorationReport,
  DeepRun,
  DeepRunStatus,
  SynthesizedConclusion,
} from "./contracts.js";
import { DEEP_MANAGER_AGENT_ID } from "./child-delegation.js";
import type { DeepEventPublisher } from "./deep-events.js";
import type { DeepRunExecutorResult } from "./deep-run-executor.js";
import type { DeepChildExecutedQueuedInstruction } from "./deep-child-scheduler-contracts.js";

function appendDelegationDecisionUnique(
  tree: AgentRunTree,
  decision: DelegationDecision,
  updatedAt: string,
): AgentRunTree {
  const existing = tree.delegationDecisions.some((item) => item.decisionId === decision.decisionId);
  if (!existing) {
    return appendDelegationDecisionToTree(tree, decision, updatedAt);
  }
  const cloned = cloneAgentRunTree(tree);
  return {
    ...cloned,
    delegationDecisions: cloned.delegationDecisions.map((item) =>
      item.decisionId === decision.decisionId ? cloneDelegationDecision(decision) : item
    ),
    updatedAt,
  };
}

/** 将 manager 决策转换为领域决策，并追加到当前运行树。 */
export function appendDeepDecisionToRunTree(input: {
  readonly tree: AgentRunTree;
  readonly decision: DeepDelegationDecision;
  readonly updatedAt: string;
  readonly childRunIds?: readonly string[];
}): { readonly tree: AgentRunTree; readonly decision: DelegationDecision } {
  const decision = mapDeepDecisionToDomain(input.decision, input.childRunIds);
  return {
    tree: appendDelegationDecisionUnique(input.tree, decision, input.updatedAt),
    decision,
  };
}

function appendParentSynthesisUnique(
  tree: AgentRunTree,
  synthesis: ParentSynthesisResult,
  updatedAt: string,
): AgentRunTree {
  const existing = tree.parentSyntheses.some((item) => item.synthesisId === synthesis.synthesisId);
  if (!existing) {
    return appendParentSynthesisToTree(tree, synthesis, updatedAt);
  }
  const cloned = cloneAgentRunTree(tree);
  return {
    ...cloned,
    parentSyntheses: cloned.parentSyntheses.map((item) =>
      item.synthesisId === synthesis.synthesisId ? cloneParentSynthesisResult(synthesis) : item
    ),
    updatedAt,
  };
}

function removeDelegationDecisionById(
  tree: AgentRunTree,
  decisionId: string,
  updatedAt: string,
): AgentRunTree {
  if (!tree.delegationDecisions.some((decision) => decision.decisionId === decisionId)) {
    return tree;
  }
  const cloned = cloneAgentRunTree(tree);
  return {
    ...cloned,
    delegationDecisions: cloned.delegationDecisions.filter((decision) => decision.decisionId !== decisionId),
    updatedAt,
  };
}

type BuildAndPublishRunTreeInput = {
  readonly initialTree: AgentRunTree;
  readonly executorResult: DeepRunExecutorResult;
  readonly publisher: DeepEventPublisher;
};

/**
 * T2-1：从 executor 结果**按 step 顺序**增量构建 AgentRunTree（结构构建）。
 *
 * 事件发布重构（design.md §3.4 / §6 风险3）：
 *   - deep.manager.decided：已由 onProgress 在 manager 决策时**实时发布**（不再事后重建）；
 *   - deep.child.started/completed/blocked/failed：已由 scheduler 回调在 child 真实状态变化时
 *     **实时发布**（不再事后重建 started→waiting→completed 序列）；
 *   - 本函数仅保留：append decisions/children/syntheses 进 tree（结构构建）+
 *     publishParentSynthesisCompleted（需 childRuns 引用）+ control/conclusion 事件。
 *
 * tree 结构承载完整可复盘证据链（FR-009），事件序列由实时发布 + 本函数收口事件共同构成。
 */
export async function buildAndPublishRunTree(
  input: BuildAndPublishRunTreeInput,
): Promise<AgentRunTree> {
  const { executorResult, publisher } = input;
  const result = executorResult;
  let tree = input.initialTree;

  // child runs 按 step 派生顺序消费（childRunId 关联 step.childrenAdded）。
  const childRunById = new Map<string, ChildAgentRun>();
  for (const childRun of result.childRuns) {
    childRunById.set(childRun.childRunId, childRun);
  }
  let controlApiResumeDecisionsAppended = false;

  for (const step of result.steps) {
    const decisionChildRunIds = (
      step.dispatchedAction === "continue_child"
        ? step.operatedChildRunIds ?? []
        : step.spawnedChildRunIds ?? []
    ).filter((childRunId) => childRunById.has(childRunId));
    const domainDecision = mapDeepDecisionToDomain(
      step.decision,
      decisionChildRunIds,
    );
    const isConclusionStep =
      step.dispatchedAction === "synthesize" || step.dispatchedAction === "direct_answer";
    if (isConclusionStep && result.synthesisRecord && !controlApiResumeDecisionsAppended) {
      tree = removeDelegationDecisionById(tree, domainDecision.decisionId, nowIso());
      tree = appendControlApiResumeDecisions({
        tree,
        childRunById,
        instructions: result.executedQueuedChildInstructions,
      });
      controlApiResumeDecisionsAppended = true;
    }
    // 该 step 派生的 child runs（仅 spawn_children 非空），用于 append 进 tree。
    const stepChildRuns: ChildAgentRun[] =
      step.childrenAdded?.flatMap((summary) => {
        const childRun = childRunById.get(summary.childRunId);
        return childRun ? [childRun] : [];
      }) ?? [];

    // T2-1：append decision 进 tree（deep.manager.decided 已由 onProgress 实时发布）。
    tree = appendDelegationDecisionUnique(tree, domainDecision, nowIso());

    // T2-1：append child runs 进 tree（deep.child.started/completed/blocked/failed 已由 scheduler
    // 回调在真实状态变化时实时发布，此处只做结构构建，不事后重建事件）。
    for (const childRun of stepChildRuns) {
      tree = replaceChildRunInTree(tree, childRun, nowIso());
    }
    if (step.dispatchedAction === "continue_child") {
      for (const childRunId of step.operatedChildRunIds ?? []) {
        const childRun = childRunById.get(childRunId);
        if (childRun !== undefined) {
          tree = replaceChildRunInTree(tree, childRun, nowIso());
        }
      }
    }
    // 结论收口 step：synthesize（多 child 父层综合）或 direct_answer（单源收口）。
    // 两者都产出结论级 synthesisRecord，append 进 tree 的 parentSyntheses（FR-009
    // 可复盘：tree 承载"结论如何形成"；一次 run 仅一个收口 step，不重复 append）。
    if (isConclusionStep && result.synthesisRecord) {
      tree = appendParentSynthesisUnique(tree, result.synthesisRecord, nowIso());
      publisher.publishParentSynthesisCompleted({
        parentSynthesis: result.synthesisRecord,
        childRuns: result.childRuns,
        agentRunTree: tree,
      });
    }
  }

  if (!controlApiResumeDecisionsAppended) {
    tree = appendControlApiResumeDecisions({
      tree,
      childRunById,
      instructions: result.executedQueuedChildInstructions,
    });
  }

  const synthesisAlreadyAppended =
    result.synthesisRecord === undefined
      ? true
      : tree.parentSyntheses.some(
          (synthesis) => synthesis.synthesisId === result.synthesisRecord?.synthesisId,
        );
  if (result.synthesisRecord !== undefined && !synthesisAlreadyAppended) {
    tree = appendParentSynthesisUnique(tree, result.synthesisRecord, nowIso());
    publisher.publishParentSynthesisCompleted({
      parentSynthesis: result.synthesisRecord,
      childRuns: result.childRuns,
      agentRunTree: tree,
    });
  }

  // 发布 T2-7 control 事件（interrupt/correct/stop），承载可观察打断/纠正/停止记录。
  for (const controlEvent of result.controlEvents) {
    publisher.publishControlEvent(controlEvent, tree);
  }

  // 结论存在时发布 deep.conclusion.produced（结论产出，FR-009 证据链收口）。
  if (result.conclusion) {
    publisher.publishConclusionProduced({ conclusion: result.conclusion });
  }
  if (result.run.status === "failed") {
    publisher.publishFailed({
      summary: result.failure ?? "多 Agent 运行失败。",
      agentRunTree: tree,
    });
  }

  // 收口 tree 状态（终态映射 deep run status → tree status）。
  const treeStatus = mapRunStatusToTreeStatus(result.run.status);
  return completeAgentRunTree(tree, treeStatus, nowIso());
}

function appendControlApiResumeDecisions(input: {
  readonly tree: AgentRunTree;
  readonly childRunById: ReadonlyMap<string, ChildAgentRun>;
  readonly instructions: readonly DeepChildExecutedQueuedInstruction[];
}): AgentRunTree {
  let tree = input.tree;
  for (const instruction of input.instructions) {
    if (instruction.source !== "control_api") {
      continue;
    }
    const childRun = input.childRunById.get(instruction.childRunId);
    const updatedAt = instruction.executedAt;
    tree = appendDelegationDecisionUnique(
      tree,
      {
        decisionId: createId("deep-decision"),
        parentAgentId: childRun?.parentAgentId ?? DEEP_MANAGER_AGENT_ID,
        action: "resume_child",
        childSpecIds: childRun === undefined ? [] : [childRun.spec.specId],
        childRunIds: [instruction.childRunId],
        inputRefs: [
          `child_run:${instruction.childRunId}`,
          instruction.messageRef,
        ],
        rationale: "父层追加消息要求同一个子 Agent 继续工作。",
        uncertainty: "该操作来自运行中控制消息；不包含 raw 指令正文。",
        source: "control_api",
        confidence: childRun?.confidence ?? 0.5,
        reasoningTraceRefs: [instruction.messageRef],
        createdAt: instruction.queuedAt,
      },
      updatedAt,
    );
    if (childRun !== undefined) {
      tree = replaceChildRunInTree(tree, childRun, updatedAt);
    }
  }
  return tree;
}

/**
 * deep manager 动作 → domain DelegationDecisionAction 映射（AgentRunTree 持久化用 domain 动作）。
 * 命名映射保持语义一致（manager 决策语义不变，仅落到 domain 持久化口径）。
 */
function mapDeepDecisionToDomain(
  decision: DeepDelegationDecision,
  childRunIds: readonly string[] = [],
): DelegationDecision {
  return {
    decisionId: decision.decisionId,
    parentAgentId: decision.parentAgentId,
    action: mapDeepActionToDomainAction(decision.action),
    childSpecIds: decision.childSpecs.map((spec) => spec.specId),
    childRunIds,
    inputRefs: [...decision.reasoningRefs],
    rationale: decision.rationale,
    uncertainty: decision.uncertainty,
    source: decision.source,
    confidence: decision.confidence,
    reasoningTraceRefs: [...decision.reasoningRefs],
    createdAt: decision.createdAt,
  };
}

function mapDeepActionToDomainAction(action: DeepDelegationDecision["action"]): DelegationDecisionAction {
  switch (action) {
    case "spawn_children":
      return "spawn_children";
    case "wait_children":
      return "wait_for_children";
    case "continue_child":
      return "resume_child";
    case "synthesize":
      return "request_parent_synthesis";
    case "ask_user":
      return "request_user_clarification";
    case "stop":
      return "stop";
    case "direct_answer":
      // direct_answer 视为 manager 直接收口（单源综合），映射到 request_convergence。
      return "request_convergence";
    default:
      return "stop";
  }
}

function mapRunStatusToTreeStatus(status: DeepRunStatus): "running" | "completed" | "failed" | "stopped" {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    // interrupted/corrected 作为运行中止态，tree 记为 stopped（材料保留，运行已停）。
    case "interrupted":
    case "corrected":
      return "stopped";
    default:
      return "running";
  }
}

// ---------------------------------------------------------------------------
// DeepExplorationReport 构建（FR-009 可复盘证据链）
// ---------------------------------------------------------------------------

type BuildExplorationReportInput = {
  readonly run: DeepRun;
  readonly conversation: DeepConversation;
  readonly agentRunTree: AgentRunTree;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly synthesisRecord?: ParentSynthesisResult;
  readonly conclusion?: SynthesizedConclusion;
};

/**
 * 构建 DeepExplorationReport。仅在有 conclusion 时产出（direct_answer/synthesize/
 * stop-partial）；无 conclusion（ask_user/interrupt/no_model/failed）时返回 undefined。
 * report 复用 domain AgentRunTree + ParentSynthesisResult，承载结论如何形成的证据链。
 */
export function buildExplorationReport(
  input: BuildExplorationReportInput,
): DeepExplorationReport | undefined {
  if (input.conclusion === undefined) {
    return undefined;
  }
  const synthesisRecords: ParentSynthesisResult[] = input.synthesisRecord
    ? [input.synthesisRecord]
    : [];
  return {
    reportId: createId("deep-report"),
    runId: input.run.runId,
    conversationId: input.conversation.conversationId,
    goal: input.run.goal,
    agentRunTree: input.agentRunTree,
    childSummaries: input.childSummaries,
    synthesisRecords,
    conclusion: input.conclusion,
    createdAt: nowIso(),
  };
}
