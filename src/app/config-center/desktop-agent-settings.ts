import type {
  DesktopAgentSettings,
  SanitizedDesktopAgentConfig,
  UpdateDesktopAgentConfigInput,
} from "../../domain/config/index.js";
import { DESKTOP_ROOT_AGENT_PROMPT } from "../agent-prompts/desktop-root-agent-prompt.js";
import { asRecord, optionalString } from "./settings-utils.js";

export const DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT = DESKTOP_ROOT_AGENT_PROMPT.systemPrompt;
export const DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS = 20_000;

export function createDefaultDesktopAgentSettings(now: string): DesktopAgentSettings {
  return {
    systemPrompt: DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT,
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
  return normalizeDesktopAgentSettings({
    systemPrompt: systemPromptFromUnknown(record.systemPrompt) ?? DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT,
    updatedAt: optionalString(record.updatedAt) ?? fallbackUpdatedAt,
  }, fallbackUpdatedAt);
}

export function normalizeDesktopAgentSettings(
  settings: DesktopAgentSettings | undefined,
  now: string
): DesktopAgentSettings {
  if (settings === undefined) {
    return createDefaultDesktopAgentSettings(now);
  }
  return {
    systemPrompt: normalizeStoredSystemPrompt(settings.systemPrompt),
    updatedAt: optionalString(settings.updatedAt) ?? now,
  };
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
  return {
    systemPrompt: normalizeStoredSystemPrompt(input.systemPrompt),
    updatedAt: now,
  };
}

export function toSanitizedDesktopAgentConfig(
  settings: DesktopAgentSettings | undefined,
  input: { readonly now?: string } = {}
): SanitizedDesktopAgentConfig {
  const normalized = normalizeDesktopAgentSettings(settings, input.now ?? new Date().toISOString());
  return {
    systemPrompt: normalized.systemPrompt,
    updatedAt: normalized.updatedAt,
    isDefault: normalized.systemPrompt === DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT,
    maxSystemPromptChars: DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS,
  };
}

function systemPromptFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeStoredSystemPrompt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT;
  }
  if (trimmed.length > DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS) {
    return trimmed.slice(0, DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS).trimEnd();
  }
  return trimmed;
}
