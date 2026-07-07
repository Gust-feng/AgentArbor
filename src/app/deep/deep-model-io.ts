/**
 * DeepRuntime 模型 IO（deep 一期，ADR-0025）。
 *
 * 本文件为 DeepRunExecutor（manager 决策循环）与 Child Delegation（child 探索）
 * 提供统一的模型输入输出契约：
 *   - 输出契约（{@link ModelOutputContract}）：deep.decision / deep.direct_answer /
 *     deep.child_material / deep.synthesis 四类，contractId 与 fake-model-provider-deep
 *     的 defaultFakeOutput 派发对齐。
 *   - 消息装配：把目标、Task Soil 上下文、run tree 状态、child 材料等组装为
 *     {@link ModelMessage}，供 AgentTurnRuntime 作为 sanitizedMessages 使用。
 *   - 解析器：把模型 structuredOutput 解析为 deep 契约类型（DeepDelegationDecision /
 *     DeepChildSpec / SynthesizedConclusion 等）。
 *
 * 设计边界（ADR-0025 决策一 AI-first）：解析器只做 schema 守卫（必填校验、范围裁剪），
 * 不替代模型语义判断；决策来源标记 source: "ai"，确定性 fallback 仅在 schema 校验
 * 失败的守卫场景出现，且不伪装成已完成判断（见 DeepRunExecutor 的 AI-first 边界）。
 *
 * 复用边界：不 import cognitive-work-session-*（legacy action loop，仅作设计输入），
 * 解析辅助函数在本文件本地定义，避免与 legacy 模块耦合。
 */
import type { ModelOutputContract, ModelResponse } from "../../domain/intelligence/contracts.js";
import type { ModelMessage } from "../../domain/intelligence/contracts.js";
import type { TaskSoil } from "../../domain/soil/task-soil.js";
// P6：可用工具能力声明——消息装配需要投影 capabilitySnapshot 的工具目录（能力声明，
// 帮助决策/探索），不泄露敏感配置（密钥/命令/URL）；模型实际工具调用仍经 ToolCenter/确认门。
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/index.js";
import type { ChildAgentRun, ChildAgentRunExecution } from "../../domain/underground/agent-fabric.js";
import type {
  CandidateDisposition,
  DeepChildOperation,
  DeepChildSpec,
  DeepChildSummary,
  DeepDelegationAction,
  DeepDelegationDecision,
  DeepFollowUpContext,
  DeepIntakeContext,
  DeepIntakeDecisionAction,
  DeepIntakeTurn,
  DeepTaskBoardSnapshot,
  ChildAgentRunParentReview,
  SynthesizedConclusion,
} from "./contracts.js";
import { DEEP_DELEGATION_ACTIONS } from "./contracts.js";
import { createId } from "../../kernel/id.js";

// ---------------------------------------------------------------------------
// 输出契约 ID 常量（与 fake-model-provider-deep 派发键对齐）
// ---------------------------------------------------------------------------

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
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
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
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
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
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
};

export type DeepSynthesisMessagesInput = {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly childRuns?: readonly ChildAgentRun[];
  readonly evidenceRefs: readonly string[];
};

// ---------------------------------------------------------------------------
// 消息装配实现
// ---------------------------------------------------------------------------

export function deepDecisionMessages(input: DeepDecisionMessagesInput): readonly DeepTurnMessage[] {
  const correctionSection = formatCorrectionContext(input.correctionContext);
  const followUpSection = formatFollowUpContext(input.followUpContext);
  const intakeSection = formatIntakeContext(input.intakeContext);
  // P6：可用工具能力声明——投影 capabilitySnapshot 的工具目录，帮助 manager 设计
  // childSpec.allowedTools 时从真实可用工具中选取（不凭空编造）。仅作能力声明，
  // 模型实际工具调用仍经 ToolCenter/确认门。
  const toolSection = formatCapabilityToolSection(input.capabilitySnapshot);
  const system: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:manager_system",
    content: [
      "你是 DeepRuntime 的 manager（深层多角度探索协调者）。",
      "你的职责是理解用户目标，逐 step 决策本轮动作，并产出可解释、有依据的决策。",
      "",
      "可选动作（必须选择其一）及其判断标准：",
      "- direct_answer：目标明确、答案单一、已有证据足以支撑结论时直接产出结论。",
      "  注意：除非目标确实简单，否则不要在 step 0 就急于 direct_answer；证据不足时禁止伪装完成。",
      "- spawn_children：需要多角度验证、多来源证据，或目标存在分歧/不确定性时，派生多个 child 分头探索。",
      "- spawn_children：目标需要列目录、读/改文件、执行命令、查看工作区或收集一手文件/终端证据时，派生 child 使用授权工具；manager 不直接执行工具。",
      "- wait_children：已派生的 child 仍在进行中，本轮等待其结果。",
      "- continue_child：父层审查发现某个已有 child 的材料不足、受阻或异常停止时，给同一个 childRunId 追加指令，",
      "  让该 child 作为同一个标准 Agent run 继续工作；不要为同一目标重复 spawn 新 child。",
      "- synthesize：child 探索材料已足够覆盖目标的关键维度，进入父层综合产出结论。",
      "- ask_user：关键信息缺失、方向存在歧义、或权限/边界不清时，向用户澄清。",
      "- stop：预算即将耗尽、目标已达成或确实无法继续推进时，停止运行。",
      "",
      "childSpec 设计策略（spawn_children 时）：",
      "- 差异互补：child 之间角度互补、不重复——从不同证据来源、不同假设、不同约束维度切入，",
      "  避免多个 child 探索同一问题；每个 child 聚焦一个可独立产出证据的子问题。",
      "- role/objective 设计要点：role 体现视角（如「性能视角」）；objective 写清要回答的具体问题与期望证据，",
      "  具体且可探索（便于产出有依据的发现）。",
      "- allowedTools 从下方「可用工具清单」中真实选取，不要凭空编造不存在的工具名。",
      "- maxModelRounds / maxToolRounds 是可选字段；省略时 child 不设置固定轮次上限；",
      "  你可以填写上限来收紧探索，但不要超过 200，运行时会把超大值钳制为 200。",
      "",
      "预算意识：结合本轮 stepIndex/stepLimit 与 child 上限判断。剩余步数少或已派生接近上限时，",
      "优先收束（synthesize 或 direct_answer）而非继续 spawn，避免预算耗尽而无结论。",
      "",
      "AI-first 边界：你的决策由语义推理产出。当证据不足时，必须选择 spawn_children",
      "（继续探索）或 ask_user（向用户澄清），不得选择 direct_answer/synthesize 伪装完成。",
      "如果下方「可用工具清单」非空，不能声称没有工具；需要工具的一手操作应通过 childSpec.allowedTools 委派给 child。",
      "若用户在中途给出纠正/补充上下文，你必须据此调整本轮派生与综合方向，不能忽略。",
      "若存在续聊上下文，你必须把用户的新补充视为同一任务链的新一轮目标修订，",
      "结合上一轮结论与结构化探索材料判断是否继续探索、重新综合或追问。",
      "若存在入口理解计划，你必须优先遵守该计划和标准化目标；除非运行事实证明计划不足，",
      "否则不要把协作重新退化为泛泛规划。",
      "",
      `本轮约束：step ${input.stepIndex}/${input.stepLimit}，最多派生 ${input.maxChildren} 个 child。`,
      toolSection,
      "",
      "期望输出 JSON（字段结构示例，是格式指引而非固定内容）：",
      "  {",
      "    \"action\": \"spawn_children\",",
      "    \"decisionSummary\": \"一句话说明本轮决策意图\",",
      "    \"rationale\": \"为什么选这个动作（判断依据）\",",
      "    \"uncertainty\": \"本轮仍存在的主要不确定性\",",
      "    \"confidence\": 0.7,",
      "    \"reasoningRefs\": [\"ref1\", \"ref2\"],",
      "    \"childSpecs\": [",
      "      {",
      "        \"specId\": \"child-a\",",
      "        \"displayName\": \"性能视角\",",
      "        \"role\": \"performance_angle\",",
      "        \"objective\": \"评估 X 在高并发下的性能，给出 QPS/延迟数据\",",
      "        \"allowedTools\": [\"toolName\"],",
      "        \"inputRefs\": [\"ref\"]",
      "      }",
      "    ],",
      "    \"childOperations\": [",
      "      {",
      "        \"childRunId\": \"deep-child-run-123\",",
      "        \"review\": {",
      "          \"decision\": \"needs_followup\",",
      "          \"reason\": \"该 child 材料缺少关键证据，需要同一个 child 继续补齐。\",",
      "          \"evidenceRefs\": [\"ref\"],",
      "          \"confidence\": 0.7",
      "        },",
      "        \"instruction\": \"继续沿用原角色，补齐缺失证据后重新输出 child material JSON\"",
      "      }",
      "    ]",
      "  }",
      "仅当 action=spawn_children 时给出 childSpecs 数组；仅当 action=continue_child 时给出 childOperations 数组；其他动作省略这些字段。",
    ].join("\n"),
  };
  const contextRefs = taskSoilContextSummary(input.taskSoil);
  const childSection = input.childSummaries.length === 0
    ? "(暂无已完成的 child 探索材料)"
    : input.childSummaries.map((child, index) => formatChildSummary(child, index)).join("\n");
  const childRunFactSection = formatChildRunFacts(input.childRuns);
  const priorSection = input.priorDecisionSummaries.length === 0
    ? "(暂无历史决策)"
    : input.priorDecisionSummaries.map((summary, index) => `  ${index + 1}. ${summary}`).join("\n");
  // FR-PROJ-01：任务板运行中事实源摘要投影（pending/running 计数等 childSection 不覆盖的调度真相）。
  const boardSection = formatTaskBoardSummary(input.taskBoardSnapshot);
  const user: DeepTurnMessage = {
    role: "user",
    ref: "context:deep:decision_user",
    content: [
      `Raw goal: ${input.goal}`,
      `Task soil refs: ${contextRefs}`,
      `Permission boundary refs: ${input.permissionBoundaryRefs.join(", ") || "(none)"}`,
      `Collected evidence refs: ${input.evidenceRefs.join(", ") || "(none)"}`,
      `Prior decisions:`,
      priorSection,
      `Completed child materials:`,
      childSection,
      `Child run facts:`,
      childRunFactSection,
      boardSection,
      intakeSection,
      followUpSection,
      correctionSection,
      "",
      "请决策本轮动作并输出 JSON。",
    ].filter((line) => line.length > 0).join("\n"),
  };
  const parseFeedback = formatParseErrorFeedback(input.priorParseError);
  if (parseFeedback.length === 0) {
    return [system, user];
  }
  const feedback: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:decision_parse_feedback",
    content: parseFeedback,
  };
  return [system, user, feedback];
}

export function deepIntakeMessages(input: DeepIntakeMessagesInput): readonly DeepTurnMessage[] {
  const toolSection = formatCapabilityToolSection(input.capabilitySnapshot);
  const previousTurns = input.intakeTurns === undefined || input.intakeTurns.length === 0
    ? "(暂无多 Agent 入口对话历史)"
    : input.intakeTurns
      .slice(-6)
      .map((turn, index) => [
        `  ${index + 1}. 用户：${turn.userMessage}`,
        `     助手：${turn.assistantMessage}`,
        `     动作：${turn.action}${turn.normalizedObjective ? `；目标：${turn.normalizedObjective}` : ""}`,
      ].join("\n"))
      .join("\n");
  const system: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:intake_system",
    content: [
      "你是多 Agent 入口助手。你的职责是先理解用户目标，再决定是否需要协作研究。",
      "你面对的是同一个多 Agent 会话，不是一次性表单。只要有 Conversation goal、Current objective 或 Terminal run summary，",
      "默认把用户新消息理解为围绕当前主题的补充、追问、解释请求或下一轮研究要求；不要把短输入孤立成新任务。",
      "",
      "你必须在三种动作中选择一种：",
      "- ask_user：输入低信息量且无法结合当前主题判断意图，或范围/产出/约束仍缺失时，向用户自然追问。",
      "- direct_answer：用户是在追问、解释、展开或澄清当前结论，且无需新的协作探索时，直接给出有用回答。",
      "- start_collaboration：用户明确要求继续研究、补充新角度、比较、证据收集或综合时，给出短计划并启动协作。",
      "- start_collaboration：用户要求列目录、读取/修改文件、查看当前工作区、执行命令、检查项目状态，或其他需要一手文件/终端证据的任务时，启动协作并由 child 使用授权工具。",
      "",
      "边界：",
      "- 不要因为用户提交了消息就默认启动协作。",
      "- 入口助手本身不直接执行工具；需要工具时应选择 start_collaboration，由 manager 派生 child 通过标准工具循环执行。",
      "- 当下方「可用工具清单」存在工具时，不得声称没有文件、终端、工作区或底层工具；只有清单明确为空时才可说明当前无可执行工具。",
      "- 若选择 start_collaboration，normalizedObjective 必须合并当前主题与用户新补充，不能只复述本轮短消息。",
      "- 不要使用固定工作流话术；只解释用户此刻需要知道的内容。",
      "- 计划要短，面向大众用户，避免内部术语。",
      "- 输出只使用结构化 JSON，不要暴露 raw prompt、raw response 或工具原始输出。",
      "",
      toolSection,
      "",
      "期望输出 JSON：",
      "{",
      "  \"action\": \"ask_user | direct_answer | start_collaboration\",",
      "  \"assistantMessage\": \"自然、简短、用户可见的回复\",",
      "  \"normalizedObjective\": \"仅在目标明确时给出标准化目标\",",
      "  \"plan\": \"仅 start_collaboration 时给出短计划\",",
      "  \"uncertainty\": \"主要不确定性\",",
      "  \"confidence\": 0.7",
      "}",
    ].join("\n"),
  };
  const user: DeepTurnMessage = {
    role: "user",
    ref: "context:deep:intake_user",
    content: [
      `User message: ${input.message}`,
      `Conversation goal: ${input.conversationGoal ?? "(new conversation)"}`,
      `Current objective: ${input.currentObjective ?? "(none)"}`,
      `Previous intake turns:\n${previousTurns}`,
      `Terminal run summary: ${input.terminalRunSummary ?? "(none)"}`,
      `Task soil summary: ${input.taskSoilSummary ?? "(no extra context)"}`,
      input.priorParseError ? `Previous parse error: ${input.priorParseError}` : undefined,
      "",
      "请判断下一步动作并输出 JSON。",
    ].filter((line): line is string => line !== undefined).join("\n"),
  };
  return [system, user];
}

export function deepDirectAnswerMessages(input: DeepDirectAnswerMessagesInput): readonly DeepTurnMessage[] {
  const system: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:direct_answer_system",
    content: [
      "你是 DeepRuntime 的 manager，正在直接回答一个你判定无需多角度探索的目标。",
      "请基于现有证据产出结论级 SynthesizedConclusion，包含五要素：",
      "conclusion（结论）, oneLineRationale（一句话理由）, keyEvidenceRefs（关键证据引用）,",
      "mainUncertainty（主要不确定性）。candidateDispositions 可留空（直接回答场景无候选取舍）。",
    ].join("\n"),
  };
  const user: DeepTurnMessage = {
    role: "user",
    ref: "context:deep:direct_answer_user",
    content: [
      `Raw goal: ${input.goal}`,
      `Task soil refs: ${taskSoilContextSummary(input.taskSoil)}`,
      `Decision rationale: ${input.decision.decisionSummary}`,
      `Evidence refs: ${input.evidenceRefs.join(", ") || "(none)"}`,
      "",
      "请输出结论 JSON。",
    ].join("\n"),
  };
  const parseFeedback = formatParseErrorFeedback(input.priorParseError);
  if (parseFeedback.length === 0) {
    return [system, user];
  }
  const feedback: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:direct_answer_parse_feedback",
    content: parseFeedback,
  };
  return [system, user, feedback];
}

export function deepChildMaterialMessages(input: DeepChildMaterialMessagesInput): readonly DeepTurnMessage[] {
  const system: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:child_material_system",
    content: [
      "你是 DeepRuntime 派生的一个 child agent，负责从特定角度探索目标的一个方面。",
      "你只能在一层深度内工作（不可再派生子 agent）。你可以使用授权工具收集证据。",
      "产出局部材料 JSON：summary（摘要）, findings（关键发现数组）, evidenceRefs（证据引用）,",
      "uncertainty（本角度的主要不确定性）, confidence(0-1)。",
      "请保留来源/证据/置信度/适用条件，便于父层综合时取舍。",
    ].join("\n"),
  };
  const user: DeepTurnMessage = {
    role: "user",
    ref: "context:deep:child_material_user",
    content: [
      `Parent goal: ${input.goal}`,
      `Your role: ${input.childSpec.role} (${input.childSpec.displayName})`,
      `Your objective: ${input.childSpec.objective}`,
      `Allowed tools: ${input.childSpec.allowedTools.join(", ") || "(none)"}`,
      `Input refs: ${input.childSpec.inputRefs.join(", ") || "(none)"}`,
      `Permission boundary refs: ${input.permissionBoundaryRefs.join(", ") || "(none)"}`,
      "",
      "请探索并输出局部材料 JSON。",
    ].join("\n"),
  };
  return [system, user];
}

export function deepSynthesisMessages(input: DeepSynthesisMessagesInput): readonly DeepTurnMessage[] {
  const system: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:synthesis_system",
    content: [
      "你是 DeepRuntime 的 manager，正在做父层综合：消费多个 child 的局部材料，",
      "对冲突材料做对比/反驳/合并/降权，产出可解释的 SynthesizedConclusion。",
      "结论五要素：conclusion, oneLineRationale, keyEvidenceRefs, candidateDispositions,",
      "mainUncertainty。candidateDispositions 必须说明每个 child 候选为什么选/不选。",
      "candidateDispositions 中每个 child 材料的 candidateId 应优先使用对应 childRunId，便于 run tree 记录父层审查。",
      "child 产出不可直通结论——你必须基于全部材料综合判断，不能照搬单个 child 的 outputRefs。",
    ].join("\n"),
  };
  const childSection = input.childSummaries.length === 0
    ? "(无 child 材料，无法综合)"
    : input.childSummaries.map((child, index) => formatChildSummary(child, index)).join("\n");
  const childRunFactSection = formatChildRunFacts(input.childRuns);
  const user: DeepTurnMessage = {
    role: "user",
    ref: "context:deep:synthesis_user",
    content: [
      `Raw goal: ${input.goal}`,
      `Task soil refs: ${taskSoilContextSummary(input.taskSoil)}`,
      `Collected evidence refs: ${input.evidenceRefs.join(", ") || "(none)"}`,
      `Child materials to synthesize:`,
      childSection,
      `Child run facts:`,
      childRunFactSection,
      "",
      "请综合产出结论 JSON。",
    ].join("\n"),
  };
  return [system, user];
}

// ---------------------------------------------------------------------------
// 解析器
// ---------------------------------------------------------------------------

export function parseDeepIntake(input: {
  readonly value: unknown;
  readonly userMessage: string;
  readonly createdAt: string;
}): DeepIntakeTurn {
  const record = requireRecord(input.value, DEEP_INTAKE_CONTRACT_ID);
  const action = parseDeepIntakeAction(record.action);
  const assistantMessage = requireString(record.assistantMessage, "assistantMessage");
  const normalizedObjective = optionalString(record.normalizedObjective);
  const plan = optionalString(record.plan);
  if (action === "start_collaboration" && normalizedObjective === undefined) {
    throw new Error("deep intake start_collaboration 必须给出 normalizedObjective");
  }
  if (action === "start_collaboration" && plan === undefined) {
    throw new Error("deep intake start_collaboration 必须给出 plan");
  }
  return {
    turnId: createId("deep-intake"),
    userMessage: input.userMessage,
    assistantMessage,
    action,
    normalizedObjective,
    plan,
    uncertainty: optionalString(record.uncertainty),
    confidence: clampConfidence(numberOr(record.confidence, 0.2)),
    createdAt: input.createdAt,
  };
}

/**
 * 解析 manager 决策 structuredOutput 为 DeepDelegationDecision。
 * schema 守卫：动作必须是 manager 动作集之一；置信度裁剪到 [0,1]。
 * source 固定 "ai"——决策由模型语义推理产出。
 */
export function parseDeepDecision(input: {
  readonly value: unknown;
  readonly parentAgentId: string;
  readonly createdAt: string;
}): DeepDelegationDecision {
  const record = requireRecord(input.value, DEEP_DECISION_CONTRACT_ID);
  return {
    decisionId: createId("deep-decision"),
    parentAgentId: input.parentAgentId,
    action: parseDeepAction(record.action),
    childSpecs: parseDeepChildSpecs(record.childSpecs),
    childOperations: parseDeepChildOperations(record.childOperations),
    decisionSummary: requireString(record.decisionSummary, "decisionSummary"),
    rationale: optionalString(record.rationale) ?? requireString(record.decisionSummary, "decisionSummary"),
    uncertainty: requireString(record.uncertainty, "uncertainty"),
    source: "ai",
    confidence: clampConfidence(numberOr(record.confidence, 0.2)),
    reasoningRefs: stringArray(record.reasoningRefs),
    createdAt: input.createdAt,
  };
}

/**
 * 解析 direct_answer structuredOutput 为 SynthesizedConclusion。
 * 直接回答场景候选取舍为空（无 child 候选）。
 */
export function parseDeepDirectAnswer(input: {
  readonly value: unknown;
  readonly createdAt: string;
  readonly evidenceRefs: readonly string[];
}): SynthesizedConclusion {
  const record = requireRecord(input.value, DEEP_DIRECT_ANSWER_CONTRACT_ID);
  const conclusion = requireString(record.conclusion, "conclusion");
  return {
    conclusionId: createId("deep-conclusion"),
    conclusion,
    oneLineRationale: requireString(record.oneLineRationale, "oneLineRationale"),
    keyEvidenceRefs: dedupeStrings([...input.evidenceRefs, ...stringArray(record.keyEvidenceRefs)]).slice(0, 24),
    candidateDispositions: [],
    mainUncertainty: requireString(record.mainUncertainty, "mainUncertainty"),
    // 直接回答的 outputRefs 由结论本身产出，不等于任何 child outputRefs（直接回答无 child）。
    outputRefs: [`conclusion:${conclusion.slice(0, 40)}`],
    source: "ai",
    confidence: clampConfidence(numberOr(record.confidence, 0.5)),
    createdAt: input.createdAt,
  };
}

/**
 * 解析 child 探索材料 structuredOutput 为 DeepChildSummary。
 */
export function parseDeepChildMaterial(input: {
  readonly value: unknown;
  readonly childSpec: DeepChildSpec;
  readonly childRunId: string;
}): DeepChildSummary {
  const record = requireRecord(input.value, DEEP_CHILD_MATERIAL_CONTRACT_ID);
  return {
    childRunId: input.childRunId,
    spec: input.childSpec,
    status: "completed",
    summary: requireString(record.summary, "summary"),
    findings: stringArray(record.findings).slice(0, 8),
    evidenceRefs: stringArray(record.evidenceRefs).slice(0, 16),
    confidence: clampConfidence(numberOr(record.confidence, 0.2)),
    uncertainty: optionalString(record.uncertainty),
  };
}

/**
 * 解析父层综合 structuredOutput 为 SynthesizedConclusion。
 * 候选取舍（candidateDispositions）解析为 CandidateDisposition 数组。
 */
export function parseDeepSynthesis(input: {
  readonly value: unknown;
  readonly createdAt: string;
  readonly childSummaries: readonly DeepChildSummary[];
}): SynthesizedConclusion {
  const record = requireRecord(input.value, DEEP_SYNTHESIS_CONTRACT_ID);
  const conclusion = requireString(record.conclusion, "conclusion");
  return {
    conclusionId: createId("deep-conclusion"),
    conclusion,
    oneLineRationale: requireString(record.oneLineRationale, "oneLineRationale"),
    keyEvidenceRefs: stringArray(record.keyEvidenceRefs).slice(0, 24),
    candidateDispositions: parseCandidateDispositions(record.candidateDispositions, input.childSummaries),
    mainUncertainty: requireString(record.mainUncertainty, "mainUncertainty"),
    // 综合产出 outputRefs 由结论本身产出；assertNoDirectChildOutputHandoff 在写入前断言
    // 其不等于任何 child outputRefs（FR-005 硬约束）。
    outputRefs: [`synthesis:${conclusion.slice(0, 40)}`],
    source: "ai",
    confidence: clampConfidence(numberOr(record.confidence, 0.5)),
    createdAt: input.createdAt,
  };
}

/**
 * 提取 ModelResponse 的 structuredOutput（json_object 契约）。
 * 若模型返回 textOutput（某些适配器），尝试 JSON.parse；失败则交给解析器 schema 守卫抛错。
 */
export function extractStructuredOutput(response: ModelResponse | undefined): unknown {
  if (response === undefined) {
    return undefined;
  }
  if (response.structuredOutput !== undefined) {
    return response.structuredOutput;
  }
  if (typeof response.textOutput === "string" && response.textOutput.trim().length > 0) {
    try {
      return JSON.parse(response.textOutput);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 本地解析辅助函数（不 import legacy cognitive-work-session-safe.js）
// ---------------------------------------------------------------------------

function requireRecord(value: unknown, contractId: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${contractId}: structuredOutput 必须是 JSON 对象，实际为 ${describeValue(value)}`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field}: 必须是非空字符串，实际为 ${describeValue(value)}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalRoundLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function describeValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function parseDeepAction(value: unknown): DeepDelegationAction {
  if (typeof value === "string" && (DEEP_DELEGATION_ACTIONS as readonly string[]).includes(value)) {
    return value as DeepDelegationAction;
  }
  throw new Error(`deep decision action 必须是 manager 动作集之一，实际为 ${describeValue(value)}`);
}

function parseDeepIntakeAction(value: unknown): DeepIntakeDecisionAction {
  if (value === "ask_user" || value === "direct_answer" || value === "start_collaboration") {
    return value;
  }
  throw new Error(`deep intake action 必须是 ask_user/direct_answer/start_collaboration，实际为 ${describeValue(value)}`);
}

function parseDeepChildSpecs(value: unknown): readonly DeepChildSpec[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item, index) => {
    const record = requireRecord(item, `childSpecs[${index}]`);
    const specId = optionalString(record.specId) ?? `deep-child-${index + 1}`;
    return {
      specId,
      displayName: optionalString(record.displayName) ?? `子 Agent ${index + 1}`,
      role: optionalString(record.role) ?? `deep_child_${index + 1}`,
      objective: optionalString(record.objective) ?? "Explore the goal from this child's angle.",
      allowedTools: stringArray(record.allowedTools),
      inputRefs: stringArray(record.inputRefs),
      maxModelRounds: optionalRoundLimit(record.maxModelRounds),
      maxToolRounds: optionalRoundLimit(record.maxToolRounds),
    };
  });
}

function parseDeepChildOperations(value: unknown): readonly DeepChildOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      const record = requireRecord(item, `childOperations[${index}]`);
      return {
        childRunId: requireString(record.childRunId, `childOperations[${index}].childRunId`),
        review: parseDeepChildOperationReview(record, index),
        instruction: requireString(record.instruction, `childOperations[${index}].instruction`),
      };
    });
}

function parseDeepChildOperationReview(
  operationRecord: Record<string, unknown>,
  operationIndex: number,
): ChildAgentRunParentReview | undefined {
  const rawReview = operationRecord.review;
  const reviewRecord =
    rawReview === undefined
      ? operationRecord
      : requireRecord(rawReview, `childOperations[${operationIndex}].review`);
  const reason =
    optionalString(reviewRecord.reason) ??
    optionalString(reviewRecord.reviewReason);
  if (reason === undefined) {
    return undefined;
  }
  const decision = parseChildReviewDecision(
    optionalString(reviewRecord.decision) ??
    optionalString(reviewRecord.reviewDecision),
  );
  const confidenceValue = reviewRecord.confidence ?? reviewRecord.reviewConfidence;
  return {
    decision,
    reason,
    evidenceRefs: stringArray(reviewRecord.evidenceRefs ?? reviewRecord.reviewEvidenceRefs),
    confidence: confidenceValue === undefined ? undefined : clampConfidence(numberOr(confidenceValue, 0.2)),
  };
}

function parseChildReviewDecision(value: string | undefined): ChildAgentRunParentReview["decision"] {
  switch (value) {
    case "accepted":
    case "rejected":
    case "needs_followup":
      return value;
    default:
      return "needs_followup";
  }
}

function parseCandidateDispositions(
  value: unknown,
  childSummaries: readonly DeepChildSummary[],
): readonly CandidateDisposition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const knownChildIds = new Set(childSummaries.map((child) => child.childRunId));
  return value.map((item, index) => {
    const record = requireRecord(item, `candidateDispositions[${index}]`);
    const candidateId = optionalString(record.candidateId) ?? `candidate-${index + 1}`;
    return {
      candidateId,
      label: optionalString(record.label) ?? candidateId,
      selected: Boolean(record.selected),
      reason: optionalString(record.reason) ?? (knownChildIds.has(candidateId) ? "Adopted." : "Not adopted."),
    };
  });
}

function taskSoilContextSummary(taskSoil: TaskSoil): string {
  const refs = taskSoil.contextRefs.map((ref) => `${ref.kind}:${ref.ref}`);
  return [
    `taskSoil:${taskSoil.taskSoilId}`,
    taskSoil.goalId ? `goal:${taskSoil.goalId}` : "",
    taskSoil.traceId ? `trace:${taskSoil.traceId}` : "",
    ...refs,
  ].filter((segment) => segment.length > 0).join(", ");
}

function formatCorrectionContext(correctionContext: readonly string[] | undefined): string {
  if (correctionContext === undefined) {
    return "";
  }
  const entries = correctionContext
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    return "";
  }
  const lines = entries.map((entry, index) => `  ${index + 1}. ${entry}`).join("\n");
  return [`User corrections / supplementary context (必须据此调整本轮派生与综合方向):`, lines].join("\n");
}

function formatFollowUpContext(context: DeepFollowUpContext | undefined): string {
  if (context === undefined) {
    return "";
  }
  const childLines = context.childSummaries.length === 0
    ? ["  (上一轮没有可复用的探索摘要)"]
    : context.childSummaries.map((summary, index) => {
      const findings = summary.findings.length === 0 ? "" : `     findings=${summary.findings.join(" | ")}`;
      const evidence = summary.evidenceRefs.length === 0 ? "" : `     evidenceRefs=${summary.evidenceRefs.join(", ")}`;
      const confidence = summary.confidence === undefined ? "" : `     confidence=${summary.confidence}`;
      const uncertainty = summary.uncertainty === undefined ? "" : `     uncertainty=${summary.uncertainty}`;
      return [
        `  ${index + 1}. ${summary.displayName} (${summary.role}, ${summary.status})`,
        `     summary=${summary.summary || "(empty)"}`,
        findings,
        evidence,
        confidence,
        uncertainty,
      ].filter((line) => line.length > 0).join("\n");
    });
  return [
    "Follow-up context (同一多 Agent 任务链的新一轮补充；必须结合上一轮结构化产物判断下一步):",
    `  userMessage: ${context.message}`,
    `  previousRunId: ${context.previousRunId}`,
    `  previousGoal: ${context.previousGoal}`,
    `  previousStatus: ${context.previousStatus}`,
    `  previousConclusion: ${context.previousConclusion ?? "(none)"}`,
    `  previousOneLineRationale: ${context.previousOneLineRationale ?? "(none)"}`,
    `  synthesisSummary: ${context.synthesisSummary ?? "(none)"}`,
    "  previous child summaries:",
    ...childLines,
  ].join("\n");
}

function formatIntakeContext(context: DeepIntakeContext | undefined): string {
  if (context === undefined) {
    return "";
  }
  return [
    "Intake context (协作启动前的目标理解与短计划；只含安全结构化字段):",
    `  normalizedObjective: ${context.normalizedObjective ?? "(none)"}`,
    `  assistantMessage: ${context.assistantMessage}`,
    `  plan: ${context.plan ?? "(none)"}`,
    `  uncertainty: ${context.uncertainty ?? "(none)"}`,
    `  confidence: ${context.confidence ?? "(none)"}`,
  ].join("\n");
}

function formatCapabilityToolSection(snapshot: BasicAgentCapabilitySnapshot | undefined): string {
  if (snapshot === undefined) {
    return "可用工具清单：未提供冻结能力快照；不要编造工具名。";
  }
  const allowedTools = new Set(snapshot.toolCatalog.allowedTools);
  const tools = snapshot.toolCatalog.tools
    .filter((tool) => allowedTools.has(tool.name) && tool.enabled && tool.availability === "available")
    .map((tool) => {
      const description = tool.displayDescription || tool.description || tool.operationLabel;
      return `  - ${tool.name}: ${description}（${tool.categoryLabel} / ${tool.operationLabel} / ${tool.confirmationLabel}）`;
    });
  if (tools.length === 0) {
    return "可用工具清单：本轮没有可用工具；allowedTools 应为空数组。";
  }
  return ["可用工具清单（只能从这些真实工具名中选择 allowedTools）：", ...tools].join("\n");
}

/**
 * FR-PROJ-01：把任务板运行中快照投影为安全结构化摘要，供 manager 决策消息消费。
 *
 * 投影口径（design.md §3.2 / FR-SPAWN-02）：当前相位 + 各状态计数 + 最近完成 child 摘要
 * + 最近受阻/失败 child 原因。安全边界：不暴露 raw prompt / raw response / 工具原始输出；
 * completed 的一手材料（findings/evidenceRefs）已由 childSection 详列，此处只给一句话
 * 摘要 + 失败原因，避免重复堆叠。
 */
function formatTaskBoardSummary(snapshot: DeepTaskBoardSnapshot | undefined): string {
  if (snapshot === undefined) {
    return "";
  }
  const tasks = snapshot.tasks;
  if (tasks.length === 0) {
    return `Task board (phase=${snapshot.phase}): 暂无任务。`;
  }
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
  }
  const countLine = ["pending", "running", "completed", "failed", "cancelled", "blocked"]
    .map((status) => `${status}=${counts[status] ?? 0}`)
    .join(", ");
  // 最近完成 child：按入板顺序取末尾最多 3 条，仅投影 displayName + 一句话 summary。
  const recentCompleted = tasks
    .filter((task) => task.status === "completed")
    .slice(-3)
    .map((task) => `  - [${task.childRunId}] ${task.spec.displayName}: ${task.summary?.summary ?? "(no summary)"}`);
  // 最近失败 child：投影失败原因，帮助 manager 判断是否需重新探索。
  const recentFailed = tasks
    .filter((task) => task.status === "failed")
    .slice(-3)
    .map((task) => `  - [${task.childRunId}] ${task.spec.displayName}: ${task.failure ?? "(no failure detail)"}`);
  const recentBlocked = tasks
    .filter((task) => task.status === "blocked")
    .slice(-3)
    .map((task) => `  - [${task.childRunId}] ${task.spec.displayName}: ${task.failure ?? task.summary?.uncertainty ?? "(no blocked detail)"}`);
  const lines = [`Task board (phase=${snapshot.phase}): ${countLine}`];
  if (recentCompleted.length > 0) {
    lines.push("最近完成 child:", ...recentCompleted);
  }
  if (recentBlocked.length > 0) {
    lines.push("最近受阻 child:", ...recentBlocked);
  }
  if (recentFailed.length > 0) {
    lines.push("最近失败 child:", ...recentFailed);
  }
  return lines.join("\n");
}

function formatParseErrorFeedback(priorParseError: string | undefined): string {
  if (priorParseError === undefined || priorParseError.trim().length === 0) {
    return "";
  }
  return [
    "[parse feedback] Your last JSON output could not be parsed; please fix and re-output.",
    `Last error: ${priorParseError}`,
    "Requirement: output strictly per the contract JSON schema, all fields present and correctly typed;",
    "output only the JSON object itself, with no markdown code fences (```) or extra prose.",
  ].join("\n");
}

function formatChildSummary(child: DeepChildSummary, index: number): string {
  // EP3: expose child.status; non-completed (e.g. failed) appends [status=failed] so the
  // synthesis model down-weights it (empty findings/evidenceRefs, confidence=0) instead of
  // treating it as normal evidence.
  const statusTag = child.status !== undefined && child.status !== "completed"
    ? ` [status=${child.status}]`
    : "";
  const confidence = child.confidence !== undefined ? ` (confidence=${child.confidence})` : "";
  const uncertainty = child.uncertainty !== undefined ? `\n      uncertainty: ${child.uncertainty}` : "";
  return [
    `  ${index + 1}. [${child.childRunId}] ${child.spec.displayName} (${child.spec.role})${confidence}${statusTag}`,
    `      summary: ${child.summary}`,
    `      findings: ${child.findings.join("; ") || "(none)"}`,
    `      evidenceRefs: ${child.evidenceRefs.join(", ") || "(none)"}`,
    uncertainty,
  ].join("\n");
}

function formatChildRunFacts(childRuns: readonly ChildAgentRun[] | undefined): string {
  if (childRuns === undefined || childRuns.length === 0) {
    return "(暂无 child run 执行/父层操作事实)";
  }
  return childRuns.map((run, index) => {
    const executionSegments = run.executionHistory?.length ?? (run.execution === undefined ? 0 : 1);
    const latestExecution = run.execution === undefined
      ? "latestLoop=(none)"
      : `latestLoop=model:${run.execution.modelRounds}/tool:${run.execution.toolRounds}/toolCalls:${run.execution.toolCalls.length}`;
    const parentOperations = run.parentInstructions === undefined || run.parentInstructions.length === 0
      ? "(none)"
      : run.parentInstructions
          .slice(-4)
          .map((instruction, operationIndex) =>
            `${operationIndex + 1}. ${instruction.source}/${instruction.status} (${instruction.messageRef ?? instruction.instructionId}): ${instruction.instructionSummary}${formatParentOperationReview(instruction.review)}`,
          )
          .join(" | ");
    const pendingApproval = run.pendingApproval === undefined
      ? ""
      : `\n      pendingApproval: ${run.pendingApproval.toolName} / ${run.pendingApproval.actionSummary}`;
    return [
      `  ${index + 1}. [${run.childRunId}] status=${run.status}; executionSegments=${executionSegments}; ${latestExecution}`,
      `      segmentHistory: ${formatChildExecutionSegments(run)}`,
      `      parentOperations: ${parentOperations}`,
      pendingApproval,
    ].join("\n");
  }).join("\n");
}

function formatParentOperationReview(review: ChildAgentRunParentReview | undefined): string {
  if (review === undefined) {
    return "";
  }
  const evidenceRefs = review.evidenceRefs.length === 0 ? "(none)" : review.evidenceRefs.join(", ");
  return `; review=${review.decision}: ${review.reason}; reviewEvidenceRefs=${evidenceRefs}`;
}

function formatChildExecutionSegments(run: ChildAgentRun): string {
  const history = run.executionHistory ?? [];
  if (history.length === 0) {
    return run.execution === undefined
      ? "(none)"
      : `latestOnly model:${run.execution.modelRounds}/tool:${run.execution.toolRounds}/toolCalls:${formatChildRunFactToolCalls(run.execution.toolCalls)}`;
  }
  return history.slice(-4).map((segment, index) => {
    const segmentNumber = history.length - Math.min(history.length, 4) + index + 1;
    return [
      `${segmentNumber}.${segment.outcome}`,
      `model:${segment.modelRounds}`,
      `tool:${segment.toolRounds}`,
      `toolCalls:${formatChildRunFactToolCalls(segment.toolCalls)}`,
      `at:${segment.recordedAt}`,
    ].join(" ");
  }).join(" | ");
}

function formatChildRunFactToolCalls(toolCalls: ChildAgentRunExecution["toolCalls"]): string {
  if (toolCalls.length === 0) {
    return "(none)";
  }
  return toolCalls
    .slice(0, 6)
    .map((call) => `${call.toolName}:${call.status}`)
    .join(",");
}

// ---------------------------------------------------------------------------
// 类型再导出（供消费方按需引用）
// ---------------------------------------------------------------------------

export type { ModelMessage };
