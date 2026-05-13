import type {
  ConfiguredModelProtocolKind,
  ConfiguredModelProviderKind,
  CreateModelProviderProfileInput,
  McpServerTransportKind,
  ToolStateSettings,
  UpdateInformationAccessConfigInput,
  UpdateModelProviderConfigInput,
  UpdateWebSearchConfigInput,
  UpdateWorkspaceConfigInput,
  UpsertMcpServerInput,
} from "../../domain/config/index.js";
import type { ConfirmationDecision } from "../../domain/basic-agent/index.js";
import { TaskSoilInputValidationError, parseDesktopTaskSoilInput, type DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { PanelDesktopRunMode, PanelRunKind } from "../panel-run-jobs.js";
import { sanitizeAssistantVisibleText } from "../visible-text-safety.js";
import { redactSensitiveText } from "../../kernel/redaction.js";
import { PanelHttpError } from "./http-utils.js";

export type PanelRunInput = {
  readonly goal: string;
  readonly aiMode: ModelRuntimeMode;
  readonly runMode: PanelDesktopRunMode;
  readonly taskSoilInput?: DesktopTaskSoilInput;
};

// Keep request parsing stateless. Route modules decide what to do with validated inputs.
export function parseConfigUpdate(raw: unknown): UpdateModelProviderConfigInput {
  const record = asRecord(raw);
  return {
    profileId: optionalString(record.profileId),
    label: optionalString(record.label),
    providerKind: parseOptionalModelProviderKind(record.providerKind),
    protocolKind: parseOptionalModelProtocolKind(record.protocolKind),
    baseUrl: optionalString(record.baseUrl),
    model: optionalString(record.model),
    defaultAiMode: parseOptionalAiMode(record.defaultAiMode, "默认 AI 模式无效。"),
    enabled: booleanOrUndefined(record.enabled),
    apiKey: optionalString(record.apiKey),
  };
}

export function parseCreateModelProfile(raw: unknown): CreateModelProviderProfileInput {
  const parsed = parseConfigUpdate(raw);
  const profileId = optionalString(asRecord(raw).profileId);
  if (profileId === undefined) {
    throw new PanelHttpError(400, "missing_model_profile_id", "模型 profile id 不能为空。");
  }
  return {
    ...parsed,
    profileId,
  };
}

export function parseToolStateUpdate(toolName: string, raw: unknown): ToolStateSettings {
  const record = asRecord(raw);
  const enabled = booleanOrUndefined(record.enabled);
  if (enabled === undefined) {
    throw new PanelHttpError(400, "invalid_tool_state", "工具状态必须包含 enabled 布尔值。");
  }
  return {
    name: toolName,
    enabled,
    updatedAt: new Date().toISOString(),
  };
}

export function parseMcpServerUpdate(raw: unknown): UpsertMcpServerInput {
  const record = asRecord(raw);
  const serverId = optionalString(record.serverId);
  if (serverId === undefined) {
    throw new PanelHttpError(400, "missing_mcp_server_id", "MCP server id 不能为空。");
  }
  return {
    serverId,
    label: optionalString(record.label),
    transport: parseOptionalMcpTransport(record.transport),
    command: optionalString(record.command),
    args: stringArrayOrUndefined(record.args),
    url: optionalString(record.url),
    envSecretRefs: stringArrayOrUndefined(record.envSecretRefs),
    enabled: booleanOrUndefined(record.enabled),
  };
}

export function parseWorkspaceUpdate(raw: unknown): UpdateWorkspaceConfigInput {
  const record = asRecord(raw);
  const workspaceDirectory = optionalString(record.workspaceDirectory);
  if (workspaceDirectory === undefined) {
    throw new PanelHttpError(400, "missing_workspace_directory", "工作目录不能为空。");
  }
  return { workspaceDirectory };
}

export function parseInformationAccessUpdate(raw: unknown): UpdateInformationAccessConfigInput {
  const record = asRecord(raw);
  return {
    tavilyApiKey: optionalString(record.tavilyApiKey),
    tavilyMaxResults: numberOrUndefined(record.tavilyMaxResults),
    sourcePreference: informationSourcePreferenceOrUndefined(record.sourcePreference),
  };
}

export function parseWebSearchUpdate(raw: unknown): UpdateWebSearchConfigInput {
  const record = asRecord(raw);
  return {
    provider: parseOptionalWebSearchProvider(record.provider),
    apiKey: optionalString(record.apiKey),
    tavilyApiKey: optionalString(record.tavilyApiKey),
    maxResults: numberOrUndefined(record.maxResults),
    tavilyMaxResults: numberOrUndefined(record.tavilyMaxResults),
  };
}

export function parseRunInput(raw: unknown, defaultAiMode: ModelRuntimeMode): PanelRunInput {
  const record = asRecord(raw);
  const goal = optionalString(record.goal);
  if (goal === undefined) {
    throw new PanelHttpError(400, "missing_goal", "运行需要填写目标。");
  }
  let taskSoilInput: DesktopTaskSoilInput;
  try {
    taskSoilInput = parseDesktopTaskSoilInput(raw);
  } catch (error) {
    if (error instanceof TaskSoilInputValidationError) {
      throw new PanelHttpError(400, error.code, error.message);
    }
    throw error;
  }
  return {
    goal,
    aiMode: parseOptionalAiMode(record.aiMode, "AI 模式无效。") ?? defaultAiMode,
    runMode: parseOptionalDesktopRunMode(record.runMode) ?? "agent",
    taskSoilInput,
  };
}

export function defaultAiModeForRunKind(runKind: PanelRunKind, configuredDefault: ModelRuntimeMode): ModelRuntimeMode {
  return runKind === "desktop" ? "openai-compatible" : configuredDefault;
}

export function parseConfirmationDecision(raw: unknown): Pick<ConfirmationDecision, "decision" | "guidance"> {
  const record = asRecord(raw);
  const decision = optionalString(record.decision);
  if (decision !== "approve_once" && decision !== "deny" && decision !== "guidance") {
    throw new PanelHttpError(400, "invalid_confirmation_decision", "确认决定必须是 approve_once、deny 或 guidance。");
  }
  const guidance = optionalString(record.guidance);
  if (decision === "guidance" && guidance === undefined) {
    throw new PanelHttpError(400, "missing_confirmation_guidance", "补充指导不能为空。");
  }
  return {
    decision,
    guidance: guidance === undefined ? undefined : compactDecisionGuidance(guidance),
  };
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new PanelHttpError(499, "run_cancelled", "运行已取消。");
  }
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function parseOptionalModelProviderKind(value: unknown): ConfiguredModelProviderKind | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "openai_compatible" || value === "anthropic" || value === "gemini" || value === "ollama" || value === "local") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_model_provider_kind", "模型厂商类型无效。");
}

function parseOptionalModelProtocolKind(value: unknown): ConfiguredModelProtocolKind | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (
    value === "openai_responses" ||
    value === "openai_compatible_chat_completions" ||
    value === "anthropic_messages" ||
    value === "gemini_generate_content" ||
    value === "ollama_generate"
  ) {
    return value;
  }
  throw new PanelHttpError(400, "invalid_model_protocol_kind", "模型协议类型无效。");
}

function parseOptionalMcpTransport(value: unknown): McpServerTransportKind | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "stdio" || value === "http") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_mcp_transport", "MCP transport 必须是 stdio 或 http。");
}

function parseOptionalWebSearchProvider(value: unknown): UpdateWebSearchConfigInput["provider"] {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "tavily" || value === "none") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_web_search_provider", "搜索工具 provider 无效。");
}

function parseOptionalDesktopRunMode(value: unknown): PanelDesktopRunMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "agent" || value === "deep") {
    return value;
  }
  if (value === "work_session") {
    return "deep";
  }
  throw new PanelHttpError(400, "invalid_run_mode", "运行模式无效。");
}

function parseOptionalAiMode(value: unknown, invalidMessage: string): ModelRuntimeMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = parseAiMode(value);
  if (parsed === undefined) {
    throw new PanelHttpError(400, "invalid_ai_mode", invalidMessage);
  }
  return parsed;
}

function parseAiMode(value: unknown): ModelRuntimeMode | undefined {
  if (value === "none" || value === "fake" || value === "openai-compatible" || value === "openai-responses") {
    return value;
  }
  return undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayOrUndefined(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .map((item) => optionalString(item))
    .filter((item): item is string => item !== undefined);
  return items.length === 0 ? undefined : items;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function informationSourcePreferenceOrUndefined(
  value: unknown
): UpdateInformationAccessConfigInput["sourcePreference"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const sources = value.filter(isInformationSourceKind);
  return sources.length === 0 ? undefined : [...new Set(sources)];
}

function isInformationSourceKind(
  value: unknown
): value is NonNullable<UpdateInformationAccessConfigInput["sourcePreference"]>[number] {
  return (
    value === "web" ||
    value === "page" ||
    value === "codebase" ||
    value === "soil" ||
    value === "run_memory" ||
    value === "docs" ||
    value === "packages" ||
    value === "github"
  );
}

function compactDecisionGuidance(value: string): string {
  const maxLength = 800;
  const normalized = redactSensitiveText(sanitizeAssistantVisibleText(value))
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}
