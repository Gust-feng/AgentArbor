import { createHash } from "node:crypto";
import type { AgentSystemPromptSpec } from "../agent-prompts/contracts.js";
import type {
  DesktopAgentBuiltInPromptVariant,
  DesktopAgentBuiltInPromptVariantInfo,
  DesktopAgentSettings,
  SanitizedDesktopAgentConfig,
  UpdateDesktopAgentConfigInput,
} from "../../domain/config/index.js";
import {
  DESKTOP_ROOT_AGENT_PROMPT,
  DESKTOP_ROOT_AGENT_PROMPT_ZH,
  isKnownBuiltInDesktopRootAgentSystemPrompt,
} from "../agent-prompts/desktop-root-agent-prompt.js";
import { asRecord, optionalString } from "./settings-utils.js";

export const DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT = DESKTOP_ROOT_AGENT_PROMPT.systemPrompt;
export const DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS = 20_000;
export const DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT_VARIANT: DesktopAgentBuiltInPromptVariant = "en";

// 用户自定义提示词的稳定引用：正文与指纹只进入 sanitized 投影，不进入设置存储。
export const USER_CONFIGURED_DESKTOP_PROMPT_REF = "prompt:desktop-root-agent:user-configured";

// 内置提示词偏好目录：id 是持久化事实，label/description 是只读展示字段。
export const DESKTOP_AGENT_BUILT_IN_PROMPT_VARIANTS: readonly DesktopAgentBuiltInPromptVariantInfo[] = [
  {
    id: "en",
    label: "English",
    description: "英文提示词，回答跟随用户使用的语言",
  },
  {
    id: "zh-v1",
    label: "简体中文",
    description: "中文提示词，回答默认使用简体中文",
  },
];

export function isKnownDesktopAgentBuiltInPromptVariant(value: unknown): value is DesktopAgentBuiltInPromptVariant {
  return value === "en" || value === "zh-v1";
}

export function createDefaultDesktopAgentSettings(
  now: string,
  variant: DesktopAgentBuiltInPromptVariant = DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT_VARIANT
): DesktopAgentSettings {
  return {
    systemPromptMode: "built_in",
    systemPromptVariant: variant,
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
  const variant = parseBuiltInPromptVariant(record.systemPromptVariant);
  const systemPrompt = normalizeCustomSystemPrompt(systemPromptFromUnknown(record.systemPrompt));
  if (record.systemPromptMode === "built_in") {
    return createDefaultDesktopAgentSettings(updatedAt, variant);
  }
  if (record.systemPromptMode === "custom") {
    return systemPrompt === undefined
      ? createDefaultDesktopAgentSettings(updatedAt, variant)
      : createCustomDesktopAgentSettings(systemPrompt, variant, updatedAt);
  }
  if (systemPrompt === undefined || isKnownBuiltInDesktopRootAgentSystemPrompt(systemPrompt)) {
    return createDefaultDesktopAgentSettings(updatedAt, variant);
  }
  return createCustomDesktopAgentSettings(systemPrompt, variant, updatedAt);
}

export function normalizeDesktopAgentSettings(
  settings: DesktopAgentSettings | undefined,
  now: string
): DesktopAgentSettings {
  if (settings === undefined) {
    return createDefaultDesktopAgentSettings(now);
  }
  const updatedAt = optionalString(settings.updatedAt) ?? now;
  const variant = parseBuiltInPromptVariant(settings.systemPromptVariant);
  if (settings.systemPromptMode === "built_in") {
    return createDefaultDesktopAgentSettings(updatedAt, variant);
  }
  const systemPrompt = normalizeCustomSystemPrompt(settings.systemPrompt);
  return systemPrompt === undefined
    ? createDefaultDesktopAgentSettings(updatedAt, variant)
    : createCustomDesktopAgentSettings(systemPrompt, variant, updatedAt);
}

export function normalizeDesktopAgentUpdate(
  input: UpdateDesktopAgentConfigInput,
  current: DesktopAgentSettings | undefined,
  now: string
): DesktopAgentSettings {
  const variant = parseBuiltInPromptVariant(current?.systemPromptVariant);
  if (input.resetSystemPrompt === true) {
    return createDefaultDesktopAgentSettings(now, variant);
  }
  if (input.systemPrompt !== undefined) {
    const systemPrompt = normalizeCustomSystemPrompt(input.systemPrompt);
    return systemPrompt === undefined
      ? createDefaultDesktopAgentSettings(now, variant)
      : createCustomDesktopAgentSettings(systemPrompt, variant, now);
  }
  if (isKnownDesktopAgentBuiltInPromptVariant(input.systemPromptVariant)) {
    return createDefaultDesktopAgentSettings(now, input.systemPromptVariant);
  }
  return {
    ...normalizeDesktopAgentSettings(current, now),
    updatedAt: now,
  };
}

export function toSanitizedDesktopAgentConfig(
  settings: DesktopAgentSettings | undefined,
  input: { readonly now?: string } = {}
): SanitizedDesktopAgentConfig {
  const normalized = normalizeDesktopAgentSettings(settings, input.now ?? new Date().toISOString());
  if (normalized.systemPromptMode === "custom") {
    return {
      systemPrompt: normalized.systemPrompt,
      systemPromptVariant: normalized.systemPromptVariant,
      promptRef: USER_CONFIGURED_DESKTOP_PROMPT_REF,
      promptVersion: `user-${systemPromptFingerprint(normalized.systemPrompt)}`,
      updatedAt: normalized.updatedAt,
      isDefault: false,
      maxSystemPromptChars: DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS,
      variants: DESKTOP_AGENT_BUILT_IN_PROMPT_VARIANTS,
    };
  }
  const spec = desktopAgentPromptSpecForVariant(normalized.systemPromptVariant);
  return {
    systemPrompt: spec.systemPrompt,
    systemPromptVariant: normalized.systemPromptVariant,
    promptRef: spec.promptRef,
    promptVersion: spec.version,
    updatedAt: normalized.updatedAt,
    isDefault: true,
    maxSystemPromptChars: DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS,
    variants: DESKTOP_AGENT_BUILT_IN_PROMPT_VARIANTS,
  };
}

export function desktopAgentPromptSpecForVariant(
  variant: DesktopAgentBuiltInPromptVariant
): AgentSystemPromptSpec {
  if (variant === "zh-v1") {
    return DESKTOP_ROOT_AGENT_PROMPT_ZH;
  }
  return DESKTOP_ROOT_AGENT_PROMPT;
}

function systemPromptFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseBuiltInPromptVariant(value: unknown): DesktopAgentBuiltInPromptVariant {
  return isKnownDesktopAgentBuiltInPromptVariant(value) ? value : DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT_VARIANT;
}

function createCustomDesktopAgentSettings(
  systemPrompt: string,
  variant: DesktopAgentBuiltInPromptVariant,
  updatedAt: string
): DesktopAgentSettings {
  return {
    systemPromptMode: "custom",
    systemPrompt,
    systemPromptVariant: variant,
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

function systemPromptFingerprint(systemPrompt: string): string {
  return createHash("sha256").update(systemPrompt).digest("hex").slice(0, 12);
}
