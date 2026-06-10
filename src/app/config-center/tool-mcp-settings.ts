import type {
  AgentArborLocalSettings,
  McpConfirmationMode,
  McpServerSettings,
  McpToolExposureMode,
  ToolStateSettings,
} from "../../domain/config/index.js";
import {
  ConfigSchemaValidationError,
  asRecord,
  normalizeRequiredConfigString,
  optionalString,
  safeConfigId,
} from "./settings-utils.js";

export function sanitizeMcpArgs(args: readonly string[]): readonly string[] {
  const sanitized: string[] = [];
  let nextArgIsSecret = false;
  for (const raw of args) {
    const arg = String(raw).trim();
    if (arg.length === 0) {
      continue;
    }
    const sensitiveKeyValue = /(?:api[_-]?key|token|secret|password|passwd|bearer)\s*[=:]/i.test(arg);
    const sensitiveFlag = /^--?(?:api[_-]?key|token|secret|password|passwd|bearer)$/i.test(arg);
    const likelySecretValue = /^(?:Bearer\s+|sk-[A-Za-z0-9_-]+|tvly-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.)/.test(arg);
    if (nextArgIsSecret || sensitiveKeyValue || sensitiveFlag || likelySecretValue) {
      sanitized.push("[secret-ref-required]");
    } else {
      sanitized.push(arg);
    }
    nextArgIsSecret = sensitiveFlag;
  }
  return sanitized;
}

export function parseMcpCommandLine(value: string): {
  readonly command?: string;
  readonly args: readonly string[];
} {
  const tokens = splitCommandLine(value);
  if (tokens.length === 0) {
    return { args: [] };
  }
  return {
    command: tokens[0],
    args: sanitizeMcpArgs(tokens.slice(1)),
  };
}

export function parseToolStates(value: unknown, updatedAt: string): AgentArborLocalSettings["toolStates"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): ToolStateSettings | undefined => {
      const record = asRecord(item);
      const name = optionalString(record.name);
      if (name === undefined) {
        return undefined;
      }
      return {
        name,
        enabled: record.enabled !== false,
        updatedAt: optionalString(record.updatedAt) ?? updatedAt,
      };
    })
    .filter((item): item is ToolStateSettings => item !== undefined);
}

export function parseMcpServers(value: unknown, updatedAt: string): AgentArborLocalSettings["mcpServers"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const servers: McpServerSettings[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const serverId = safeConfigId(optionalString(record.serverId) ?? "");
    const transport = parseTransport(record.transport);
    if (serverId.length === 0) {
      continue;
    }
    const enabledTools = Array.isArray(record.enabledTools)
      ? [...new Set(record.enabledTools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0).map((tool) => tool.trim()))]
      : [];
    servers.push({
      serverId,
      label: optionalString(record.label) ?? serverId,
      transport,
      command: optionalString(record.command),
      args: sanitizeMcpArgs(Array.isArray(record.args) ? record.args.filter((arg): arg is string => typeof arg === "string") : []),
      url: optionalString(record.url),
      envSecretRefs: Array.isArray(record.envSecretRefs)
        ? record.envSecretRefs.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0)
        : [],
      headerSecretRefs: Array.isArray(record.headerSecretRefs)
        ? record.headerSecretRefs.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0)
        : [],
      bearerTokenSecretRef: optionalString(record.bearerTokenSecretRef),
      apiKeySecretRef: optionalString(record.apiKeySecretRef),
      apiKeyHeaderName: optionalString(record.apiKeyHeaderName),
      confirmationMode: parseConfirmationMode(record.confirmationMode),
      toolExposureMode: parseToolExposureMode(record.toolExposureMode, enabledTools),
      enabledTools,
      enabled: typeof record.enabled === "boolean" ? record.enabled : false,
      lastConnectedAt: optionalString(record.lastConnectedAt),
      lastError: optionalString(record.lastError),
      updatedAt: optionalString(record.updatedAt) ?? updatedAt,
    });
  }
  return servers;
}

export function normalizeToolStates(states: readonly ToolStateSettings[], now: string): readonly ToolStateSettings[] {
  return states.map((state) => ({
    name: normalizeRequiredConfigString(state.name, "tool name"),
    enabled: state.enabled,
    updatedAt: optionalString(state.updatedAt) ?? now,
  }));
}

export function normalizeMcpServers(servers: readonly McpServerSettings[], now: string): readonly McpServerSettings[] {
  return servers.map((server) => ({
    serverId: normalizeConfigId(server.serverId),
    label: optionalString(server.label) ?? server.serverId,
    transport: parseTransport(server.transport),
    command: optionalString(server.command),
    args: sanitizeMcpArgs(server.args ?? []),
    url: optionalString(server.url),
    envSecretRefs: server.envSecretRefs.map((ref) => optionalString(ref)).filter((ref): ref is string => ref !== undefined),
    headerSecretRefs: uniqueStrings(server.headerSecretRefs),
    bearerTokenSecretRef: optionalString(server.bearerTokenSecretRef),
    apiKeySecretRef: optionalString(server.apiKeySecretRef),
    apiKeyHeaderName: optionalString(server.apiKeyHeaderName),
    confirmationMode: parseConfirmationMode(server.confirmationMode),
    toolExposureMode: parseToolExposureMode(server.toolExposureMode, server.enabledTools),
    enabledTools: uniqueStrings(server.enabledTools),
    enabled: server.enabled,
    lastConnectedAt: optionalString(server.lastConnectedAt),
    lastError: optionalString(server.lastError),
    updatedAt: optionalString(server.updatedAt) ?? now,
}));
}

function normalizeConfigId(value: string): string {
  const normalized = safeConfigId(value);
  if (normalized.length === 0) {
    throw new ConfigSchemaValidationError("Profile id must contain letters, numbers, underscore, or dash.");
  }
  return normalized;
}

function parseConfirmationMode(value: unknown): McpConfirmationMode {
  if (value === "unsafe_only" || value === "never") {
    return value;
  }
  return "always";
}

function parseToolExposureMode(value: unknown, enabledTools: readonly string[] = []): McpToolExposureMode {
  if (value === "all" || value === "selected" || value === "none") {
    return value;
  }
  return enabledTools.length > 0 ? "selected" : "none";
}

function parseTransport(value: unknown): McpServerSettings["transport"] {
  return value === "http" || value === "streamableHttp"
    ? "http"
    : value === "sse"
      ? "sse"
      : "stdio";
}

function uniqueStrings(values: readonly string[] | undefined): readonly string[] {
  return [...new Set((values ?? []).map((value) => optionalString(value)).filter((value): value is string => value !== undefined))];
}

function splitCommandLine(value: string): readonly string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  const input = value.trim();
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === "\\") {
      const next = input[index + 1];
      if (next === quote || next === "\\") {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}
