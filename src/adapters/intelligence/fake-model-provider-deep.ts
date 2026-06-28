/**
 * Fake model provider 输出：deep 一期四类契约（ADR-0025）。
 *
 * 为 FakeModelProvider 的 defaultFakeOutput 派发提供 deep.decision / deep.direct_answer /
 * deep.child_material / deep.synthesis 四类契约的确定性 fixture 输出，供集成/演示场景与
 * 不依赖显式 responses 序列的测试使用。
 *
 * 设计边界（与 fake-model-provider-underground/desktop 一致）：
 *   - 这些是确定性 fixture，标注 "fake"/"测试模型"，不伪装真实判断；
 *   - 决策输出是 goal/content-aware 的稳定默认（轻问题→direct_answer，复杂目标→spawn_children，
 *     已有 child 材料→synthesize），使默认 deep run 能跑通 manager→child→综合闭环；
 *   - 需要精确控制动作序列的测试应使用 FakeModelProvider 的 responses 数组（按 callCount 派发），
 *     不依赖本文件的 goal/content 启发式。
 */
import type { ModelRequest } from "../../domain/intelligence/index.js";
import {
  fakeGoalAnchorFromRequest,
  fakeRequestContent,
  includesAny,
  isLightweightQuestion,
  looksLikeComplexDesktopTask,
  matchLineValue,
} from "./fake-model-provider-common.js";

/** 无 child 材料标记（与 deepDecisionMessages 的空 child 区段文案对齐）。 */
const NO_CHILD_MATERIALS_MARKER = "(暂无已完成的 child 探索材料)";

/**
 * deep.intake.v1 输出。测试模型只提供稳定 fixture，用于验证入口不会提交即 run：
 *   - 低信息量输入 → ask_user；
 *   - 轻量问题 → direct_answer；
 *   - 复杂目标 → start_collaboration。
 */
export function fakeDeepIntakeOutput(request: ModelRequest): Record<string, unknown> {
  const message = fakeGoalAnchorFromRequest(request);
  const content = fakeRequestContent(request);
  const normalized = message.toLowerCase().trim().replace(/[。.!！?？]+$/u, "");
  if (
    normalized.length <= 3 ||
    includesAny(normalized, ["随便", "无用", "嗯", "额", "谢谢", "thanks"])
  ) {
    return {
      action: "ask_user",
      assistantMessage: "我还需要知道你想解决什么问题、希望得到什么结果，或有哪些范围限制。",
      uncertainty: "用户输入的信息量不足，无法判断是否需要协作。",
      confidence: 0.78,
    };
  }
  if (looksLikeIntakeCollaborationGoal(message)) {
    const normalizedObjective = continuousIntakeObjective(message, content);
    return {
      action: "start_collaboration",
      assistantMessage: "我会先收窄目标，再并行查看关键角度，最后把结论合并成一个可执行建议。",
      normalizedObjective,
      plan: "先明确目标与范围；再从风险、现有资产契合度两个角度探索；最后综合成结论。",
      uncertainty: "测试模型会启动固定的两角度协作 fixture。",
      confidence: 0.76,
    };
  }
  if (isLightweightQuestion(message)) {
    return {
      action: "direct_answer",
      assistantMessage: `这是一个可以直接回答的问题：${message}`,
      normalizedObjective: message,
      uncertainty: "测试模型只提供简短 fixture 回答。",
      confidence: 0.82,
    };
  }
  return {
    action: "direct_answer",
    assistantMessage: `我可以直接回答：${message}`,
    normalizedObjective: message,
    uncertainty: "测试模型默认把普通明确问题作为直接回答处理。",
    confidence: 0.72,
  };
}

/**
 * deep.decision.v1 输出（manager 决策）。goal/content-aware 稳定默认：
 *   - 轻量问题 → direct_answer（无需多角度探索）；
 *   - 决策消息中已有 child 材料（非空占位）→ synthesize（进入父层综合）；
 *   - 复杂桌面任务 → spawn_children（派生 2 个 child 分头探索）；
 *   - 默认 → direct_answer（简单收束，避免无界循环）。
 */
export function fakeDeepDecisionOutput(request: ModelRequest): Record<string, unknown> {
  const goalAnchor = fakeGoalAnchorFromRequest(request);
  const content = fakeRequestContent(request);

  if (isLightweightQuestion(goalAnchor)) {
    return {
      action: "direct_answer",
      childSpecs: [],
      decisionSummary:
        "这是一个可以直接回答的轻量问题，不需要多角度探索或派生 child。",
      rationale: "Fake deep manager: lightweight question, evidence sufficient for direct answer.",
      uncertainty: "如果用户后续要求多角度分析，再进入 spawn_children。",
      confidence: 0.82,
      reasoningRefs: [],
    };
  }

  // 决策消息含已完成的 child 材料（非空占位）→ 综合收束。
  if (
    content.includes("Completed child materials:") &&
    !content.includes(NO_CHILD_MATERIALS_MARKER)
  ) {
    return {
      action: "synthesize",
      childSpecs: [],
      decisionSummary: "child 局部材料已返回，进入父层综合产出结论。",
      rationale: "Fake deep manager: child materials present, synthesize conclusion.",
      uncertainty: "测试模型稳定决策；真实运行应比较证据与冲突后再综合。",
      confidence: 0.75,
      reasoningRefs: [],
    };
  }

  // 复杂桌面任务 → 派生 child 分头探索。
  if (looksLikeComplexDesktopTask(goalAnchor)) {
    return {
      action: "spawn_children",
      childSpecs: fakeDeepChildSpecs(goalAnchor),
      decisionSummary: "目标需要多角度探索，派生 child 分头收集证据。",
      rationale: "Fake deep manager: complex task, spawn children for multi-angle exploration.",
      uncertainty: "测试模型稳定决策；真实运行应判断证据是否足够再分工。",
      confidence: 0.74,
      reasoningRefs: [],
    };
  }

  return {
    action: "direct_answer",
    childSpecs: [],
    decisionSummary: "证据已足够，直接产出结论。",
    rationale: "Fake deep manager: default to direct answer (simple closure).",
    uncertainty: "测试模型稳定决策；真实运行由模型语义判断是否需要派生 child。",
    confidence: 0.7,
    reasoningRefs: [],
  };
}

/**
 * deep.direct_answer.v1 输出（direct_answer 分支的结论级 SynthesizedConclusion）。
 */
export function fakeDeepDirectAnswerOutput(request: ModelRequest): Record<string, unknown> {
  const goalAnchor = fakeGoalAnchorFromRequest(request);
  return {
    conclusion: `基于现有证据对「${truncate(goalAnchor, 80)}」的直接结论：目标可行，建议按当前方向推进。`,
    oneLineRationale: "Fake deep direct answer: 证据足够，无需多角度探索即可给出结论。",
    keyEvidenceRefs: [`goal:${truncate(goalAnchor, 40)}`],
    mainUncertainty: "测试模型稳定输出；真实运行应核对证据覆盖度与边界条件。",
    confidence: 0.72,
  };
}

/**
 * deep.child_material.v1 输出（child 探索的局部材料）。
 * 从 request 消息中解析 child role/objective，产出含来源/发现/证据/置信度的材料。
 */
export function fakeDeepChildMaterialOutput(request: ModelRequest): Record<string, unknown> {
  const goalAnchor = fakeGoalAnchorFromRequest(request);
  const content = fakeRequestContent(request);
  const role = matchLineValue(content, "Your role:") ?? "deep_child";
  const objective = matchLineValue(content, "Your objective:") ?? "Explore the goal.";
  return {
    summary: `从「${truncate(role, 60)}」角度探索：${truncate(objective, 80)}，已收集初步证据。`,
    findings: [
      `角度 ${truncate(role, 40)}：目标「${truncate(goalAnchor, 40)}」在本方向上基本可行。`,
      "Fake child material: 测试模型稳定输出，真实运行应给出可验证的来源与证据。",
    ],
    evidenceRefs: [
      `child:${truncate(role, 30)}:evidence-1`,
      `goal:${truncate(goalAnchor, 30)}`,
    ],
    uncertainty: "测试模型未真正调用工具；真实 child 应给出适用条件与失败条件。",
    confidence: 0.6,
  };
}

/**
 * deep.synthesis.v1 输出（父层综合结论级 SynthesizedConclusion，五要素）。
 * candidateDispositions 对每个 child 候选给出选/不选理由（FR-006 可解释结论）。
 *
 * outputRefs 使用 synthesis: 前缀（不等于任何 child outputRefs），满足
 * assertNoDirectChildOutputHandoff 硬约束（FR-005）。
 */
export function fakeDeepSynthesisOutput(request: ModelRequest): Record<string, unknown> {
  const goalAnchor = fakeGoalAnchorFromRequest(request);
  const content = fakeRequestContent(request);
  const childIds = parseChildRunIds(content);
  const candidateDispositions = childIds.map((childId, index) => ({
    candidateId: childId,
    label: `child-${index + 1}`,
    selected: index === 0,
    reason:
      index === 0
        ? "Fake synthesis: 第一个 child 材料与结论方向最契合，采纳为主线。"
        : "Fake synthesis: 该 child 材料作为补充/对照，不作为主线。",
  }));
  return {
    conclusion: `综合 ${childIds.length} 个 child 材料对「${truncate(
      goalAnchor,
      80,
    )}」的结论：多角度证据一致支持当前方向，可推进交付。`,
    oneLineRationale: "Fake synthesis: 多 child 材料经对比/合并后一致支持结论方向。",
    keyEvidenceRefs: [`goal:${truncate(goalAnchor, 40)}`, `synthesis:${truncate(goalAnchor, 30)}`],
    candidateDispositions,
    mainUncertainty: "测试模型稳定输出；真实综合应显式处理冲突材料并降权弱证据。",
    confidence: 0.78,
  };
}

// ---------------------------------------------------------------------------
// 本地辅助函数
// ---------------------------------------------------------------------------

/**
 * 默认派生的 child 派生请求（spawn_children 时）。2 个角度：risk / asset_fit。
 * 与 fakeWorkSessionChildSpecs 风格对齐，但用 deep 契约字段。
 */
function fakeDeepChildSpecs(goalAnchor: string): readonly Record<string, unknown>[] {
  return [
    {
      specId: "deep-child-risk",
      displayName: "风险角度 child",
      role: "risk",
      objective: `从风险角度探索「${truncate(goalAnchor, 60)}」：识别主要风险与缓解条件。`,
      allowedTools: [],
      inputRefs: [`goal:${truncate(goalAnchor, 30)}`],
    },
    {
      specId: "deep-child-asset-fit",
      displayName: "资产契合角度 child",
      role: "asset_fit",
      objective: `从资产契合角度探索「${truncate(
        goalAnchor,
        60,
      )}」：评估现有资产/能力是否支撑目标。`,
      allowedTools: [],
      inputRefs: [`goal:${truncate(goalAnchor, 30)}`],
    },
  ];
}

function looksLikeIntakeCollaborationGoal(goalAnchor: string): boolean {
  const normalized = goalAnchor.toLowerCase().trim();
  return looksLikeComplexDesktopTask(goalAnchor) ||
    includesAny(normalized, [
      "调研",
      "研究",
      "分析",
      "优化方案",
      "形成方案",
      "产出方案",
      "前端交互",
      "多 agent",
      "multi agent",
    ]);
}

function continuousIntakeObjective(message: string, content: string): string {
  const topic = currentIntakeTopic(content);
  if (topic === undefined || topic === message) {
    return message;
  }
  return `${topic}；继续补充：${message}`;
}

function currentIntakeTopic(content: string): string | undefined {
  const currentObjective = usefulContextValue(matchLineValue(content, "Current objective:"));
  if (currentObjective !== undefined) {
    return currentObjective;
  }
  const terminalSummary = usefulContextValue(matchLineValue(content, "Terminal run summary:"));
  const previousGoal = terminalSummary?.match(/上一轮目标：([^;；]+)/u)?.[1]?.trim();
  if (previousGoal !== undefined && previousGoal.length > 0) {
    return previousGoal;
  }
  return usefulContextValue(matchLineValue(content, "Conversation goal:"));
}

function usefulContextValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === "(none)" || trimmed === "(new conversation)"
    ? undefined
    : trimmed;
}

/** 从决策/综合消息内容解析已完成的 child run id（用于 candidateDispositions）。 */
function parseChildRunIds(content: string): string[] {
  const matches = content.match(/\[([a-z0-9-]+)\]/g);
  if (!matches) {
    return [];
  }
  return matches
    .map((match) => match.slice(1, -1))
      .filter((id) => id.includes("child"));
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
