import type {
  ModelOutputDelta,
  ModelToolCall,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";

export type FakeModelProviderOptions = {
  readonly providerId?: string;
  readonly model?: string;
  readonly output?: unknown;
  readonly textOutput?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly fail?: boolean;
  readonly failureMessage?: string;
  readonly responses?: readonly FakeModelProviderResponse[];
  readonly onOutputDelta?: (delta: ModelOutputDelta) => void;
};

export type FakeModelProviderResponse = {
  readonly output?: unknown;
  readonly textOutput?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly fail?: boolean;
  readonly failureMessage?: string;
};

type FakeModelProviderStep = {
  readonly output?: unknown;
  readonly textOutput?: string;
  readonly toolCalls?: readonly ModelToolCall[];
};

export class FakeModelProvider implements ModelProvider {
  readonly providerId: string;
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model: string;
  private callCount = 0;

  constructor(private readonly options: FakeModelProviderOptions = {}) {
    this.providerId = options.providerId ?? "fake-model-provider";
    this.model = options.model ?? "fake-deterministic-model";
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const step = this.nextStep();
    if (step.fail) {
      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: "provider_response",
        message: step.failureMessage ?? "Fake provider was configured to fail.",
      });
    }

    const defaultStep =
      step.output === undefined && step.textOutput === undefined && step.toolCalls === undefined
        ? defaultFakeStep(request)
        : {};
    const toolCalls = step.toolCalls ?? defaultStep.toolCalls;
    const rawOutput =
      step.output ??
      defaultStep.output ??
      (toolCalls === undefined || toolCalls.length === 0 ? defaultFakeOutput(request) : undefined);
    const textOutput =
      step.textOutput ??
      defaultStep.textOutput ??
      (request.outputContract.format === "text" && typeof rawOutput === "string" ? rawOutput : undefined);
    const output = request.outputContract.format === "text" && textOutput !== undefined ? undefined : rawOutput;
    emitFakeOutputDeltas({
      request,
      providerId: this.providerId,
      model: this.model,
      output,
      textOutput,
      emit: this.options.onOutputDelta,
    });

    return {
      responseId: createId("model-response"),
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: output,
      textOutput,
      toolCalls: toolCalls?.map((toolCall) => ({
        callId: toolCall.callId,
        toolName: toolCall.toolName,
        input: globalThis.structuredClone(toolCall.input),
      })),
      finishReason: toolCalls === undefined || toolCalls.length === 0 ? "stop" : "tool_call",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }

  private nextStep(): FakeModelProviderResponse {
    const step = this.options.responses?.[this.callCount];
    this.callCount += 1;
    return (
      step ?? {
        output: this.options.output,
        textOutput: this.options.textOutput,
        toolCalls: this.options.toolCalls,
        fail: this.options.fail,
        failureMessage: this.options.failureMessage,
      }
    );
  }
}

function emitFakeOutputDeltas(input: {
  readonly request: ModelRequest;
  readonly providerId: string;
  readonly model: string;
  readonly output: unknown;
  readonly textOutput?: string;
  readonly emit?: (delta: ModelOutputDelta) => void;
}): void {
  if (input.emit === undefined) {
    return;
  }
  const text =
    typeof input.textOutput === "string" && input.textOutput.trim().length > 0
      ? input.textOutput
      : typeof input.output === "string"
        ? input.output
        : input.output === undefined
          ? ""
          : JSON.stringify(input.output);
  const chunks = chunkText(text, 80);
  chunks.forEach((delta, index) => {
    input.emit?.({
      requestId: input.request.requestId,
      providerId: input.providerId,
      model: input.model,
      delta,
      index: index + 1,
      createdAt: nowIso(),
    });
  });
}

function chunkText(value: string, maxLength: number): readonly string[] {
  const text = value.trim();
  if (text.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}

function defaultFakeStep(request: ModelRequest): FakeModelProviderStep {
  if (request.outputContract.contractId === "desktop.chat_response.v1") {
    return fakeDesktopChatStep(request);
  }
  return {};
}

function defaultFakeOutput(request: ModelRequest): unknown {
  if (request.outputContract.contractId === "underground.intent_profile.v1") {
    return fakeIntentProfileOutput(request);
  }

  if (request.outputContract.contractId === "underground.growth_governor.v1") {
    return fakeGrowthGovernorOutput(request);
  }

  if (request.outputContract.contractId === "underground.convergence_judgment.v1") {
    return fakeConvergenceJudgmentOutput(request);
  }

  if (request.outputContract.contractId === "underground.handoff_narrative.v1") {
    return fakeHandoffNarrativeOutput(request);
  }

  if (request.outputContract.contractId === "underground.candidate_aggregation.v1") {
    return {
      aggregationRationale: "Fake Candidate Collector aggregated rootlet outputs into a unified candidate pool.",
      deduplicationNotes: ["No duplicates detected in fake output."],
      implicitRelations: [],
      decisionSummary: "Fake candidate aggregation completed.",
      uncertainty: "Fake aggregation is deterministic fixture output.",
      confidence: 0.74,
    };
  }

  if (request.outputContract.contractId === "work_session.decision.v1") {
    return fakeWorkSessionDecisionOutput(request);
  }

  if (request.outputContract.contractId === "work_session.direct_answer.v1") {
    return fakeWorkSessionDirectAnswerOutput(request);
  }

  if (request.outputContract.contractId === "work_session.child_material.v1") {
    return fakeWorkSessionChildMaterialOutput(request);
  }

  if (request.outputContract.contractId === "work_session.synthesis.v1") {
    return fakeWorkSessionSynthesisOutput(request);
  }

  if (request.outputContract.contractId === "convergence-advisory") {
    return {
      candidateAnalyses: [],
      conflictsNeedingUserInput: [],
      constraintViolations: [],
      overallDirectionSummary:
        "Fake convergence advisory keeps CandidatePool, Convergence Judge, and package validation as promotion boundaries.",
    };
  }

  if (request.outputContract.contractId === "underground.autonomy_decision.v1") {
    return {
      action: "request_convergence",
      completionAssessment: "Fake autonomy review found enough candidate material for convergence.",
      informationGaps: [],
      spawnRequests: [],
      rationale: "Fake provider asks Convergence Judge to review candidate material before handoff.",
      sourceRefs: [],
      decisionSummary: "Fake autonomy recommends convergence after reviewing candidate pool.",
      uncertainty: "Fake autonomy output is deterministic fixture, not real judgment.",
      confidence: 0.74,
    };
  }

  if (request.outputContract.requiredFields?.includes("candidates")) {
    const kind = rootletKindFromContractId(request.outputContract.contractId);
    const goalAnchor = rootletGoalAnchor(request);
    return {
      candidates: [fakeCandidateForKind(kind, 1, goalAnchor), fakeCandidateForKind(kind, 2, goalAnchor)],
    };
  }

  return {
    summary: "Fake model candidate advice.",
    rationale: "Deterministic fake provider output for tests and demos.",
  };
}

function fakeDesktopChatStep(request: ModelRequest): FakeModelProviderStep {
  const goalAnchor = stripTrailingSentencePunctuation(rootletGoalAnchor(request));
  if (isLightweightQuestion(goalAnchor)) {
    return {
      textOutput: fakeWorkSessionDirectAnswerOutput(request),
    };
  }
  return {
    toolCalls: [
      {
        callId: "call-start-work-session",
        toolName: "start_work_session",
        input: {
          reason: "任务需要读取上下文、组织材料或产出可审阅结果，升级为工作会话。",
          goal: goalAnchor,
        },
      },
    ],
  };
}

function fakeIntentProfileOutput(request: ModelRequest): Record<string, unknown> {
  const goalAnchor = rootletGoalAnchor(request);
  const goalStatement = stripTrailingSentencePunctuation(goalAnchor);
  const goalTerms = termsFromGoalAnchor(goalAnchor);
  const concepts = goalTerms.length > 0 ? goalTerms : ["agentarbor", "direction", "handoff"];
  const unknowns = fakeUnknownsForGoal(goalAnchor);
  return {
    goalStatement,
    keyConcepts: concepts.slice(0, 5),
    domainConcepts: concepts.filter((term) => !["build", "create", "make", "构建", "实现"].includes(term)).slice(0, 5),
    nonGoals: fakeNonGoalsForGoal(goalAnchor),
    acceptanceCriteria: [
      `The ${goalStatement} direction can be reviewed by parent underground agents before handoff.`,
      "Fallback and model refs remain visible without exposing raw prompts.",
    ],
    assumptions: fakeAssumptionsForGoal(goalAnchor),
    riskHints: fakeRiskHintsForGoal(goalAnchor),
    constraintHints: fakeConstraintHintsForGoal(goalAnchor),
    unknowns,
    decisionSummary: `Fake Intent Core shaped ${goalStatement} into a reviewable profile candidate.`,
    uncertainty: "The fake profile is suitable for deterministic tests, not for product-quality semantic judgment.",
    confidence: 0.78,
  };
}

function fakeGrowthGovernorOutput(request: ModelRequest): Record<string, unknown> {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const availableKinds = parseAvailableRootletKinds(content);
  const rootletKinds = availableKinds.length > 0 ? availableKinds : ["option"];
  const maxCandidateOutputs = rootletKinds.reduce((total, kind) => total + fakeMaxOutputsForKind(kind), 0);
  return {
    rootletKinds,
    budget: {
      maxRootletClusters: rootletKinds.length,
      maxCandidateOutputs,
    },
    dispatchDecision:
      `Start ${rootletKinds.join(", ")} rootlet clusters as lower-layer material; parent agents still own convergence and handoff.`,
    decisionSummary:
      `Fake Growth Governor selected ${rootletKinds.length} rootlet cluster(s) for controlled underground dispatch.`,
    uncertainty: "The fake dispatch is deterministic and must remain bounded by budget, schema, and hard guards.",
    confidence: 0.74,
  };
}

function fakeConvergenceJudgmentOutput(request: ModelRequest): Record<string, unknown> {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const candidates = parseConvergenceCandidates(content);
  const rawGoal = stripTrailingSentencePunctuation(rootletGoalAnchor(request));
  const stopRequested = includesAny(rawGoal.toLowerCase(), ["stop", "stopped", "no viable", "no candidate", "停止", "终止", "无候选"]);
  const clarificationRequested = includesAny(rawGoal.toLowerCase(), [
    "permission",
    "hard constraint",
    "unknown",
    "unclear",
    "待确认",
    "确认",
    "权限",
    "硬约束",
    "未知",
  ]);
  const firstOption = candidates.find((candidate) => candidate.kind === "option");
  const hasClarificationCandidate = clarificationRequested && candidates.some((candidate) => candidate.kind === "constraint");
  const candidateDecisions = candidates.map((candidate) => {
    const status = fakeConvergenceStatusForCandidate({
      candidate,
      firstOptionId: firstOption?.candidateId,
      stopRequested,
      clarificationRequested: hasClarificationCandidate,
    });
    return {
      candidateId: candidate.candidateId,
      status,
      reason: fakeConvergenceReasonForStatus(candidate, status, rawGoal),
      evidenceRefs: [candidate.outputId].filter((ref) => ref !== "unknown"),
      contentDifference: `Fake Convergence Judge differentiated ${candidate.kind} candidate ${candidate.candidateId}.`,
      whyPreferred:
        status === "accepted"
          ? `Fake Convergence Judge selected ${candidate.candidateId} as the retained option.`
          : `Fake Convergence Judge kept ${candidate.candidateId} as ${status} material.`,
      conflictWith: [],
      ...(status === "unknown"
        ? {
            openQuestion: `Confirm boundary before promoting ${candidate.candidateId}.`,
            clarificationReason: "permission_boundary_unclear",
            blockingLevel: hasClarificationCandidate ? "blocking" : "non_blocking",
          }
        : {}),
    };
  });
  const nextAction = stopRequested
    ? "stop"
    : hasClarificationCandidate
      ? "request_user_clarification"
      : candidateDecisions.some((decision) => decision.status === "accepted" || decision.status === "merged")
        ? "approve_handoff"
        : "stop";
  return {
    candidateDecisions,
    recommendedOptionId: nextAction === "approve_handoff" ? firstOption?.candidateId : undefined,
    nextAction,
    conflictsNeedingUserInput: hasClarificationCandidate ? ["Permission or hard constraint boundary needs user confirmation."] : [],
    constraintViolations: [],
    overallDirectionSummary:
      nextAction === "approve_handoff"
        ? `Fake Convergence Judge approved handoff-ready candidates for ${rawGoal}.`
        : nextAction === "request_user_clarification"
          ? `Fake Convergence Judge requires user clarification before approving ${rawGoal}.`
          : `Fake Convergence Judge stopped convergence for ${rawGoal}.`,
    decisionSummary: `Fake Convergence Judge made ${candidateDecisions.length} candidate decision(s) as the AI mainline.`,
    uncertainty: "This fake judgment is deterministic fixture output, not product-quality semantic reasoning.",
    confidence: nextAction === "approve_handoff" ? 0.76 : 0.42,
  };
}

function fakeHandoffNarrativeOutput(request: ModelRequest): Record<string, unknown> {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const rawGoal = stripTrailingSentencePunctuation(rootletGoalAnchor(request));
  const candidateIds = parseHandoffCandidateIds(content);
  const convergenceOutcome = matchLineValue(content, "Convergence outcome:") ?? "approved";
  const status =
    convergenceOutcome === "approved" && candidateIds.length > 0
      ? "approved"
      : convergenceOutcome === "awaiting_user"
        ? "awaiting_user"
        : "stopped";
  return {
    status,
    clarifiedGoal:
      status === "approved"
        ? `Package ${rawGoal} as an evidence-led direction for Aboveground handoff.`
        : `Do not approve ${rawGoal} until Handoff Steward receives valid narrative material.`,
    optionNarratives:
      status === "approved"
        ? candidateIds.map((candidateId, index) => ({
            candidateId,
            directionSummary:
              `For ${rawGoal}: promote candidate ${candidateId} as handoff-ready direction material with retained evidence, constraints, and parent convergence refs.`,
            whyPreferred:
              index === 0
                ? "It is the retained convergence candidate and has source evidence for handoff."
                : "It supports the retained direction as merged context.",
            whyNot: index === 0 ? [] : ["Do not treat this merged context as a separate primary direction."],
            doNotChooseWhen: ["Do not choose when package validation or hard constraints fail."],
            evidenceRefs: [`handoff-narrative:${candidateId}`],
          }))
        : [],
    nonGoals: ["Do not let Aboveground re-run underground exploration as a parallel direction source."],
    assumptions: ["Convergence Judge already accepted or merged the listed handoff candidates."],
    missingInformation: status === "approved" ? [] : ["Approved handoff narrative is unavailable."],
    risks:
      status === "approved"
        ? ["Aboveground must preserve evidence refs and package validation boundaries."]
        : ["Fallback or awaiting-user handoff material cannot start Aboveground planning."],
    evidenceBoundary:
      "Only model-call refs, convergence review refs, source candidate refs, and package validation output may become handoff evidence.",
    growthEntry: {
      allowedRuntimeShapes: ["single_agent", "sub_agent_tree"],
      suggestedFirstWorkflowNodes: [
        "confirm_direction_handoff",
        "derive_execution_plan",
        "preserve_evidence_refs",
      ],
      escalationRules: [
        "Stop if package validation fails.",
        "Request nutrients instead of inventing a new direction when evidence is insufficient.",
      ],
    },
    decisionSummary:
      status === "approved"
        ? `Fake Handoff Steward organized ${candidateIds.length} candidate narrative(s) for approved package creation.`
        : "Fake Handoff Steward did not approve package creation.",
    uncertainty: "This fake handoff narrative is deterministic fixture output with no private reasoning trace.",
    confidence: status === "approved" ? 0.78 : 0.22,
  };
}

function fakeWorkSessionDecisionOutput(request: ModelRequest): Record<string, unknown> {
  const goalAnchor = stripTrailingSentencePunctuation(rootletGoalAnchor(request));
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
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
        "父层综合已经完成，可以生成可审阅报告。",
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
        "局部材料已经返回，需要先综合冲突和证据。",
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

function fakeWorkSessionDirectAnswerOutput(request: ModelRequest): string {
  const goalAnchor = stripTrailingSentencePunctuation(rootletGoalAnchor(request));
  const normalized = goalAnchor.toLowerCase();
  const asksModelIdentity = includesAny(normalized, [
    "你是什么模型",
    "你是哪个模型",
    "你是谁",
    "what model",
    "which model",
    "who are you",
  ]);
  return asksModelIdentity
    ? "我是 AgentArbor 桌面助手。具体底层模型取决于你在设置中配置的模型运行时；如果当前使用测试模式，我会走本地 fake AI 路径，只用于验证工作流。"
    : `可以。对于“${goalAnchor}”，我会先直接回答；只有当问题需要读取项目、网页、文件或长期执行时，才会进入更完整的工作会话。`;
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

function fakeWorkSessionChildMaterialOutput(request: ModelRequest): Record<string, unknown> {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const role = matchLineValue(content, "Child role:") ?? "child_agent";
  const objective = matchLineValue(content, "Objective:") ?? "review current work session material";
  const goalAnchor = stripTrailingSentencePunctuation(rootletGoalAnchor(request));
  const roleLabel = role.replace(/_/g, " ");
  return {
    summary: `${roleLabel} 认为 AgentArbor 需要围绕 ${goalAnchor} 建立真实工作会话路径。`,
    findings: [
      `当前桌面路径不应继续把固定地下流水线包装成 ${goalAnchor} 的产品主线。`,
      "面板应展示最终报告、证据引用、不确定性和下一步，而不是强制展示内部方案包成功态。",
      "任何局部材料进入最终结果前，都必须先经过父层综合。",
    ],
    evidenceRefs: [
      "code:src/app/panel-server.ts",
      "code:src/app/minimal-loop.ts",
      "docs:ADR-0022",
      `objective:${truncate(objective, 48)}`,
    ],
    uncertainty:
      "这是测试模型的局部材料，必须经过父层综合后才可成为最终报告。",
    confidence: 0.73,
  };
}

function fakeWorkSessionSynthesisOutput(request: ModelRequest): Record<string, unknown> {
  const goalAnchor = stripTrailingSentencePunctuation(rootletGoalAnchor(request));
  return {
    reportTitle: "AgentArbor 项目分析与下一步优化报告",
    keyFindings: [
      "桌面主线必须直接承载真实工作会话，而不是把固定流程包装成产品结果。",
      "当前实现已经具备分工检查和父层综合基础，下一步应让模型按任务决定阅读、分工、综合和产出。",
      "面板应优先展示任务理解、关键发现、证据、不确定性和下一步，而不是强制展示内部方案包成功态。",
    ],
    recommendations: [
      "把默认入口稳定为工作会话，让模型根据任务选择读取、分工、综合、追问或产出。",
      "保持局部材料不直接成为最终结果，必须经过父层综合后再展示给用户。",
      "先用真实模型完成当前仓库分析报告，再继续接执行修改预览和验证。",
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
      "配置真实模型并跑一次当前仓库项目分析。",
      "把工具读取策略从安全引用扩展到更真实的代码搜索和只读文件阅读。",
      "继续压缩右侧诊断噪音，突出结论、证据和待确认事项。",
    ],
    decisionSummary:
      `父层综合已为 ${goalAnchor} 形成可审阅的项目分析报告。`,
    confidence: 0.78,
  };
}

function parseHandoffCandidateIds(content: string): string[] {
  return [...content.matchAll(/candidateId=([^\s\n]+)/g)]
    .map((match) => match[1])
    .filter((candidateId): candidateId is string => candidateId !== undefined && candidateId.length > 0);
}

type FakeConvergenceCandidate = {
  readonly kind: string;
  readonly candidateId: string;
  readonly outputId: string;
};

function parseConvergenceCandidates(content: string): FakeConvergenceCandidate[] {
  const matches = [...content.matchAll(/- \[(option|risk|asset_fit|evidence|constraint|counterfactual)\]\s+candidateId=([^\s]+)\s+outputId=([^\s\n]+)/g)];
  return matches.map((match) => ({
    kind: match[1] ?? "option",
    candidateId: match[2] ?? "candidate-unknown",
    outputId: match[3] ?? "unknown",
  }));
}

function fakeConvergenceStatusForCandidate(input: {
  readonly candidate: FakeConvergenceCandidate;
  readonly firstOptionId?: string;
  readonly stopRequested: boolean;
  readonly clarificationRequested: boolean;
}): "accepted" | "merged" | "rejected" | "unknown" {
  if (input.stopRequested) {
    return "rejected";
  }
  if (input.clarificationRequested && input.candidate.kind === "constraint") {
    return "unknown";
  }
  if (input.candidate.kind === "option") {
    return input.candidate.candidateId === input.firstOptionId ? "accepted" : "merged";
  }
  if (input.candidate.kind === "risk" || input.candidate.kind === "counterfactual") {
    return "rejected";
  }
  return "merged";
}

function fakeConvergenceReasonForStatus(
  candidate: FakeConvergenceCandidate,
  status: "accepted" | "merged" | "rejected" | "unknown",
  rawGoal: string
): string {
  switch (status) {
    case "accepted":
      return `Candidate ${candidate.candidateId} is the retained ${candidate.kind} direction for ${rawGoal}.`;
    case "merged":
      return `Candidate ${candidate.candidateId} supports the retained direction as ${candidate.kind} material.`;
    case "unknown":
      return `Candidate ${candidate.candidateId} exposes a boundary that must be clarified before approval.`;
    case "rejected":
      return `Candidate ${candidate.candidateId} is retained as why-not evidence, not a handoff direction.`;
  }
}

function rootletKindFromContractId(contractId: string): string {
  const marker = "underground.rootlet_candidate_advice.";
  if (!contractId.startsWith(marker)) {
    return "option";
  }
  return contractId.slice(marker.length).split(".")[0] ?? "option";
}

function rootletGoalAnchor(request: ModelRequest): string {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const rawGoal =
    matchLineValue(content, "Raw goal:") ??
    matchLineValue(content, "Raw user question:") ??
    matchLineValue(content, "User message:");
  if (rawGoal !== undefined && rawGoal.length > 0) {
    return truncate(rawGoal, 80);
  }
  const domainConcepts = matchLineValue(content, "- domainConcepts:");
  if (domainConcepts !== undefined && domainConcepts !== "none") {
    return domainConcepts.split(";").map((value) => value.trim()).filter(Boolean).slice(0, 4).join("/");
  }
  return "current goal";
}

function termsFromGoalAnchor(goalAnchor: string): string[] {
  return [...new Set(
    goalAnchor
      .toLowerCase()
      .split(/[\s.;,，；、/：:()]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length > 1)
  )];
}

function stripTrailingSentencePunctuation(value: string): string {
  return value.trim().replace(/[。.!！?？]+$/u, "");
}

function fakeRiskHintsForGoal(goalAnchor: string): string[] {
  const normalized = goalAnchor.toLowerCase();
  const hints: string[] = [];
  if (includesAny(normalized, ["risk", "风险", "safe", "安全", "security", "permission", "权限"])) {
    hints.push("risk");
  }
  return hints;
}

function fakeConstraintHintsForGoal(goalAnchor: string): string[] {
  const normalized = goalAnchor.toLowerCase();
  const hints: string[] = [];
  if (includesAny(normalized, ["constraint", "约束", "must not", "不要", "不接", "不能", "禁止"])) {
    hints.push("goal:constraint");
  }
  return hints;
}

function fakeUnknownsForGoal(goalAnchor: string): string[] {
  const normalized = goalAnchor.toLowerCase();
  if (includesAny(normalized, ["unknown", "unclear", "missing", "未知", "不确定", "待确认", "确认"])) {
    return ["关键权限、事实或约束边界仍需确认。"];
  }
  return [];
}

function fakeNonGoalsForGoal(goalAnchor: string): string[] {
  const segments = goalSegments(goalAnchor);
  const explicit = segments.filter((segment) =>
    includesAny(segment.toLowerCase(), ["must not", "do not", "不要", "不需要", "不新增", "不接", "不能", "禁止"])
  );
  return explicit.length > 0 ? explicit : [];
}

function fakeAssumptionsForGoal(goalAnchor: string): string[] {
  const segments = goalSegments(goalAnchor);
  const explicit = segments.filter((segment) =>
    includesAny(segment.toLowerCase(), ["default", "默认", "assume", "假设"])
  );
  return [
    ...explicit,
    "Fake provider output is deterministic and used only for tests or local demos.",
  ];
}

function goalSegments(goalAnchor: string): string[] {
  return goalAnchor
    .split(/[。.!！?？;；,，]/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function isLightweightQuestion(goalAnchor: string): boolean {
  const normalized = goalAnchor.toLowerCase().trim();
  if (["hi", "hello", "你好"].includes(normalized)) {
    return true;
  }
  if (includesAny(normalized, [
    "你是什么模型",
    "你是哪个模型",
    "你是谁",
    "what model",
    "which model",
    "who are you",
  ])) {
    return true;
  }
  if (normalized.length <= 48 && /[?？]$/u.test(normalized)) {
    return !includesAny(normalized, ["分析", "调研", "生成报告", "项目", "仓库", "代码", "优化方向", "方案"]);
  }
  return false;
}

function includesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle.toLowerCase()));
}

function parseAvailableRootletKinds(content: string): string[] {
  const line = matchLineValue(content, "Available rootlet kinds:");
  if (line === undefined) {
    return [];
  }
  const validKinds = new Set(["option", "risk", "asset_fit", "evidence", "constraint", "counterfactual"]);
  return [...new Set(
    line
      .split(/[,，;；\s]+/u)
      .map((kind) => kind.trim())
      .filter((kind) => validKinds.has(kind))
  )];
}

function fakeMaxOutputsForKind(kind: string): number {
  switch (kind) {
    case "asset_fit":
    case "counterfactual":
      return 2;
    case "option":
    case "risk":
    case "evidence":
    case "constraint":
    default:
      return 3;
  }
}

function matchLineValue(content: string, prefix: string): string | undefined {
  const line = content.split("\n").find((candidate) => candidate.trim().startsWith(prefix));
  return line?.slice(line.indexOf(prefix) + prefix.length).trim();
}

function fakeCandidateForKind(kind: string, index: number, goalAnchor: string): Record<string, unknown> {
  const goalTerms = goalAnchor
    .split(/[\s.;,，；、/]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
  const decomposedGoalTerms = [...goalTerms, ...[...goalTerms].reverse()].join(" ");
  const summary = `Fake ${kind} candidate advice ${index} with goal-specific ${decomposedGoalTerms || "current goal"} material.`;
  switch (kind) {
    case "risk":
      return {
        summary,
        impactScope: `${goalAnchor} runtime boundary and user trust`,
        severity: index === 1 ? "medium" : "low",
        mitigation: "Keep Convergence Judge and package validation in charge.",
      };
    case "asset_fit":
      return {
        summary,
        assetRefs: ["soil:minimal-constraints"],
        fitConditions: [`Only use refs that match ${goalAnchor}.`],
        doNotApplyWhen: ["The asset would copy Soil body content into the prompt."],
      };
    case "evidence":
      return {
        summary,
        evidenceType: `${goalAnchor} verification`,
        confidence: index === 1 ? "medium" : "low",
      };
    case "constraint":
      return {
        summary,
        constraintLevel: "hard",
        enforcementGate: "direction_handoff",
      };
    case "counterfactual":
      return {
        summary,
        alternativeDirection: `Defer ${goalAnchor} execution until evidence and constraints are clearer.`,
        whyNotChosen: "It does not satisfy the current underground direction boundary.",
      };
    case "option":
    default:
      return {
        summary,
        tradeoffs: ["more candidate diversity", `goal-specific ${goalAnchor}`, "requires convergence validation"],
        applicability: `Use when the ${goalAnchor} goal profile needs another direction candidate.`,
      };
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
