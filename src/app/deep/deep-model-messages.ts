import type { TaskSoil } from "../../domain/soil/task-soil.js";
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/index.js";
import type {
  ChildAgentRun,
  ChildAgentRunExecution,
} from "../../domain/underground/agent-fabric.js";
import type {
  ChildAgentRunParentReview,
  DeepChildSummary,
  DeepFollowUpContext,
  DeepIntakeContext,
  DeepTaskBoardSnapshot,
} from "./contracts.js";
import type {
  DeepChildMaterialMessagesInput,
  DeepDecisionMessagesInput,
  DeepDirectAnswerMessagesInput,
  DeepIntakeMessagesInput,
  DeepSynthesisMessagesInput,
  DeepTurnMessage,
} from "./deep-model-contracts.js";
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
