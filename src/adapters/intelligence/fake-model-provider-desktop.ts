import type { ModelRequest } from "../../domain/intelligence/index.js";
import {
  buildFakeReportTitle,
  fakeGoalAnchorFromRequest,
  fakeRequestContent,
  includesAny,
  isFollowUpQuestion,
  isLightweightQuestion,
  looksLikeComplexDesktopTask,
  matchLineValue,
  needsLightToolAnswer,
  stripTrailingSentencePunctuation,
  truncate,
} from "./fake-model-provider-common.js";
import type { FakeModelProviderStep } from "./fake-model-provider-contracts.js";

export function fakeDesktopAgentStep(request: ModelRequest): FakeModelProviderStep {
  const goalAnchor = stripTrailingSentencePunctuation(fakeGoalAnchorFromRequest(request));
  const normalized = goalAnchor.toLowerCase();
  const hasToolMessage = request.sanitizedMessages.some((message) => message.role === "tool");
  const canUseSearch = request.toolChoice !== "none" && request.tools?.some((tool) => tool.name === "search") === true;
  if (needsDesktopFileAuthorization(goalAnchor) && !hasAuthorizedFilePreview(request)) {
    const answer =
      "我现在还不能直接看到你的桌面文件。请先通过附件选择具体文件或文件夹，或给出只读文件引用；拿到授权材料后，我可以继续帮你梳理、总结或分析。";
    return { textOutput: answer };
  }
  if (canUseSearch && !hasToolMessage && shouldUseOrdinaryAgentTools(goalAnchor)) {
    return {
      toolCalls: [
        {
          callId: "call-desktop-agent-search",
          toolName: "search",
          input: {
            query: goalAnchor,
            sources: includesAny(normalized, ["网页", "web", "搜索", "搜一下", "查一下"]) ? ["web", "codebase"] : ["codebase"],
            limit: 3,
          },
        },
      ],
    };
  }
  if (hasToolMessage) {
    const answer =
      `我已经基于当前授权工具检查了“${goalAnchor}”。可用材料只作为本轮回答依据；接下来可以继续补充范围、让我读取更多授权材料，或让我把结论整理成更正式的结果。`;
    return { textOutput: answer };
  }
  if (!looksLikeComplexDesktopTask(goalAnchor)) {
    const answer = fakeWorkSessionDirectAnswerOutput(request);
    return { textOutput: answer };
  }
  const answer =
    `我会把“${goalAnchor}”作为桌面任务处理：先说明当前可判断的结论，再基于你授权的文件、网页或搜索材料继续补证据；涉及命令执行时会先请求确认。`;
  return { textOutput: answer };
}

export function fakeConversationCompactionOutput(request: ModelRequest): string {
  const content = fakeRequestContent(request);
  const lines = content
    .split(/\r?\n/g)
    .filter((line) => line.startsWith("- ["))
    .slice(0, 8)
    .map((line) => line.replace(/\s+/g, " ").trim());
  return [
    "## Goal",
    "- Continue the current desktop agent task.",
    "",
    "## Constraints & Preferences",
    "- Preserve safe context only; do not expose raw internals.",
    "",
    "## Progress",
    "### Done",
    ...lines.map((line) => `- ${line}`),
    ...(lines.length === 0 ? ["- (none)"] : []),
    "",
    "### In Progress",
    "- Continue from the preserved recent messages.",
    "",
    "### Blocked",
    "- (none)",
    "",
    "## Key Decisions",
    "- (none)",
    "",
    "## Next Steps",
    "- Continue the same loop from the current user request.",
    "",
    "## Critical Context",
    "- This continuation prompt is background only, not a completion signal.",
    "",
    "## Relevant Files",
    "- (none)",
  ].join("\n");
}

export function fakeWorkSessionDecisionOutput(request: ModelRequest): Record<string, unknown> {
  const goalAnchor = stripTrailingSentencePunctuation(fakeGoalAnchorFromRequest(request));
  const content = fakeRequestContent(request);
  if (isLightweightQuestion(goalAnchor)) {
    return {
      action: "direct_answer",
      childSpecs: [],
      decisionSummary:
        "这是一个可以直接回答的普通问题，不需要读取工作区、派生子 Agent 或生成报告。",
      uncertainty:
        "如果用户后续要求分析文件、项目或网页，再进入工作会话。",
      confidence: 0.82,
    };
  }
  if (content.includes("Parent synthesis status: ready")) {
    return {
      action: "produce_artifact",
      childSpecs: [],
      decisionSummary:
        "材料已经汇总完成，可以生成可审阅报告。",
      uncertainty:
        "这是测试模型的稳定决策；真实运行仍需要检查综合质量。",
      confidence: 0.76,
    };
  }
  if (content.includes("Completed child runs:") && !content.includes("Completed child runs: none")) {
    return {
      action: "synthesize",
      childSpecs: [],
      decisionSummary:
        "局部材料已经返回，需要先汇总冲突和依据。",
      uncertainty:
        "这是测试模型的稳定决策；真实运行应比较证据和冲突后再综合。",
      confidence: 0.75,
    };
  }
  if (content.includes("Tool call refs:") && !content.includes("Tool call refs: none")) {
    return {
      action: "spawn_children",
      childSpecs: fakeWorkSessionChildSpecs(goalAnchor),
      decisionSummary:
        "已取得上下文引用，接下来分成几路检查关键问题。",
      uncertainty:
        "这是测试模型的稳定决策；真实运行应判断证据是否足够再分工。",
      confidence: 0.75,
    };
  }
  return {
    action: "spawn_children",
    childSpecs: fakeWorkSessionChildSpecs(goalAnchor),
    decisionSummary:
      "先进行几路局部检查，再生成项目分析报告。",
    uncertainty:
      "这是测试模型的稳定决策；真实运行应根据任务和工作区材料调整分工。",
    confidence: 0.76,
  };
}

export function fakeWorkSessionDirectAnswerOutput(request: ModelRequest): string {
  const goalAnchor = stripTrailingSentencePunctuation(fakeGoalAnchorFromRequest(request));
  const normalized = goalAnchor.toLowerCase();
  const asksModelIdentity = includesAny(normalized, [
    "你是什么模型",
    "你是哪个模型",
    "你是谁",
    "what model",
    "which model",
    "who are you",
  ]);
  const asksCapability = includesAny(normalized, [
    "能做什么",
    "可以做什么",
    "会做什么",
    "你能干什么",
    "你能帮我",
    "what can you do",
    "how can you help",
  ]);
  const asksFollowUp = isFollowUpQuestion(normalized);
  if (asksModelIdentity) {
    return "我是 AgentArbor 桌面助手。具体底层模型取决于你在设置中配置的模型运行时；我会直接回答普通问题，也会在授权范围内读取文件、网页或工具材料来完成桌面任务。";
  }
  if (asksCapability) {
    return "我可以直接回答问题，也可以在你授权的上下文里整理材料、分析文件和网页、生成报告、草稿或工作区文件；遇到命令执行时会先停下来问你。你可以继续随便问，也可以直接交给我一个要完成的任务。";
  }
  if (asksFollowUp) {
    return "可以继续。你可以把我当作一个桌面任务助手：普通问题我直接回答；当你给出需要上下文、文件、网页、工具或多步判断的任务时，我会展示正在做的事、引用的材料和需要你确认的边界。";
  }
  if (includesAny(normalized, ["效率", "高效", "建议", "productivity", "efficient"])) {
    return [
      "给你三条可马上执行的效率建议：",
      "1) 先定义今天唯一最重要的一件事，先做完它再切换任务。",
      "2) 用 25-45 分钟专注块处理深度工作，期间关闭通知和无关窗口。",
      "3) 每个专注块结束后写一句“下一步动作”，降低下一次启动成本。",
    ].join("\n");
  }
  return `可以。对于“${goalAnchor}”，我会先给出当前可判断的回答；如果需要读取项目、网页或文件，我会只使用你授权的材料，并在缺少权限或边界不清时先请求确认。`;
}

export function fakeWorkSessionChildMaterialOutput(request: ModelRequest): Record<string, unknown> {
  const content = fakeRequestContent(request);
  const role = matchLineValue(content, "Child role:") ?? "child_agent";
  const objective = matchLineValue(content, "Objective:") ?? "review current work session material";
  const goalAnchor = stripTrailingSentencePunctuation(fakeGoalAnchorFromRequest(request));
  const roleLabel = role.replace(/_/g, " ");
  return {
    summary: `${roleLabel} 认为 AgentArbor 需要围绕 ${goalAnchor} 建立真实工作会话路径。`,
    findings: [
      `当前桌面路径不应继续把固定流程包装成 ${goalAnchor} 的产品主线。`,
      "面板应展示可读结果、不确定性和下一步，而不是强制展示内部成功态。",
      "任何局部材料进入最终结果前，都必须先经过汇总判断。",
    ],
    evidenceRefs: [
      "code:src/app/panel-server.ts",
      "code:src/app/minimal-loop.ts",
      "docs:ADR-0022",
      `objective:${truncate(objective, 48)}`,
    ],
    uncertainty:
      "这是测试模型的局部材料，必须经过汇总判断后才可成为最终报告。",
    confidence: 0.73,
  };
}

export function fakeWorkSessionSynthesisOutput(request: ModelRequest): Record<string, unknown> {
  const goalAnchor = stripTrailingSentencePunctuation(fakeGoalAnchorFromRequest(request));
  const reportTitle = buildFakeReportTitle(goalAnchor);
  const summary = `已为“${goalAnchor}”形成可审阅结果。`;
  return {
    reportTitle,
    keyFindings: [
      `任务目标“${goalAnchor}”已经拆成可检查的问题并完成汇总。`,
      "工作链路把局部材料与最终判断分离，避免局部结论直接冒充最终结果。",
      "结果输出已包含结论、不确定性和后续动作，适合继续进入执行或追问。",
    ],
    recommendations: [
      "优先确认结果是否满足当前任务验收口径，再决定继续扩展还是收敛执行。",
      "保持“局部材料 -> 汇总判断 -> 最终结果”链路，不让子路径绕过收敛门。",
      "对关键结论补一轮真实模型或真实工具验证，避免测试模式偏差。",
    ],
    evidenceRefs: [
      "code:src/app/panel-server.ts",
      "code:src/app/minimal-loop.ts",
      "code:src/domain/underground/agent-fabric.ts",
      "docs:ADR-0022",
    ],
    uncertainty: [
      "真实模型输出质量仍取决于工作会话契约和工具材料质量。",
      "当前示例材料只能证明链路和边界，不能代表真实项目分析深度。",
    ],
    nextActions: [
      "确认是否要把这份结果转为执行清单并开始落地。",
      "若需要更高置信度，补充目标相关的文件或网页引用后再运行一轮。",
      "对关键风险点增加验证步骤，避免仅凭一次综合直接定案。",
    ],
    decisionSummary: summary,
    confidence: 0.78,
  };
}

function shouldUseOrdinaryAgentTools(goalAnchor: string): boolean {
  const normalized = goalAnchor.toLowerCase().trim();
  return includesAny(normalized, [
    "分析当前仓库",
    "看看当前项目",
    "项目",
    "仓库",
    "代码",
    "codebase",
    "repo",
    "repository",
    "网页",
    "搜索",
    "搜一下",
    "查一下",
    "read this page",
    "search",
  ]);
}

function needsDesktopFileAuthorization(goalAnchor: string): boolean {
  const normalized = goalAnchor.toLowerCase().trim();
  return includesAny(normalized, [
    "桌面文件",
    "电脑文件",
    "本地文件",
    "我的文件",
    "desktop file",
    "local file",
    "my files",
  ]);
}

function hasAuthorizedFilePreview(request: ModelRequest): boolean {
  const content = fakeRequestContent(request).toLowerCase();
  return content.includes("file:") || content.includes("workspace:file") || content.includes("preview=");
}

function fakeWorkSessionChildSpecs(goalAnchor: string): readonly Record<string, unknown>[] {
  return [
    {
      specId: "work-session-child-codebase-reader",
      displayName: "代码阅读",
      role: "codebase_reader",
      objective: `Read the current project structure and identify concrete weak points for ${goalAnchor}.`,
      allowedTools: ["search", "read"],
      inputRefs: ["task-soil:current", "workspace:current"],
    },
    {
      specId: "work-session-child-architecture-reviewer",
      displayName: "架构评审",
      role: "architecture_reviewer",
      objective: `Review whether the runtime architecture can produce useful work for ${goalAnchor}.`,
      allowedTools: ["search", "read"],
      inputRefs: ["task-soil:current", "docs:architecture"],
    },
  ];
}
