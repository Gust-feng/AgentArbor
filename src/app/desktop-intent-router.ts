import type {
  IntelligenceChannel,
  ModelOutputContract,
  ModelResponse,
} from "../domain/intelligence/index.js";
import type { ObservationRef } from "../domain/observation/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import { createId, nowIso } from "../kernel/id.js";

// Legacy compatibility helper. Desktop Shell no longer routes every message
// through this gate; the product default is ordinary Agent chat, with Work
// Session entered only by explicit user mode selection.
export type DesktopIntentRoute = "chat_direct" | "chat_plus_tools" | "task_work_session";

export type DesktopIntentDecision = {
  readonly route: DesktopIntentRoute;
  readonly reason: string;
  readonly confidence: number;
  readonly source: "ai";
  readonly modelCallRefs: readonly string[];
};

export type DesktopIntentRouteExplanation = {
  readonly title: string;
  readonly summary: string;
};

export class DesktopIntentGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopIntentGateError";
  }
}

export async function decideDesktopIntentWithModel(input: {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly traceId: string;
  readonly goalId: string;
  readonly intelligenceChannel: IntelligenceChannel;
}): Promise<DesktopIntentDecision> {
  const response = await input.intelligenceChannel.request({
    requestId: createId("model-request"),
    traceId: input.traceId,
    callerRef: { kind: "goal", id: input.goalId, label: "desktop_intent_gate" },
    purpose: "desktop_intent_gate",
    inputRefs: desktopIntentInputRefs(input.traceId, input.goalId),
    sanitizedMessages: desktopIntentMessages(input),
    tools: [],
    toolChoice: "none",
    outputContract: desktopIntentOutputContract(),
    constraintRefs: [],
    budget: {
      maxOutputTokens: 500,
      maxLatencyMs: 15_000,
    },
    sensitivity: "internal",
    requestedAt: nowIso(),
  });

  if (response.status !== "completed") {
    throw new DesktopIntentGateError(response.failure?.message ?? "Desktop intent gate model call failed.");
  }

  return parseDesktopIntentDecision(response);
}

export function explainDesktopIntentDecision(decision: DesktopIntentDecision): DesktopIntentRouteExplanation {
  if (decision.route === "task_work_session") {
    return {
      title: "正在展开任务",
      summary: "我判断这需要读取上下文、拆分检查或形成可审阅结果，会把它展开成任务处理。",
    };
  }
  if (decision.route === "chat_plus_tools") {
    return {
      title: "正在查证后回复",
      summary: "我判断这需要少量授权材料或工具辅助，会先查证再回答。",
    };
  }
  return {
    title: "正在准备回复",
    summary: "我判断这适合直接回答，不启动报告或复杂任务流程。",
  };
}

export function desktopIntentOutputContract(): ModelOutputContract {
  return {
    contractId: "desktop.intent_gate.v1",
    outputKind: "draft",
    format: "json_object",
    requiredFields: ["route", "reason", "confidence"],
    requiredStringFields: ["route", "reason"],
    visibleOutput: {
      fields: ["route", "reason", "confidence"],
      fieldTypes: {
        route: "string",
        reason: "string",
      },
      maxFieldLength: 220,
    },
  };
}

function desktopIntentMessages(input: {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
}): readonly { readonly role: "system" | "user"; readonly content: string; readonly ref?: string }[] {
  return [
    {
      role: "system",
      content: [
        "You are AgentArbor's desktop intent gate.",
        "Decide the next runtime mode for this user message. This decision must be semantic, not keyword based.",
        "Choose chat_direct when the assistant can answer as normal conversation.",
        "Choose chat_plus_tools when the answer should stay conversational but needs a small amount of authorized context, search, or read tools.",
        "Choose task_work_session when the user needs multi-step work, child agents, project/file analysis, implementation, a report, an artifact, or long-running execution.",
        "Examples:",
        "- User asks '你是什么模型？' or '你好，你能做什么？' -> chat_direct.",
        "- User asks for a short explanation, translation, advice, or follow-up question -> chat_direct unless authorized external context is necessary.",
        "- User asks to read a specific webpage or file and answer conversationally -> chat_plus_tools.",
        "- User asks to analyze a repository, inspect project files, produce an optimization report, implement changes, or create a reviewable artifact -> task_work_session.",
        "If uncertain between a direct answer and a work session, prefer the smallest useful mode and mention that the user can ask to expand into a task.",
        "Return JSON only with route, reason, and confidence. Do not include hidden reasoning, chain-of-thought, raw prompts, provider details, or internal architecture terms.",
      ].join("\n"),
      ref: "prompt:desktop.intent_gate.v1",
    },
    {
      role: "user",
      content: [
        `User message: ${safeText(input.goal, 1200)}`,
        "Available context refs:",
        ...(input.taskSoil.contextRefs.length === 0
          ? ["- none"]
          : input.taskSoil.contextRefs.map((ref) => contextRefLine(ref))),
        `Permission boundary refs: ${input.taskSoil.permissionBoundaryRefs.join("; ") || "none"}`,
      ].join("\n"),
      ref: `goal:${input.taskSoil.goalId}`,
    },
  ];
}

function parseDesktopIntentDecision(response: ModelResponse): DesktopIntentDecision {
  const record = asRecord(response.structuredOutput);
  const route = parseRoute(record.route);
  if (route === undefined) {
    throw new DesktopIntentGateError("Desktop intent gate returned an invalid route.");
  }
  const reason = stringOrUndefined(record.reason);
  if (reason === undefined) {
    throw new DesktopIntentGateError("Desktop intent gate returned no reason.");
  }
  return {
    route,
    reason: safeText(reason, 600),
    confidence: clampConfidence(numberOr(record.confidence, 0.2)),
    source: "ai",
    modelCallRefs: [response.requestId, response.responseId].filter((value): value is string => typeof value === "string"),
  };
}

function parseRoute(value: unknown): DesktopIntentRoute | undefined {
  if (value === "chat_direct" || value === "chat_plus_tools" || value === "task_work_session") {
    return value;
  }
  return undefined;
}

function desktopIntentInputRefs(traceId: string, goalId: string): readonly ObservationRef[] {
  return [
    { kind: "trace", id: traceId },
    { kind: "goal", id: goalId },
  ];
}

function contextRefLine(ref: TaskSoil["contextRefs"][number]): string {
  const preview = ref.readonlyPreview;
  const previewText =
    preview === undefined
      ? ""
      : ` preview=${safeText([preview.title, preview.text].filter(Boolean).join("："), 700)}`;
  return `- ${ref.kind}:${ref.ref} summary=${safeText(ref.summary ?? "none", 240)}${previewText}`;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function safeText(value: string, maxLength: number): string {
  const normalized = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:api[_ -]?key|apikey|token|password)\s*[:=]\s*[^;\s"'}\]]+/gi, "$1=[redacted]")
    .trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}
