import { z } from "zod";
import type { ModelRuntimeMode } from "../app/model-runtime/index.js";
import { PanelHttpError } from "../app/panel-server/http-utils.js";
import {
  parseCanonicalTaskSoilInput,
  parseOptionalAiMode,
  parseOptionalCanonicalTaskSoilInput,
} from "../app/panel-server/request-parsers.js";
import type { DesktopTaskSoilInput } from "../app/task-soil/task-soil-workspace.js";

export type DeepIntakeRequestInput = {
  readonly message: string;
  readonly aiMode?: ModelRuntimeMode;
  readonly conversationId?: string;
  readonly activeRunId?: string;
  readonly workspaceDirectory?: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
};

export type DeepConversationCreateRequestInput = {
  readonly goal: string;
  readonly aiMode?: ModelRuntimeMode;
  readonly title?: string;
  readonly workspaceDirectory?: string;
  readonly taskSoilInput: DesktopTaskSoilInput;
};

export type DeepRunStartRequestInput = {
  readonly aiMode?: ModelRuntimeMode;
  readonly intakeTurnId?: string;
  readonly confirmedObjective?: string;
  readonly confirmedPlan?: string;
  readonly parentRunId?: string;
  readonly workspaceDirectory?: string;
};

export type DeepRunFollowUpRequestInput = {
  readonly message: string;
  readonly aiMode?: ModelRuntimeMode;
  readonly workspaceDirectory?: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
};

export type DeepRunControlRequestInput = {
  readonly reason?: string;
  readonly correctionContext?: readonly string[];
};

const normalizeRequestObject = (value: unknown): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
const optionalTrimmedStringSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined,
  z.string().optional(),
);
const deepIntakeRequestSchema = z.preprocess(normalizeRequestObject, z.object({
  message: optionalTrimmedStringSchema,
  aiMode: z.unknown().optional(),
  conversationId: optionalTrimmedStringSchema,
  activeRunId: optionalTrimmedStringSchema,
  workspaceDirectory: optionalTrimmedStringSchema,
  taskSoilInput: z.unknown().optional(),
}));
const deepConversationCreateRequestSchema = z.preprocess(normalizeRequestObject, z.object({
  goal: optionalTrimmedStringSchema,
  aiMode: z.unknown().optional(),
  title: optionalTrimmedStringSchema,
  workspaceDirectory: optionalTrimmedStringSchema,
  taskSoilInput: z.unknown().optional(),
}));
const deepRunStartRequestSchema = z.preprocess(normalizeRequestObject, z.object({
  aiMode: z.unknown().optional(),
  intakeTurnId: optionalTrimmedStringSchema,
  confirmedObjective: optionalTrimmedStringSchema,
  confirmedPlan: optionalTrimmedStringSchema,
  parentRunId: optionalTrimmedStringSchema,
  workspaceDirectory: optionalTrimmedStringSchema,
}));
const deepRunFollowUpRequestSchema = z.preprocess(normalizeRequestObject, z.object({
  message: optionalTrimmedStringSchema,
  aiMode: z.unknown().optional(),
  workspaceDirectory: optionalTrimmedStringSchema,
  taskSoilInput: z.unknown().optional(),
}));
const deepRunControlRequestSchema = z.preprocess(normalizeRequestObject, z.object({
  reason: optionalTrimmedStringSchema,
  correctionContext: z.unknown().optional(),
}));
const deepChildMessageRequestSchema = z.preprocess(
  normalizeRequestObject,
  z.object({ message: optionalTrimmedStringSchema }),
);

export function parseDeepIntakeRequest(raw: unknown): DeepIntakeRequestInput {
  const request = deepIntakeRequestSchema.parse(raw);
  if (request.message === undefined) {
    throw new PanelHttpError(400, "empty_intake_message", "多 Agent 需要非空输入。");
  }
  return {
    ...request,
    message: request.message,
    aiMode: parseOptionalAiMode(request.aiMode, "AI 模式无效。"),
    taskSoilInput: parseOptionalCanonicalTaskSoilInput(request.taskSoilInput),
  };
}

export function parseDeepConversationCreateRequest(raw: unknown): DeepConversationCreateRequestInput {
  const request = deepConversationCreateRequestSchema.parse(raw);
  if (request.goal === undefined) {
    throw new PanelHttpError(400, "empty_goal", "多 Agent 需要非空目标。");
  }
  return {
    ...request,
    goal: request.goal,
    aiMode: parseOptionalAiMode(request.aiMode, "AI 模式无效。"),
    taskSoilInput: parseCanonicalTaskSoilInput(request.taskSoilInput),
  };
}

export function parseDeepRunStartRequest(raw: unknown): DeepRunStartRequestInput {
  const request = deepRunStartRequestSchema.parse(raw);
  return {
    ...request,
    aiMode: parseOptionalAiMode(request.aiMode, "AI 模式无效。"),
  };
}

export function parseDeepRunFollowUpRequest(raw: unknown): DeepRunFollowUpRequestInput {
  const request = deepRunFollowUpRequestSchema.parse(raw);
  if (request.message === undefined) {
    throw new PanelHttpError(400, "empty_follow_up_message", "继续多 Agent 任务需要非空补充。");
  }
  return {
    ...request,
    message: request.message,
    aiMode: parseOptionalAiMode(request.aiMode, "AI 模式无效。"),
    taskSoilInput: parseOptionalCanonicalTaskSoilInput(request.taskSoilInput),
  };
}

export function parseDeepRunControlRequest(
  raw: unknown,
  action: "interrupt" | "correct" | "stop",
): DeepRunControlRequestInput {
  const request = deepRunControlRequestSchema.parse(raw);
  if (action !== "correct") {
    return { reason: request.reason };
  }
  if (request.correctionContext === undefined || request.correctionContext === null) {
    throw new PanelHttpError(400, "empty_correction_context", "补充上下文不能为空。");
  }
  const parsed = z.array(z.string()).safeParse(request.correctionContext);
  if (!parsed.success) {
    throw new PanelHttpError(400, "invalid_correction_context", "correct 需要补充上下文数组。");
  }
  const correctionContext = parsed.data.filter((item) => item.length > 0);
  if (correctionContext.length === 0) {
    throw new PanelHttpError(400, "empty_correction_context", "补充上下文不能为空。");
  }
  return { reason: request.reason, correctionContext };
}

export function parseDeepChildMessageRequest(raw: unknown): string {
  const request = deepChildMessageRequestSchema.parse(raw);
  if (request.message === undefined) {
    throw new PanelHttpError(400, "empty_child_instruction", "子 Agent 补充要求不能为空。");
  }
  return request.message;
}

export function parseDeepRunListLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim().length === 0) {
    return 50;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new PanelHttpError(400, "invalid_deep_run_limit", "多 Agent 运行列表 limit 必须为正整数。");
  }
  return Math.min(value, 200);
}
