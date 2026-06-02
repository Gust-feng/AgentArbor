import type {
  AgentArborLocalSettings,
  McpServerSettings,
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
    const transport = record.transport === "http" ? "http" : "stdio";
    if (serverId.length === 0) {
      continue;
    }
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
      enabled: typeof record.enabled === "boolean" ? record.enabled : false,
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
    transport: server.transport === "http" ? "http" : "stdio",
    command: optionalString(server.command),
    args: sanitizeMcpArgs(server.args ?? []),
    url: optionalString(server.url),
    envSecretRefs: server.envSecretRefs.map((ref) => optionalString(ref)).filter((ref): ref is string => ref !== undefined),
    enabled: server.enabled,
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
