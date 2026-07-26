import type { ModelOutputContract } from "../../domain/intelligence/contracts.js";
import type { TaskSoil } from "../../domain/soil/task-soil.js";
import type { ChildAgentRun } from "../../domain/underground/agent-fabric.js";
import type {
  DeepChildSpec,
  DeepChildSummary,
  DeepDelegationDecision,
  DeepFollowUpContext,
  DeepIntakeContext,
  DeepIntakeTurn,
  DeepTaskBoardSnapshot,
} from "./contracts.js";
import type { MultiAgentCapabilitySnapshot } from "./multi-agent-capability-snapshot.js";
export const DEEP_DECISION_CONTRACT_ID = "deep.decision.v1";
export const DEEP_INTAKE_CONTRACT_ID = "deep.intake.v1";
export const DEEP_DIRECT_ANSWER_CONTRACT_ID = "deep.direct_answer.v1";
export const DEEP_CHILD_MATERIAL_CONTRACT_ID = "deep.child_material.v1";
export const DEEP_SYNTHESIS_CONTRACT_ID = "deep.synthesis.v1";

// ---------------------------------------------------------------------------
// 输出契约工厂
// ---------------------------------------------------------------------------

/**
 * manager 决策输出契约。json_object，必填动作/摘要/不确定性/置信度；
 * childSpecs 仅 spawn_children 时由模型给出，作为可选 visibleOutput 暴露。
 */
export function deepDecisionOutputContract(): ModelOutputContract {
  return {
    contractId: DEEP_DECISION_CONTRACT_ID,
    outputKind: "candidate",
    format: "json_object",
    requiredFields: ["action", "decisionSummary", "uncertainty", "confidence"],
    visibleOutput: {
      arrayField: "childSpecs",
      fields: [
        "specId",
        "displayName",
        "role",
        "objective",
        "allowedTools",
        "inputRefs",
      ],
      fieldTypes: {
        allowedTools: "string_array",
        inputRefs: "string_array",
      },
      maxItems: 8,
    },
  };
}

/**
 * 多 Agent 入口理解输出契约。只决定是否追问、直接回答或启动协作。
 */
export function deepIntakeOutputContract(): ModelOutputContract {
  return {
    contractId: DEEP_INTAKE_CONTRACT_ID,
    outputKind: "candidate",
    format: "json_object",
    requiredFields: ["action", "assistantMessage", "confidence"],
  };
}

/**
 * direct_answer 输出契约。json_object，必填结论/一句话理由/关键证据引用/主要不确定性。
 * direct_answer 是 manager 在无需多角度探索时直接产出 SynthesizedConclusion 的路径，
 * 因此字段与 synthesis 契约一致（候选取舍在直接回答场景可为空）。
 */
export function deepDirectAnswerOutputContract(): ModelOutputContract {
  return {
    contractId: DEEP_DIRECT_ANSWER_CONTRACT_ID,
    outputKind: "explanation",
    format: "json_object",
    requiredFields: ["conclusion", "oneLineRationale", "keyEvidenceRefs", "mainUncertainty"],
  };
}

/**
 * child 探索材料输出契约。json_object，必填摘要/发现/证据引用/不确定性/置信度。
 */
export function deepChildMaterialOutputContract(): ModelOutputContract {
  return {
    contractId: DEEP_CHILD_MATERIAL_CONTRACT_ID,
    outputKind: "evidence_suggestion",
    format: "json_object",
    requiredFields: ["summary", "findings", "evidenceRefs", "uncertainty", "confidence"],
  };
}

/**
 * 父层综合输出契约。json_object，必填五要素：结论/一句话理由/关键证据引用/
 * 候选取舍/主要不确定性。
 */
export function deepSynthesisOutputContract(): ModelOutputContract {
  return {
    contractId: DEEP_SYNTHESIS_CONTRACT_ID,
    outputKind: "explanation",
    format: "json_object",
    requiredFields: [
      "conclusion",
      "oneLineRationale",
      "keyEvidenceRefs",
      "candidateDispositions",
      "mainUncertainty",
    ],
  };
}

// ---------------------------------------------------------------------------
// 消息装配输入类型
// ---------------------------------------------------------------------------

export type DeepTurnMessage = {
  readonly role: "system" | "user";
  readonly content: string;
  readonly ref?: string;
};

export type DeepDecisionMessagesInput = {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly stepIndex: number;
  readonly stepLimit: number;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly priorDecisionSummaries: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly permissionBoundaryRefs: readonly string[];
  readonly maxChildren: number;
  /**
   * 已有 child run 的安全执行/操作事实。与 childSummaries 区分：childSummaries
   * 是 child 产出的局部材料；childRuns 投影 executionHistory / parentInstructions，
   * 让 manager 复盘同一个 child run 是否被续接、排队、取消或多段执行。
   */
  readonly childRuns?: readonly ChildAgentRun[];
  /**
   * 已终态 run 的续聊上下文。它表示同一多 Agent 任务链的新一轮用户补充，
   * 只包含上一轮安全结构化产物，不含 raw prompt / response / tool output。
   */
  readonly followUpContext?: DeepFollowUpContext;
  /** 协作启动前由入口理解阶段形成的安全目标与计划。 */
  readonly intakeContext?: DeepIntakeContext;
  /**
   * 用户中途纠正/补充的上下文（T2-7，FR-008）。携带时 manager 应在本轮决策中据此
   * 调整派生与综合方向（非空时消息显式标注"用户纠正/补充"段，可观察影响下一 step）。
   */
  readonly correctionContext?: readonly string[];
  /**
   * P6 可用工具能力声明：run 启动时冻结的能力快照。携带时 manager 决策消息会投影出
   * "可用工具清单"段，引导 manager 设计 childSpec.allowedTools 时从真实可用工具中选取。
   * 仅作为能力声明帮助决策；模型实际工具调用仍经 ToolCenter/确认门。
   */
  readonly capabilitySnapshot?: MultiAgentCapabilitySnapshot;
  /**
   * 任务板运行中快照（FR-PROJ-01 单一事实源投影 / FR-SPAWN-02）。携带时在决策消息中
   * 投影任务板安全摘要：当前相位 + 各调度状态计数（pending/running/completed/failed/
   * cancelled/blocked）+ 最近完成 child 摘要 + 最近受阻/失败 child 原因。帮助 manager
   * 基于运行中事实源判断本轮动作（是否仍有 pending 可 wait、是否已足够 synthesize、
   * 失败是否需重新 spawn）。仅投影安全结构化摘要，不暴露 raw prompt/response/工具输出。
   */
  readonly taskBoardSnapshot?: DeepTaskBoardSnapshot;
  readonly priorParseError?: string;
};

export type DeepIntakeMessagesInput = {
  readonly message: string;
  readonly conversationGoal?: string;
  readonly currentObjective?: string;
  readonly intakeTurns?: readonly DeepIntakeTurn[];
  readonly terminalRunSummary?: string;
  readonly taskSoilSummary?: string;
  /**
   * 可用工具能力声明：入口理解阶段不能直接执行工具，但必须知道 child 后续能委派哪些
   * 标准工具。否则会把“需要文件/终端证据”的请求误判为不能处理或直接回答。
   */
  readonly capabilitySnapshot?: MultiAgentCapabilitySnapshot;
  readonly priorParseError?: string;
};

export type DeepDirectAnswerMessagesInput = {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly decision: DeepDelegationDecision;
  readonly evidenceRefs: readonly string[];
  readonly priorParseError?: string;
};

export type DeepChildMaterialMessagesInput = {
  readonly goal: string;
  readonly childSpec: DeepChildSpec;
  readonly permissionBoundaryRefs: readonly string[];
  /**
   * P6 可用工具能力声明：run 启动时冻结的能力快照。携带时 child 探索消息会投影出
   * "本 child 被授权可用工具"段（childSpec.allowedTools ∩ 可用工具）及其能力简述，
   * 帮助 child 知道能用什么收集一手证据。仅作能力声明；实际工具调用仍经 ToolCenter/确认门。
   */
  readonly capabilitySnapshot?: MultiAgentCapabilitySnapshot;
};

export type DeepSynthesisMessagesInput = {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly childRuns?: readonly ChildAgentRun[];
  readonly evidenceRefs: readonly string[];
};

// ---------------------------------------------------------------------------
