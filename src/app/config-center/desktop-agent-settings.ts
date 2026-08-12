import type {
  DesktopAgentSettings,
  SanitizedDesktopAgentConfig,
  UpdateDesktopAgentConfigInput,
} from "../../domain/config/index.js";
import {
  DESKTOP_ROOT_AGENT_PROMPT,
  isKnownBuiltInDesktopRootAgentSystemPrompt,
} from "../agent-prompts/desktop-root-agent-prompt.js";
import { asRecord, optionalString } from "./settings-utils.js";

export const DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT = DESKTOP_ROOT_AGENT_PROMPT.systemPrompt;
export const DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS = 20_000;

export function createDefaultDesktopAgentSettings(now: string): DesktopAgentSettings {
  return {
    systemPromptMode: "built_in",
    updatedAt: now,
  };
}

export function parseDesktopAgentSettings(
  raw: unknown,
  fallbackUpdatedAt: string
): DesktopAgentSettings | undefined {
  const record = asRecord(raw);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const updatedAt = optionalString(record.updatedAt) ?? fallbackUpdatedAt;
  const systemPrompt = normalizeCustomSystemPrompt(systemPromptFromUnknown(record.systemPrompt));
  if (record.systemPromptMode === "built_in") {
    return createDefaultDesktopAgentSettings(updatedAt);
  }
  if (record.systemPromptMode === "custom") {
    return systemPrompt === undefined
      ? createDefaultDesktopAgentSettings(updatedAt)
      : createCustomDesktopAgentSettings(systemPrompt, updatedAt);
  }
  if (systemPrompt === undefined || isKnownBuiltInDesktopRootAgentSystemPrompt(systemPrompt)) {
    return createDefaultDesktopAgentSettings(updatedAt);
  }
  return createCustomDesktopAgentSettings(systemPrompt, updatedAt);
}

export function normalizeDesktopAgentSettings(
  settings: DesktopAgentSettings | undefined,
  now: string
): DesktopAgentSettings {
  if (settings === undefined) {
    return createDefaultDesktopAgentSettings(now);
  }
  const updatedAt = optionalString(settings.updatedAt) ?? now;
  if (settings.systemPromptMode === "built_in") {
    return createDefaultDesktopAgentSettings(updatedAt);
  }
  const systemPrompt = normalizeCustomSystemPrompt(settings.systemPrompt);
  return systemPrompt === undefined
    ? createDefaultDesktopAgentSettings(updatedAt)
    : createCustomDesktopAgentSettings(systemPrompt, updatedAt);
}

export function normalizeDesktopAgentUpdate(
  input: UpdateDesktopAgentConfigInput,
  current: DesktopAgentSettings | undefined,
  now: string
): DesktopAgentSettings {
  if (input.resetSystemPrompt === true) {
    return createDefaultDesktopAgentSettings(now);
  }
  if (input.systemPrompt === undefined) {
    return {
      ...normalizeDesktopAgentSettings(current, now),
      updatedAt: now,
    };
  }
  const systemPrompt = normalizeCustomSystemPrompt(input.systemPrompt);
  return systemPrompt === undefined
    ? createDefaultDesktopAgentSettings(now)
    : createCustomDesktopAgentSettings(systemPrompt, now);
}

export function toSanitizedDesktopAgentConfig(
  settings: DesktopAgentSettings | undefined,
  input: { readonly now?: string } = {}
): SanitizedDesktopAgentConfig {
  const normalized = normalizeDesktopAgentSettings(settings, input.now ?? new Date().toISOString());
  return {
    systemPrompt:
      normalized.systemPromptMode === "custom"
        ? normalized.systemPrompt
        : DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT,
    updatedAt: normalized.updatedAt,
    isDefault: normalized.systemPromptMode === "built_in",
    maxSystemPromptChars: DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS,
  };
}

function systemPromptFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function createCustomDesktopAgentSettings(
  systemPrompt: string,
  updatedAt: string
): DesktopAgentSettings {
  return {
    systemPromptMode: "custom",
    systemPrompt,
    updatedAt,
  };
}

function normalizeCustomSystemPrompt(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS) {
    return trimmed.slice(0, DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS).trimEnd();
  }
  return trimmed;
}