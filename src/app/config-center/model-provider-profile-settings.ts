import type {
  AgentArborLocalSettings,
  ConfiguredModelProtocolKind,
  ConfiguredModelRuntimeMode,
  ModelProviderModelCatalog,
  ModelProviderProfileSettings,
} from "../../domain/config/index.js";
import { listBuiltinModelProviderPresets } from "../../domain/config/index.js";
import {
  normalizeOpenAIModelRequestSettings,
  parseOpenAIModelRequestSettings,
} from "./openai-request-settings.js";
import { ConfigSchemaValidationError, optionalString, safeConfigId } from "./settings-utils.js";
import {
  DEFAULT_MODEL_PROFILE_ID,
  DEFAULT_MODEL_PROVIDER_BASE_URL,
  MODEL_PROVIDER_SECRET_REF,
  normalizeBaseUrl,
  normalizeModelProviderKind,
  normalizeModelProtocolKind,
  normalizeOptionalString,
  normalizeProfileId,
} from "./model-provider-common.js";

const BUILTIN_PROFILE_PRESET_ALIASES = new Map<string, string>([
  ["default", "openai"],
  ["openai", "openai"],
  ["deepseek", "deepseek"],
  ["moonshot", "moonshot"],
  ["kimi", "moonshot"],
  ["glm", "glm"],
  ["zhipu", "glm"],
  ["zai", "glm"],
  ["minimax", "minimax"],
]);

const MODEL_PROVIDER_LOGO_FILE_MAX_BYTES = 3 * 1024 * 1024;
const MODEL_PROVIDER_LOGO_DATA_URL_MAX_LENGTH =
  "data:image/svg+xml;base64,".length + Math.ceil(MODEL_PROVIDER_LOGO_FILE_MAX_BYTES / 3) * 4;
const MODEL_PROVIDER_LOGO_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/u;

export function createDefaultModelProviderProfile(now: string): ModelProviderProfileSettings {
  return {
    profileId: DEFAULT_MODEL_PROFILE_ID,
    label: "OpenAI",
    providerKind: "openai_compatible",
    protocolKind: "openai_responses",
    baseUrl: DEFAULT_MODEL_PROVIDER_BASE_URL,
    defaultAiMode: "openai-responses",
    secretRef: MODEL_PROVIDER_SECRET_REF,
    enabled: true,
    updatedAt: now,
  };
}

export function parseModelProfile(
  record: Record<string, unknown>,
  fallbacks: {
    readonly fallbackProfileId?: string;
    readonly fallbackLabel?: string;
    readonly fallbackSecretRef: string;
    readonly fallbackUpdatedAt: string;
  }
): AgentArborLocalSettings["modelProfiles"][number] {
  const profileId = safeConfigId(optionalString(record.profileId) ?? fallbacks.fallbackProfileId ?? "");
  const providerKind = parseModelProviderKind(record.providerKind);
  const baseUrl = optionalString(record.baseUrl);
  const protocolKind = parseModelProtocolKind(record.protocolKind, {
    profileId,
    baseUrl,
  });
  return {
    profileId,
    label: optionalString(record.label) ?? fallbacks.fallbackLabel ?? profileId,
    logoDataUrl: normalizeLogoDataUrl(record.logoDataUrl),
    providerKind,
    protocolKind,
    baseUrl,
    model: optionalString(record.model),
    openAI: parseOpenAIModelRequestSettings(record.openAI),
    defaultAiMode: normalizeProfileAiModeForProtocol(protocolKind),
    secretRef: optionalString(record.secretRef) ?? fallbacks.fallbackSecretRef,
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    updatedAt: optionalString(record.updatedAt) ?? fallbacks.fallbackUpdatedAt,
  };
}

export function dedupeProfiles(profiles: readonly ModelProviderProfileSettings[]): readonly ModelProviderProfileSettings[] {
  const map = new Map<string, ModelProviderProfileSettings>();
  for (const profile of profiles) {
    map.set(profile.profileId, profile);
  }
  return [...map.values()];
}

export function normalizeModelProfile(
  input: Partial<ModelProviderProfileSettings> & { readonly profileId?: string },
  fallback: ModelProviderProfileSettings
): ModelProviderProfileSettings {
  const providerKind = normalizeModelProviderKind(input.providerKind) ?? fallback.providerKind;
  const protocolKind = input.protocolKind === undefined
    ? fallback.protocolKind
    : normalizeModelProtocolKind(input.protocolKind) ?? fallback.protocolKind;
  const normalizedProtocolKind = normalizeProfileProtocol(protocolKind);
  const openAI =
    input.openAI === undefined ? fallback.openAI : normalizeOpenAIModelRequestSettings(input.openAI);
  return {
    profileId: normalizeProfileId(input.profileId ?? fallback.profileId),
    label: normalizeOptionalString(input.label) ?? fallback.label,
    logoDataUrl: input.logoDataUrl === undefined
      ? fallback.logoDataUrl
      : normalizeLogoDataUrl(input.logoDataUrl) ?? fallback.logoDataUrl,
    providerKind,
    protocolKind: normalizedProtocolKind,
    baseUrl: normalizeBaseUrl(input.baseUrl) ?? fallback.baseUrl,
    model: normalizeOptionalString(input.model) ?? fallback.model,
    openAI,
    defaultAiMode: normalizeProfileAiModeForProtocol(normalizedProtocolKind),
    secretRef: normalizeOptionalString(input.secretRef) ?? secretRefForProfile(input.profileId ?? fallback.profileId),
    enabled: input.enabled ?? fallback.enabled,
    updatedAt: normalizeOptionalString(input.updatedAt) ?? fallback.updatedAt,
  };
}

export function normalizeBuiltInModelProviderProfiles(
  profiles: readonly ModelProviderProfileSettings[],
  catalogs: readonly ModelProviderModelCatalog[],
  now: string
): readonly ModelProviderProfileSettings[] {
  return profiles.map((profile) => {
    const preset = builtInPresetForProfile(profile);
    if (preset === undefined) {
      return profile;
    }
    const providerKind = preset.providerKind;
    const protocolKind = normalizeBuiltInProfileProtocol(profile, preset);
    const defaultAiMode = normalizeProfileAiModeForProtocol(protocolKind);
    const baseUrl = normalizeBuiltInProfileBaseUrl(profile, preset);
    const model = shouldClearBuiltInProfileModel(profile, preset.presetId, catalogs)
      ? undefined
      : profile.model;
    const clearBuiltInLogo = shouldClearBuiltInProfileLogo(profile, preset.presetId);
    const next: ModelProviderProfileSettings = {
      ...profile,
      logoDataUrl: clearBuiltInLogo ? undefined : profile.logoDataUrl,
      providerKind,
      protocolKind,
      baseUrl,
      model,
      defaultAiMode,
    };
    return sameModelProfile(profile, next) ? profile : { ...next, updatedAt: now };
  });
}

function shouldClearBuiltInProfileLogo(
  profile: ModelProviderProfileSettings,
  presetId: string
): boolean {
  const baseUrl = normalizeBaseUrl(profile.baseUrl);
  if (baseUrl === undefined) {
    return BUILTIN_PROFILE_PRESET_ALIASES.get(profile.profileId) === presetId;
  }
  return builtInPresetIdForCanonicalBaseUrl(baseUrl) === presetId;
}

function parseModelProviderKind(value: unknown): AgentArborLocalSettings["modelProvider"]["providerKind"] {
  if (value === undefined || value === "openai_compatible") {
    return "openai_compatible";
  }
  throw new ConfigSchemaValidationError(
    "Invalid AgentArbor config file: model provider kind must be openai_compatible."
  );
}

function parseModelProtocolKind(
  value: unknown,
  input: {
    readonly profileId: string;
    readonly baseUrl?: string;
  }
): AgentArborLocalSettings["modelProvider"]["protocolKind"] {
  if (
    value === "openai_responses" ||
    value === "openai_compatible_chat_completions"
  ) {
    return value;
  }
  if (value !== undefined) {
    throw new ConfigSchemaValidationError(
      "Invalid AgentArbor config file: model protocol must be openai_responses or openai_compatible_chat_completions."
    );
  }
  return defaultProtocolForProfile(input);
}

function normalizeProfileProtocol(
  protocolKind: ConfiguredModelProtocolKind
): ConfiguredModelProtocolKind {
  return protocolKind === "openai_responses"
    ? "openai_responses"
    : "openai_compatible_chat_completions";
}

function normalizeProfileAiModeForProtocol(
  protocolKind: ConfiguredModelProtocolKind
): ConfiguredModelRuntimeMode {
  return protocolKind === "openai_compatible_chat_completions" ? "openai-compatible" : "openai-responses";
}

function builtInPresetForProfile(profile: ModelProviderProfileSettings): ReturnType<typeof listBuiltinModelProviderPresets>[number] | undefined {
  const presets = listBuiltinModelProviderPresets();
  const presetId = BUILTIN_PROFILE_PRESET_ALIASES.get(profile.profileId);
  if (presetId !== undefined) {
    return presets.find((preset) => preset.presetId === presetId);
  }
  const baseUrl = normalizeBaseUrl(profile.baseUrl);
  const canonicalOwner = baseUrl === undefined ? undefined : builtInPresetIdForCanonicalBaseUrl(baseUrl);
  return canonicalOwner === undefined
    ? undefined
    : presets.find((preset) => preset.presetId === canonicalOwner);
}

function defaultProtocolForProfile(input: {
  readonly profileId: string;
  readonly baseUrl?: string;
}): ConfiguredModelProtocolKind {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (input.profileId === DEFAULT_MODEL_PROFILE_ID || input.profileId === "openai") {
    return baseUrl === undefined || isOfficialOpenAIBaseUrl(baseUrl)
      ? "openai_responses"
      : "openai_compatible_chat_completions";
  }
  const presetId = BUILTIN_PROFILE_PRESET_ALIASES.get(input.profileId);
  if (presetId !== undefined) {
    return listBuiltinModelProviderPresets().find((preset) => preset.presetId === presetId)?.protocolKind ??
      "openai_compatible_chat_completions";
  }
  return "openai_compatible_chat_completions";
}

function normalizeBuiltInProfileProtocol(
  profile: ModelProviderProfileSettings,
  preset: ReturnType<typeof listBuiltinModelProviderPresets>[number]
): ConfiguredModelProtocolKind {
  const currentBaseUrl = normalizeBaseUrl(profile.baseUrl);
  const currentCanonicalOwner =
    currentBaseUrl === undefined ? undefined : builtInPresetIdForCanonicalBaseUrl(currentBaseUrl);
  if (currentCanonicalOwner !== undefined && currentCanonicalOwner !== preset.presetId) {
    return normalizeProfileProtocol(preset.protocolKind);
  }
  if (preset.presetId !== "openai") {
    return normalizeProfileProtocol(preset.protocolKind);
  }
  if (currentBaseUrl !== undefined && !isOfficialOpenAIBaseUrl(currentBaseUrl)) {
    return profile.protocolKind === "openai_responses"
      ? "openai_compatible_chat_completions"
      : normalizeProfileProtocol(profile.protocolKind);
  }
  return normalizeProfileProtocol(profile.protocolKind);
}

function normalizeBuiltInProfileBaseUrl(
  profile: ModelProviderProfileSettings,
  preset: ReturnType<typeof listBuiltinModelProviderPresets>[number]
): string {
  const canonicalBaseUrl = normalizeBaseUrl(preset.baseUrl) ?? preset.baseUrl;
  const currentBaseUrl = normalizeBaseUrl(profile.baseUrl);
  if (currentBaseUrl === undefined) {
    return canonicalBaseUrl;
  }
  if (preset.presetId === "openai" && currentBaseUrl === "https://api.openai.com") {
    return canonicalBaseUrl;
  }
  const currentCanonicalOwner = builtInPresetIdForCanonicalBaseUrl(currentBaseUrl);
  if (currentCanonicalOwner !== undefined && currentCanonicalOwner !== preset.presetId) {
    return canonicalBaseUrl;
  }
  return currentBaseUrl;
}

function shouldClearBuiltInProfileModel(
  profile: ModelProviderProfileSettings,
  presetId: string,
  catalogs: readonly ModelProviderModelCatalog[]
): boolean {
  const model = normalizeOptionalString(profile.model);
  if (model === undefined) {
    return false;
  }
  const ownCatalog = catalogs.find((catalog) => catalog.profileId === profile.profileId);
  if (ownCatalog?.models.some((item) => item.id === model) === true) {
    return false;
  }
  const modelSignalOwner = builtInPresetIdForModelSignal(model);
  if (modelSignalOwner === undefined || modelSignalOwner === presetId) {
    return false;
  }
  const currentBaseUrl = normalizeBaseUrl(profile.baseUrl);
  return currentBaseUrl === undefined || builtInPresetIdForCanonicalBaseUrl(currentBaseUrl) !== undefined;
}

function builtInPresetIdForCanonicalBaseUrl(baseUrl: string): string | undefined {
  if (isOfficialOpenAIBaseUrl(baseUrl)) {
    return "openai";
  }
  const preset = listBuiltinModelProviderPresets().find((item) => normalizeBaseUrl(item.baseUrl) === baseUrl);
  return preset?.presetId;
}

function isOfficialOpenAIBaseUrl(baseUrl: string): boolean {
  return baseUrl === "https://api.openai.com" || baseUrl === "https://api.openai.com/v1";
}

function builtInPresetIdForModelSignal(model: string): string | undefined {
  const normalized = model.trim().toLowerCase();
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("kimi") || normalized.includes("moonshot")) return "moonshot";
  if (normalized.includes("glm") || normalized.includes("zhipu") || normalized.includes("bigmodel")) return "glm";
  if (normalized.includes("minimax")) return "minimax";
  if (normalized.includes("gpt") || normalized.includes("openai")) return "openai";
  return undefined;
}

function sameModelProfile(left: ModelProviderProfileSettings, right: ModelProviderProfileSettings): boolean {
  return left.profileId === right.profileId &&
    left.label === right.label &&
    left.logoDataUrl === right.logoDataUrl &&
    left.providerKind === right.providerKind &&
    left.protocolKind === right.protocolKind &&
    left.baseUrl === right.baseUrl &&
    left.model === right.model &&
    JSON.stringify(left.openAI ?? {}) === JSON.stringify(right.openAI ?? {}) &&
    left.defaultAiMode === right.defaultAiMode &&
    left.secretRef === right.secretRef &&
    left.enabled === right.enabled;
}

function secretRefForProfile(profileId: string): string {
  return "secret://local-dev/model-provider/" + normalizeProfileId(profileId) + "/api-key";
}

export function normalizeLogoDataUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MODEL_PROVIDER_LOGO_DATA_URL_MAX_LENGTH) {
    return undefined;
  }
  return MODEL_PROVIDER_LOGO_DATA_URL_PATTERN.test(normalized) ? normalized : undefined;
}
