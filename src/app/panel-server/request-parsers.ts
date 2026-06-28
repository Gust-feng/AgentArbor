import type {
  ConfiguredModelProtocolKind,
  ConfiguredModelProviderKind,
  CreateModelProviderProfileInput,
  McpConfirmationMode,
  McpServerTransportKind,
  ModelCapabilities,
  ModelRunReasoningEffort,
  ModelProviderModelCatalogItem,
  OpenAIModelRequestSettings,
  ToolStateSettings,
  UpdateInformationAccessConfigInput,
  UpdateCommandShellConfigInput,
  UpdateModelProviderConfigInput,
  UpdateToolConfirmationConfigInput,
  UpdateWebSearchConfigInput,
  UpdateWorkspaceConfigInput,
  UpsertMcpServerInput,
} from "../../domain/config/index.js";
import { normalizeModelCatalogDisplayName } from "../../domain/config/index.js";
import type { ConfirmationDecision } from "../../domain/basic-agent/index.js";
import type { ToolConfirmationPolicy } from "../../domain/tools/index.js";
import { TaskSoilInputValidationError, parseDesktopTaskSoilInput, type DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { PanelRunMode } from "../panel-run-jobs.js";
import { sanitizeAssistantVisibleText } from "../visible-text-safety.js";
import { redactSensitiveText } from "../../kernel/redaction.js";
import { PanelHttpError } from "./http-utils.js";

export type PanelRunInput = {
  readonly goal: string;
  readonly aiMode?: ModelRuntimeMode;
  readonly requestedRunMode?: PanelRunMode;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
  readonly modelOverride?: {
    readonly profileId: string;
    readonly model: string;
  };
  readonly workspaceDirectory?: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
};

export type ConversationRenameInput = {
  readonly title: string;
};

export type ConversationPinInput = {
  readonly pinned: boolean;
};

export type ModelCatalogUpdateInput = {
  readonly label?: string;
  readonly baseUrl?: string;
  readonly modelsPath?: string;
  readonly fetchedAt?: string;
  readonly models: readonly ModelProviderModelCatalogItem[];
};

export type ModelProviderOrderUpdateInput = {
  readonly order: readonly string[];
};

export type ModelCapabilityUpdateInput = {
  readonly profileId?: string;
  readonly model?: string;
  readonly providerKind?: ConfiguredModelProviderKind;
  readonly capabilities: Partial<ModelCapabilities>;
};

// Keep request parsing stateless. Route modules decide what to do with validated inputs.
export function parseConfigUpdate(raw: unknown): UpdateModelProviderConfigInput {
  const record = asRecord(raw);
  const update: UpdateModelProviderConfigInput = {
    profileId: optionalString(record.profileId),
    label: optionalString(record.label),
    logoDataUrl: optionalString(record.logoDataUrl),
    clearLogoDataUrl: booleanOrUndefined(record.clearLogoDataUrl),
    providerKind: parseOptionalModelProviderKind(record.providerKind),
    protocolKind: parseOptionalModelProtocolKind(record.protocolKind),
    baseUrl: optionalString(record.baseUrl),
    model: optionalString(record.model),
    clearModel: booleanOrUndefined(record.clearModel),
    defaultAiMode: parseOptionalAiMode(record.defaultAiMode, "默认 AI 模式无效。"),
    enabled: booleanOrUndefined(record.enabled),
    apiKey: optionalString(record.apiKey),
    clearApiKey: booleanOrUndefined(record.clearApiKey),
  };
  return "openAI" in record
    ? {
        ...update,
        openAI: parseOpenAIModelRequestSettings(record.openAI),
      }
    : update;
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

export function parseModelProviderOrderUpdate(raw: unknown): ModelProviderOrderUpdateInput {
  const record = asRecord(raw);
  if (!Array.isArray(record.order)) {
    throw new PanelHttpError(400, "invalid_model_provider_order", "模型服务顺序必须是数组。");
  }
  const order = record.order
    .map((value) => optionalString(value))
    .filter((value): value is string => value !== undefined);
  return { order };
}

export function parseModelCatalogUpdate(raw: unknown): ModelCatalogUpdateInput {
  const record = asRecord(raw);
  const modelsRaw = record.models;
  if (!Array.isArray(modelsRaw)) {
    throw new PanelHttpError(400, "invalid_model_catalog", "模型列表必须是数组。");
  }
  const models = modelsRaw
    .map((item): ModelProviderModelCatalogItem | undefined => {
      const model = asRecord(item);
      const id = optionalString(model.id);
      if (id === undefined) {
        return undefined;
      }
      return {
        id,
        displayName: normalizeModelCatalogDisplayName(optionalString(model.displayName), id),
        owner: optionalString(model.owner),
        createdAt: optionalString(model.createdAt),
      };
    })
    .filter((item): item is ModelProviderModelCatalogItem => item !== undefined);
  return {
    label: optionalString(record.label),
    baseUrl: optionalString(record.baseUrl),
    modelsPath: optionalString(record.modelsPath),
    fetchedAt: optionalString(record.fetchedAt),
    models,
  };
}

export function parseModelCapabilityUpdate(raw: unknown): ModelCapabilityUpdateInput {
  const record = asRecord(raw);
  const capabilities = asRecord(record.capabilities ?? raw);
  return {
    profileId: optionalString(record.profileId),
    model: optionalString(record.model),
    providerKind: parseOptionalModelProviderKind(record.providerKind),
    capabilities: {
      contextWindowTokens: positiveIntegerOrUndefined(capabilities.contextWindowTokens, "上下文窗口 token 必须是正整数。"),
      maxOutputTokens: positiveIntegerOrUndefined(capabilities.maxOutputTokens, "最大输出 token 必须是正整数。"),
      supportsToolCalling: booleanOrUndefined(capabilities.supportsToolCalling),
      supportsParallelToolCalls: booleanOrUndefined(capabilities.supportsParallelToolCalls),
      supportsStructuredOutputs: booleanOrUndefined(capabilities.supportsStructuredOutputs),
      supportsStreaming: booleanOrUndefined(capabilities.supportsStreaming),
      supportsVisionInput: booleanOrUndefined(capabilities.supportsVisionInput),
      supportsReasoningEffort: booleanOrUndefined(capabilities.supportsReasoningEffort),
      supportsReasoningOutput: booleanOrUndefined(capabilities.supportsReasoningOutput),
      preferredApiStyle: parseOptionalPreferredApiStyle(capabilities.preferredApiStyle),
      stability: parseOptionalModelStability(capabilities.stability),
      lastVerifiedAt: optionalString(capabilities.lastVerifiedAt),
    },
  };
}

function positiveIntegerOrUndefined(value: unknown, message: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new PanelHttpError(400, "invalid_model_capability", message);
  }
  return Math.floor(value);
}

function parseOptionalPreferredApiStyle(value: unknown): ModelCapabilities["preferredApiStyle"] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (
    value === "chat_completions" ||
    value === "responses" ||
    value === "messages" ||
    value === "gemini_generate_content" ||
    value === "openai_compatible"
  ) {
    return value;
  }
  throw new PanelHttpError(400, "invalid_model_capability", "模型 API 风格无效。");
}

function parseOptionalModelStability(value: unknown): ModelCapabilities["stability"] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "stable" || value === "preview" || value === "deprecated" || value === "unknown") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_model_capability", "模型稳定性无效。");
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

export function parseToolConfirmationUpdate(raw: unknown): UpdateToolConfirmationConfigInput {
  const record = asRecord(raw);
  const policy = parseToolConfirmationPolicy(record.policy);
  if (policy === undefined) {
    throw new PanelHttpError(400, "invalid_tool_confirmation_policy", "工具确认策略无效。");
  }
  return { policy };
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
    description: typeof record.description === "string" ? record.description : undefined,
    transport: parseOptionalMcpTransport(record.transport),
    commandLine: optionalString(record.commandLine),
    command: optionalString(record.command),
    args: stringArrayOrUndefined(record.args),
    url: optionalString(record.url),
    envSecretRefs: stringArrayOrUndefined(record.envSecretRefs),
    headerSecretRefs: stringArrayOrUndefined(record.headerSecretRefs),
    bearerTokenSecretRef: optionalString(record.bearerTokenSecretRef),
    apiKeySecretRef: optionalString(record.apiKeySecretRef),
    apiKeyHeaderName: optionalString(record.apiKeyHeaderName),
    clearMcpAuth: booleanOrUndefined(record.clearMcpAuth),
    confirmationMode: parseOptionalMcpConfirmationMode(record.confirmationMode),
    toolExposureMode: parseOptionalMcpToolExposureMode(record.toolExposureMode),
    enabledTools: stringArrayOrUndefined(record.enabledTools),
    autoApprovedTools: stringArrayOrUndefined(record.autoApprovedTools),
    enabled: booleanOrUndefined(record.enabled),
  };
}

export function parseMcpServerSecretValue(raw: unknown): {
  readonly secretRef: string;
  readonly value: string;
} {
  const record = asRecord(raw);
  const secretRef = optionalString(record.secretRef);
  const value = optionalString(record.value);
  if (secretRef === undefined) {
    throw new PanelHttpError(400, "missing_mcp_secret_ref", "MCP secret ref 不能为空。");
  }
  if (value === undefined) {
    throw new PanelHttpError(400, "missing_mcp_secret_value", "MCP secret value 不能为空。");
  }
  return { secretRef, value };
}

export function parseMcpServerImport(raw: unknown): readonly UpsertMcpServerInput[] {
  const record = asRecord(raw);
  const source = typeof record.config === "string" ? parseJsonObject(record.config) : record.config ?? raw;
  const sourceRecord = asRecord(source);
  const serversRaw = sourceRecord.mcpServers ?? asRecord(sourceRecord.mcp).servers ?? sourceRecord.servers;
  if (serversRaw === undefined) {
    throw new PanelHttpError(400, "missing_mcp_import_servers", "导入内容未找到 mcpServers。");
  }
  const entries = Array.isArray(serversRaw)
    ? serversRaw.map((server, index) => [optionalString(asRecord(server).name) ?? optionalString(asRecord(server).serverId) ?? `mcp-${index + 1}`, server] as const)
    : Object.entries(asRecord(serversRaw));
  const imported = entries
    .map(([serverId, value]) => importedMcpServer(serverId, value))
    .filter((server): server is UpsertMcpServerInput => server !== undefined);
  if (imported.length === 0) {
    throw new PanelHttpError(400, "empty_mcp_import", "没有可导入的 MCP server。");
  }
  return imported;
}

export function parseWorkspaceUpdate(raw: unknown): UpdateWorkspaceConfigInput {
  const record = asRecord(raw);
  return {
    workspaceDirectory: typeof record.workspaceDirectory === "string" ? record.workspaceDirectory : undefined,
  };
}

export function parseCommandShellUpdate(raw: unknown): UpdateCommandShellConfigInput {
  const record = asRecord(raw);
  const kind = optionalString(record.kind);
  if (kind === undefined) {
    throw new PanelHttpError(400, "missing_command_shell_kind", "命令 shell 不能为空。");
  }
  if (
    kind !== "auto" &&
    kind !== "cmd" &&
    kind !== "powershell" &&
    kind !== "pwsh" &&
    kind !== "bash" &&
    kind !== "sh"
  ) {
    throw new PanelHttpError(400, "invalid_command_shell_kind", "命令 shell 无效。");
  }
  return {
    kind,
    executable: optionalString(record.executable),
  };
}

export function parseInformationAccessUpdate(raw: unknown): UpdateInformationAccessConfigInput {
  const record = asRecord(raw);
  return {
    provider: parseOptionalWebSearchProvider(record.provider),
    apiKey: optionalString(record.apiKey),
    maxResults: numberOrUndefined(record.maxResults),
    engineId: optionalString(record.engineId),
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
    engineId: optionalString(record.engineId),
    googleEngineId: optionalString(record.googleEngineId),
  };
}

export function parseRunInput(raw: unknown): PanelRunInput {
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
    aiMode: parseOptionalAiMode(record.aiMode, "AI 模式无效。"),
    requestedRunMode: parseOptionalRunMode(record.runMode),
    reasoningEffort: parseRunReasoningEffort(record.reasoningEffort, record.openAI),
    toolConfirmationPolicy: parseToolConfirmationPolicy(record.toolConfirmationPolicy),
    modelOverride: parseModelOverride(record.modelOverride),
    workspaceDirectory: optionalString(record.workspaceDirectory),
    taskSoilInput,
  };
}

export function parseConversationRenameInput(raw: unknown): ConversationRenameInput {
  const title = optionalString(asRecord(raw).title);
  if (title === undefined) {
    throw new PanelHttpError(400, "missing_conversation_title", "会话标题不能为空。");
  }
  return { title };
}

export function parseConversationPinInput(raw: unknown): ConversationPinInput {
  const pinned = asRecord(raw).pinned;
  if (typeof pinned !== "boolean") {
    throw new PanelHttpError(400, "invalid_conversation_pin_state", "置顶状态必须是布尔值。");
  }
  return { pinned };
}

export function parseConfirmationDecision(raw: unknown): Pick<ConfirmationDecision, "decision" | "guidance"> {
  const record = asRecord(raw);
  const decision = optionalString(record.decision);
  if (decision !== "approve_once" && decision !== "deny" && decision !== "guidance") {
    throw new PanelHttpError(400, "invalid_confirmation_decision", "确认操作无效。");
  }
  const guidance = optionalString(record.guidance);
  if (decision === "guidance" && guidance === undefined) {
    throw new PanelHttpError(400, "missing_confirmation_guidance", "补充要求不能为空。");
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
  if (value === "streamableHttp") {
    return "http";
  }
  if (value === "sse") {
    return "http";
  }
  throw new PanelHttpError(400, "invalid_mcp_transport", "MCP transport 必须是 stdio 或 streamableHttp。");
}

function parseOptionalMcpConfirmationMode(value: unknown): McpConfirmationMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "always" || value === "unsafe_only" || value === "never") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_mcp_confirmation_mode", "MCP 确认模式无效。");
}

function parseOptionalMcpToolExposureMode(value: unknown): UpsertMcpServerInput["toolExposureMode"] {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "none" || value === "all" || value === "selected") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_mcp_tool_exposure_mode", "MCP 工具暴露模式无效。");
}

function parseOptionalWebSearchProvider(value: unknown): UpdateWebSearchConfigInput["provider"] {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (
    value === "tavily" ||
    value === "exa" ||
    value === "zai" ||
    value === "metaso" ||
    value === "google" ||
    value === "bing" ||
    value === "model_builtin" ||
    value === "none"
  ) {
    return value;
  }
  throw new PanelHttpError(400, "invalid_web_search_provider", "搜索工具 provider 无效。");
}

function parseOptionalRunMode(value: unknown): PanelRunMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "agent" || value === "deep") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_run_mode", "运行模式无效。");
}

function parseToolConfirmationPolicy(value: unknown): ToolConfirmationPolicy | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "prompt" || value === "full_access") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_tool_confirmation_policy", "工具确认策略无效。");
}

function parseModelOverride(value: unknown): PanelRunInput["modelOverride"] {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = asRecord(value);
  const profileId = optionalString(record.profileId);
  const model = optionalString(record.model);
  if (profileId === undefined || model === undefined) {
    throw new PanelHttpError(400, "invalid_model_override", "本次运行的模型选择无效。");
  }
  return { profileId, model };
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

function importedMcpServer(serverId: string, raw: unknown): UpsertMcpServerInput | undefined {
  const record = asRecord(raw);
  const id = optionalString(record.serverId) ?? optionalString(record.name) ?? serverId;
  const transport = parseImportedMcpTransport(record.transport ?? record.type, record.url);
  const command = optionalString(record.command);
  const args = stringArrayOrUndefined(record.args);
  const url = optionalString(record.url);
  const envRefs = Object.entries(asRecord(record.env))
    .map(([key, value]) => secretRefFromEnvValue(id, key, value))
    .filter((value): value is string => value !== undefined);
  const headerRefs = Object.entries(asRecord(record.headers ?? record.http_headers))
    .map(([key, value]) => secretRefFromHeaderValue(id, key, value))
    .filter((value): value is string => value !== undefined);
  return {
    serverId: id,
    label: optionalString(record.label) ?? id,
    description: optionalString(record.description),
    transport,
    command,
    args,
    url,
    envSecretRefs: envRefs,
    headerSecretRefs: headerRefs,
    confirmationMode: "never",
    toolExposureMode: "none",
    enabled: booleanOrUndefined(record.enabled) ?? false,
  };
}

function parseImportedMcpTransport(value: unknown, url: unknown): UpsertMcpServerInput["transport"] {
  if (value === "http" || value === "streamableHttp" || value === "sse" || optionalString(url) !== undefined) return "http";
  return "stdio";
}

function secretRefFromEnvValue(serverId: string, key: string, value: unknown): string | undefined {
  if (optionalString(key) === undefined) return undefined;
  if (typeof value === "string" && value.startsWith("secret://")) return value;
  return key;
}

function secretRefFromHeaderValue(serverId: string, key: string, value: unknown): string | undefined {
  const headerName = optionalString(key);
  if (headerName === undefined) return undefined;
  const ref = typeof value === "string" && value.startsWith("secret://")
    ? value
    : `secret://local-dev/mcp/${serverId}/${headerName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
  return `${headerName}=${ref}`;
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new PanelHttpError(400, "invalid_mcp_import_json", "导入内容不是有效 JSON。");
  }
}

export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseOpenAIModelRequestSettings(value: unknown): OpenAIModelRequestSettings {
  if (value === undefined || value === null) {
    return {};
  }
  const record = asRecord(value);
  return {
    temperature: optionalNumberInRange(record.temperature, 0, 2, "temperature 必须在 0 到 2 之间。"),
    topP: optionalNumberInRange(record.topP, 0, 1, "top_p 必须在 0 到 1 之间。"),
    maxOutputTokens: optionalPositiveInteger(record.maxOutputTokens, "最大输出 token 必须是正整数。"),
    reasoningEffort: parseOptionalOpenAIReasoningEffort(record.reasoningEffort),
    reasoningSummary: parseOptionalOpenAIReasoningSummary(record.reasoningSummary),
    textVerbosity: parseOptionalOpenAITextVerbosity(record.textVerbosity),
    serviceTier: parseOptionalOpenAIServiceTier(record.serviceTier),
    truncation: parseOptionalOpenAITruncation(record.truncation),
    stream: booleanOrUndefined(record.stream),
    parallelToolCalls: booleanOrUndefined(record.parallelToolCalls),
    store: booleanOrUndefined(record.store),
  };
}

function parseRunReasoningEffort(
  value: unknown,
  legacyOpenAIValue: unknown
): ModelRunReasoningEffort | undefined {
  const direct = parseOptionalRunReasoningEffort(value);
  if (direct !== undefined) {
    return direct;
  }
  return parseOptionalRunReasoningEffort(asRecord(legacyOpenAIValue).reasoningEffort);
}

function optionalNumberInRange(value: unknown, min: number, max: number, message: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new PanelHttpError(400, "invalid_openai_parameter", message);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, message: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new PanelHttpError(400, "invalid_openai_parameter", message);
  }
  return Math.floor(value);
}

function parseOptionalOpenAIReasoningEffort(value: unknown): OpenAIModelRequestSettings["reasoningEffort"] {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "none" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_openai_parameter", "reasoning effort 无效。");
}

function parseOptionalRunReasoningEffort(value: unknown): ModelRunReasoningEffort | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  throw new PanelHttpError(400, "invalid_openai_parameter", "思考强度只能是 low、medium 或 high。");
}

function parseOptionalOpenAIReasoningSummary(value: unknown): OpenAIModelRequestSettings["reasoningSummary"] {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "auto" || value === "concise" || value === "detailed") return value;
  throw new PanelHttpError(400, "invalid_openai_parameter", "reasoning summary 无效。");
}

function parseOptionalOpenAITextVerbosity(value: unknown): OpenAIModelRequestSettings["textVerbosity"] {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new PanelHttpError(400, "invalid_openai_parameter", "text verbosity 无效。");
}

function parseOptionalOpenAIServiceTier(value: unknown): OpenAIModelRequestSettings["serviceTier"] {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "auto" || value === "default" || value === "flex" || value === "priority") return value;
  throw new PanelHttpError(400, "invalid_openai_parameter", "service tier 无效。");
}

function parseOptionalOpenAITruncation(value: unknown): OpenAIModelRequestSettings["truncation"] {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "auto" || value === "disabled") return value;
  throw new PanelHttpError(400, "invalid_openai_parameter", "truncation 无效。");
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
