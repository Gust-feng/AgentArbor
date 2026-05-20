import type {
  AgentArborLocalSettings,
  ConfiguredInformationSourceKind,
  ConfiguredModelProviderKind,
  ConfiguredModelProtocolKind,
  ConfiguredUndergroundAiMode,
  ConfiguredWebSearchProvider,
  InformationAccessSettings,
  McpServerSettings,
  ModelCapabilities,
  ModelCapabilityOverrideSettings,
  ModelProviderModelCatalog,
  ModelProviderModelCatalogItem,
  ModelProviderProfileSettings,
  ToolStateSettings,
} from "../../domain/config/index.js";
import { listBuiltinModelProviderPresets } from "../../domain/config/index.js";

export const DEFAULT_MODEL_PROVIDER_BASE_URL = "https://api.openai.com/v1";
export const MODEL_PROVIDER_SECRET_REF = "secret://local-dev/model-provider/default/api-key";
export const INFORMATION_TAVILY_SECRET_REF = "secret://local-dev/information-source/tavily/default/api-key";
const DEFAULT_MODEL_PROFILE_ID = "default";
const BUILTIN_PROFILE_PRESET_ALIASES = new Map<string, string>([
  ["default", "openai"],
  ["openai", "openai"],
  ["claude", "claude"],
  ["anthropic", "claude"],
  ["deepseek", "deepseek"],
  ["moonshot", "moonshot"],
  ["kimi", "moonshot"],
  ["glm", "glm"],
  ["zhipu", "glm"],
  ["zai", "glm"],
  ["minimax", "minimax"],
]);
const DEFAULT_INFORMATION_SOURCE_PREFERENCE: readonly ConfiguredInformationSourceKind[] = [
  "web",
  "codebase",
  "soil",
  "run_memory",
  "docs",
  "packages",
  "github",
];
const DEFAULT_TAVILY_MAX_RESULTS = 5;

export class ConfigSchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigSchemaValidationError";
  }
}

export function parseLocalSettingsFile(raw: unknown): AgentArborLocalSettings {
  const record = asRecord(raw);
  const modelProvider = asRecord(record.modelProvider);
  const updatedAt = requiredString(record.updatedAt, "settings.updatedAt");
  const legacyProfile = parseModelProfile(modelProvider, {
    fallbackProfileId: DEFAULT_MODEL_PROFILE_ID,
    fallbackLabel: "Default",
    fallbackSecretRef: MODEL_PROVIDER_SECRET_REF,
    fallbackUpdatedAt: updatedAt,
  });
  const rawProfiles = Array.isArray(record.modelProfiles) ? record.modelProfiles : [];
  const parsedProfiles = rawProfiles
    .map((profile) => parseModelProfile(asRecord(profile), {
      fallbackProfileId: undefined,
      fallbackLabel: undefined,
      fallbackSecretRef: legacyProfile.secretRef,
      fallbackUpdatedAt: updatedAt,
    }))
    .filter((profile): profile is AgentArborLocalSettings["modelProfiles"][number] => profile.profileId.length > 0);
  const modelProfiles = dedupeProfiles(parsedProfiles.length === 0 ? [legacyProfile] : parsedProfiles);
  const activeModelProfileId =
    optionalString(record.activeModelProfileId) !== undefined &&
    modelProfiles.some((profile) => profile.profileId === optionalString(record.activeModelProfileId))
      ? optionalString(record.activeModelProfileId)!
      : legacyProfile.profileId;
  const activeProfile = modelProfiles.find((profile) => profile.profileId === activeModelProfileId) ?? modelProfiles[0] ?? legacyProfile;
  const informationAccess = asRecord(record.informationAccess);
  const webSearch = asRecord(informationAccess.webSearch);
  const tavily = asRecord(informationAccess.tavily);
  return normalizeLocalSettings({
    version: record.version === 3 ? 3 : record.version === 2 ? 2 : 1,
    modelProvider: activeProfile,
    activeModelProfileId: activeProfile.profileId,
    modelProfiles,
    modelCatalogs: parseModelCatalogs(record.modelCatalogs, updatedAt),
    modelCapabilityOverrides: parseModelCapabilityOverrides(record.modelCapabilityOverrides, updatedAt),
    toolStates: parseToolStates(record.toolStates, updatedAt),
    mcpServers: parseMcpServers(record.mcpServers, updatedAt),
    informationAccess:
      Object.keys(informationAccess).length === 0
        ? undefined
        : {
            sourcePreference: parseInformationSourcePreference(informationAccess.sourcePreference),
            webSearch: {
              provider: parseWebSearchProvider(webSearch.provider),
              updatedAt:
                optionalString(webSearch.updatedAt) ??
                optionalString(tavily.updatedAt) ??
                updatedAt,
            },
            tavily: {
              providerKind: "tavily",
              maxResults: positiveIntegerFromUnknown(tavily.maxResults) ?? DEFAULT_TAVILY_MAX_RESULTS,
              secretRef:
                optionalString(tavily.secretRef) ??
                INFORMATION_TAVILY_SECRET_REF,
              updatedAt: optionalString(tavily.updatedAt) ?? updatedAt,
            },
          },
    workspaceDirectory: optionalString(record.workspaceDirectory),
    updatedAt,
  });
}

export function createDefaultLocalSettings(now: string = new Date().toISOString()): AgentArborLocalSettings {
  const defaultProfile: ModelProviderProfileSettings = createDefaultProfile(now);
  return {
    version: 3,
    modelProvider: defaultProfile,
    activeModelProfileId: defaultProfile.profileId,
    modelProfiles: [defaultProfile],
    modelCatalogs: [],
    modelCapabilityOverrides: [],
    toolStates: [],
    mcpServers: [],
    informationAccess: createDefaultInformationAccessSettings(now),
    updatedAt: now,
  };
}

export function shouldRewriteLocalSettingsFile(
  raw: unknown,
  normalized: AgentArborLocalSettings
): boolean {
  try {
    return JSON.stringify(raw) !== JSON.stringify(normalized);
  } catch {
    return true;
  }
}

export function normalizeLocalSettings(settings: AgentArborLocalSettings): AgentArborLocalSettings {
  const now = settings.updatedAt;
  const legacyProfile = normalizeModelProfile(settings.modelProvider, createDefaultProfile(now));
  const profileFallback = { ...legacyProfile, model: undefined };
  const parsedProfiles = dedupeProfiles((settings.modelProfiles.length === 0 ? [legacyProfile] : settings.modelProfiles)
    .map((profile) => normalizeModelProfile(profile, profileFallback)));
  const parsedCatalogs = normalizeModelCatalogs(settings.modelCatalogs ?? [], parsedProfiles, now);
  const profiles = normalizeBuiltInModelProviderProfiles(parsedProfiles, parsedCatalogs, now);
  const modelCatalogs = normalizeModelCatalogs(settings.modelCatalogs ?? [], profiles, now);
  const activeProfile =
    profiles.find((profile) => profile.profileId === settings.activeModelProfileId) ??
    profiles.find((profile) => profile.profileId === legacyProfile.profileId) ??
    profiles[0] ??
    legacyProfile;
  return {
    ...settings,
    version: 3,
    modelProvider: activeProfile,
    activeModelProfileId: activeProfile.profileId,
    modelProfiles: profiles.length === 0 ? [activeProfile] : profiles,
    modelCatalogs,
    modelCapabilityOverrides: normalizeModelCapabilityOverrides(settings.modelCapabilityOverrides ?? [], now),
    toolStates: normalizeToolStates(settings.toolStates ?? [], now),
    mcpServers: normalizeMcpServers(settings.mcpServers ?? [], now),
    informationAccess: normalizeInformationAccessSettings(settings.informationAccess, now),
  };
}

export function normalizeModelProfile(
  input: Partial<ModelProviderProfileSettings> & { readonly profileId?: string },
  fallback: ModelProviderProfileSettings
): ModelProviderProfileSettings {
  const providerKind = normalizeModelProviderKind(input.providerKind) ?? fallback.providerKind;
  const protocolKind = normalizeModelProtocolKind(input.protocolKind, providerKind) ?? fallback.protocolKind;
  const defaultAiMode = normalizeAiMode(input.defaultAiMode) ?? fallback.defaultAiMode;
  return {
    profileId: normalizeProfileId(input.profileId ?? fallback.profileId),
    label: normalizeOptionalString(input.label) ?? fallback.label,
    providerKind,
    protocolKind: normalizeProfileProtocolForProvider(providerKind, protocolKind),
    baseUrl: normalizeBaseUrl(input.baseUrl) ?? fallback.baseUrl,
    model: normalizeOptionalString(input.model) ?? fallback.model,
    defaultAiMode: normalizeProfileAiModeForProvider(providerKind, defaultAiMode),
    secretRef: normalizeOptionalString(input.secretRef) ?? secretRefForProfile(input.profileId ?? fallback.profileId),
    enabled: input.enabled ?? fallback.enabled,
    updatedAt: normalizeOptionalString(input.updatedAt) ?? fallback.updatedAt,
  };
}

function normalizeProfileProtocolForProvider(
  providerKind: ConfiguredModelProviderKind,
  protocolKind: ConfiguredModelProtocolKind
): ConfiguredModelProtocolKind {
  if (providerKind === "openai_compatible") {
    return protocolKind === "openai_compatible_chat_completions"
      ? "openai_compatible_chat_completions"
      : "openai_responses";
  }
  if (providerKind === "anthropic") return "anthropic_messages";
  if (providerKind === "gemini") return "gemini_generate_content";
  if (providerKind === "ollama") return "ollama_generate";
  return protocolKind;
}

function normalizeProfileAiModeForProvider(
  providerKind: ConfiguredModelProviderKind,
  aiMode: ConfiguredUndergroundAiMode
): ConfiguredUndergroundAiMode {
  if (providerKind !== "openai_compatible") {
    return aiMode;
  }
  return "openai-responses";
}

function normalizeBuiltInModelProviderProfiles(
  profiles: readonly ModelProviderProfileSettings[],
  catalogs: readonly ModelProviderModelCatalog[],
  now: string
): readonly ModelProviderProfileSettings[] {
  const catalogModelOwners = catalogModelOwnerMap(catalogs);
  return profiles.map((profile) => {
    const preset = builtInPresetForProfile(profile);
    if (preset === undefined) {
      return profile;
    }
    const providerKind = preset.providerKind;
    const protocolKind = normalizeBuiltInProfileProtocol(profile, preset);
    const defaultAiMode = normalizeProfileAiModeForProvider(providerKind, profile.defaultAiMode);
    const baseUrl = normalizeBuiltInProfileBaseUrl(profile, preset);
    const model = shouldClearBuiltInProfileModel(profile, preset.presetId, catalogs, catalogModelOwners)
      ? undefined
      : profile.model;
    const next: ModelProviderProfileSettings = {
      ...profile,
      label: preset.label,
      providerKind,
      protocolKind,
      baseUrl,
      model,
      defaultAiMode,
    };
    return sameModelProfile(profile, next) ? profile : { ...next, updatedAt: now };
  });
}

function builtInPresetForProfile(profile: ModelProviderProfileSettings): ReturnType<typeof listBuiltinModelProviderPresets>[number] | undefined {
  const presetId = BUILTIN_PROFILE_PRESET_ALIASES.get(profile.profileId);
  if (presetId === undefined) {
    return undefined;
  }
  return listBuiltinModelProviderPresets().find((preset) => preset.presetId === presetId);
}

function normalizeBuiltInProfileProtocol(
  profile: ModelProviderProfileSettings,
  preset: ReturnType<typeof listBuiltinModelProviderPresets>[number]
): ConfiguredModelProtocolKind {
  const currentBaseUrl = normalizeBaseUrl(profile.baseUrl);
  const currentCanonicalOwner =
    currentBaseUrl === undefined ? undefined : builtInPresetIdForCanonicalBaseUrl(currentBaseUrl);
  if (currentCanonicalOwner !== undefined && currentCanonicalOwner !== preset.presetId) {
    return normalizeProfileProtocolForProvider(preset.providerKind, preset.protocolKind);
  }
  return normalizeProfileProtocolForProvider(preset.providerKind, profile.protocolKind);
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
  catalogs: readonly ModelProviderModelCatalog[],
  catalogModelOwners: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  const model = normalizeOptionalString(profile.model);
  if (model === undefined) {
    return false;
  }
  const ownCatalog = catalogs.find((catalog) => catalog.profileId === profile.profileId);
  if (ownCatalog?.models.some((item) => item.id === model) === true) {
    return false;
  }
  const catalogOwners = catalogModelOwners.get(model);
  if (catalogOwners !== undefined && [...catalogOwners].some((profileId) => profileId !== profile.profileId)) {
    return true;
  }
  const modelSignalOwner = builtInPresetIdForModelSignal(model);
  if (modelSignalOwner === undefined || modelSignalOwner === presetId) {
    return false;
  }
  const currentBaseUrl = normalizeBaseUrl(profile.baseUrl);
  return currentBaseUrl === undefined || builtInPresetIdForCanonicalBaseUrl(currentBaseUrl) !== undefined;
}

function catalogModelOwnerMap(catalogs: readonly ModelProviderModelCatalog[]): ReadonlyMap<string, ReadonlySet<string>> {
  const owners = new Map<string, Set<string>>();
  for (const catalog of catalogs) {
    for (const model of catalog.models) {
      const existing = owners.get(model.id) ?? new Set<string>();
      existing.add(catalog.profileId);
      owners.set(model.id, existing);
    }
  }
  return owners;
}

function builtInPresetIdForCanonicalBaseUrl(baseUrl: string): string | undefined {
  if (baseUrl === "https://api.openai.com") {
    return "openai";
  }
  const preset = listBuiltinModelProviderPresets().find((item) => normalizeBaseUrl(item.baseUrl) === baseUrl);
  return preset?.presetId;
}

function builtInPresetIdForModelSignal(model: string): string | undefined {
  const normalized = model.trim().toLowerCase();
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("claude") || normalized.includes("anthropic")) return "claude";
  if (normalized.includes("kimi") || normalized.includes("moonshot")) return "moonshot";
  if (normalized.includes("glm") || normalized.includes("zhipu") || normalized.includes("bigmodel")) return "glm";
  if (normalized.includes("minimax")) return "minimax";
  if (normalized.includes("gpt") || normalized.includes("openai")) return "openai";
  return undefined;
}

function sameModelProfile(left: ModelProviderProfileSettings, right: ModelProviderProfileSettings): boolean {
  return left.profileId === right.profileId &&
    left.label === right.label &&
    left.providerKind === right.providerKind &&
    left.protocolKind === right.protocolKind &&
    left.baseUrl === right.baseUrl &&
    left.model === right.model &&
    left.defaultAiMode === right.defaultAiMode &&
    left.secretRef === right.secretRef &&
    left.enabled === right.enabled;
}

export function createDefaultInformationAccessSettings(now: string): InformationAccessSettings {
  return {
    sourcePreference: [...DEFAULT_INFORMATION_SOURCE_PREFERENCE],
    webSearch: {
      provider: "tavily",
      updatedAt: now,
    },
    tavily: {
      providerKind: "tavily",
      maxResults: DEFAULT_TAVILY_MAX_RESULTS,
      secretRef: INFORMATION_TAVILY_SECRET_REF,
      updatedAt: now,
    },
  };
}

export function normalizeInformationAccessSettings(
  settings: InformationAccessSettings | undefined,
  now: string
): InformationAccessSettings {
  if (settings === undefined) {
    return createDefaultInformationAccessSettings(now);
  }
  return {
    sourcePreference: normalizeSourcePreference(settings.sourcePreference),
    webSearch: {
      provider: normalizeWebSearchProvider(settings.webSearch?.provider) ?? "tavily",
      updatedAt: normalizeOptionalString(settings.webSearch?.updatedAt) ?? settings.tavily.updatedAt ?? now,
    },
    tavily: {
      providerKind: "tavily",
      maxResults: normalizePositiveInteger(settings.tavily.maxResults) ?? DEFAULT_TAVILY_MAX_RESULTS,
      secretRef: normalizeOptionalString(settings.tavily.secretRef) ?? INFORMATION_TAVILY_SECRET_REF,
      updatedAt: normalizeOptionalString(settings.tavily.updatedAt) ?? now,
    },
  };
}

export function normalizeBaseUrl(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) {
    return undefined;
  }
  return normalized.replace(/\/+$/, "");
}

export function normalizeOptionalString(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeAiMode(value: ConfiguredUndergroundAiMode | undefined): ConfiguredUndergroundAiMode | undefined {
  return value === "none" || value === "fake" || value === "openai-compatible" || value === "openai-responses" ? value : undefined;
}

export function normalizeModelProviderKind(value: ConfiguredModelProviderKind | undefined): ConfiguredModelProviderKind | undefined {
  return value === "openai_compatible" || value === "anthropic" || value === "gemini" || value === "ollama" || value === "local"
    ? value
    : undefined;
}

export function normalizeModelProtocolKind(
  value: ConfiguredModelProtocolKind | undefined,
  providerKind: ConfiguredModelProviderKind
): ConfiguredModelProtocolKind | undefined {
  if (
    value === "openai_responses" ||
    value === "openai_compatible_chat_completions" ||
    value === "anthropic_messages" ||
    value === "gemini_generate_content" ||
    value === "ollama_generate"
  ) {
    return value;
  }
  if (providerKind === "anthropic") return "anthropic_messages";
  if (providerKind === "gemini") return "gemini_generate_content";
  if (providerKind === "ollama") return "ollama_generate";
  return "openai_responses";
}

export function normalizeWebSearchProvider(value: ConfiguredWebSearchProvider | undefined): ConfiguredWebSearchProvider | undefined {
  return value === "tavily" || value === "none" ? value : undefined;
}

export function normalizeSourcePreference(
  value: readonly ConfiguredInformationSourceKind[] | undefined
): readonly ConfiguredInformationSourceKind[] {
  const normalized = [...new Set((value ?? []).filter(isConfiguredInformationSourceKind))];
  return normalized.length === 0 ? [...DEFAULT_INFORMATION_SOURCE_PREFERENCE] : normalized;
}

export function normalizeRequiredConfigString(value: string | undefined, fieldName: string): string {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) {
    throw new ConfigSchemaValidationError(fieldName + " must be a non-empty string.");
  }
  return normalized;
}

export function normalizeProfileId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (normalized.length === 0) {
    throw new ConfigSchemaValidationError("Profile id must contain letters, numbers, underscore, or dash.");
  }
  return normalized;
}

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

export function sanitizeCapabilityOverride(capabilities: Partial<ModelCapabilities>): Partial<ModelCapabilities> {
  return {
    contextWindowTokens: normalizePositiveInteger(capabilities.contextWindowTokens),
    maxOutputTokens: normalizePositiveInteger(capabilities.maxOutputTokens),
    supportsToolCalling: booleanOrUndefined(capabilities.supportsToolCalling),
    supportsParallelToolCalls: booleanOrUndefined(capabilities.supportsParallelToolCalls),
    supportsStructuredOutputs: booleanOrUndefined(capabilities.supportsStructuredOutputs),
    supportsStreaming: booleanOrUndefined(capabilities.supportsStreaming),
    supportsVisionInput: booleanOrUndefined(capabilities.supportsVisionInput),
    supportsReasoningEffort: booleanOrUndefined(capabilities.supportsReasoningEffort),
    preferredApiStyle: normalizePreferredApiStyle(capabilities.preferredApiStyle),
    stability: normalizeModelStability(capabilities.stability),
    lastVerifiedAt: normalizeCapabilityVerifiedAt(capabilities.lastVerifiedAt),
  };
}

export function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function createDefaultProfile(now: string): ModelProviderProfileSettings {
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

function parseModelProfile(
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
  const protocolKind = parseModelProtocolKind(record.protocolKind, providerKind);
  return {
    profileId,
    label: optionalString(record.label) ?? fallbacks.fallbackLabel ?? profileId,
    providerKind,
    protocolKind,
    baseUrl: optionalString(record.baseUrl),
    model: optionalString(record.model),
    defaultAiMode: parseAiMode(record.defaultAiMode),
    secretRef: optionalString(record.secretRef) ?? fallbacks.fallbackSecretRef,
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    updatedAt: optionalString(record.updatedAt) ?? fallbacks.fallbackUpdatedAt,
  };
}

function parseModelCatalogs(
  value: unknown,
  updatedAt: string
): AgentArborLocalSettings["modelCatalogs"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const catalogs: ModelProviderModelCatalog[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const profileId = safeConfigId(optionalString(record.profileId) ?? "");
    if (profileId.length === 0) {
      continue;
    }
    catalogs.push({
      profileId,
      label: optionalString(record.label),
      baseUrl: optionalString(record.baseUrl) ?? "",
      modelsPath: normalizeModelCatalogPath(optionalString(record.modelsPath)),
      fetchedAt: optionalString(record.fetchedAt) ?? updatedAt,
      models: parseModelCatalogItems(record.models),
    });
  }
  return catalogs;
}

function parseModelCatalogItems(value: unknown): readonly ModelProviderModelCatalogItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): ModelProviderModelCatalogItem | undefined => {
      const record = asRecord(item);
      const id = optionalString(record.id);
      if (id === undefined) {
        return undefined;
      }
      return {
        id,
        displayName: optionalString(record.displayName) ?? id,
        owner: optionalString(record.owner),
        createdAt: optionalString(record.createdAt),
      };
    })
    .filter((item): item is ModelProviderModelCatalogItem => item !== undefined);
}

function parseModelProviderKind(value: unknown): AgentArborLocalSettings["modelProvider"]["providerKind"] {
  if (value === "anthropic" || value === "gemini" || value === "ollama" || value === "local") {
    return value;
  }
  return "openai_compatible";
}

function parseModelProtocolKind(
  value: unknown,
  providerKind: AgentArborLocalSettings["modelProvider"]["providerKind"]
): AgentArborLocalSettings["modelProvider"]["protocolKind"] {
  if (
    value === "openai_responses" ||
    value === "openai_compatible_chat_completions" ||
    value === "anthropic_messages" ||
    value === "gemini_generate_content" ||
    value === "ollama_generate"
  ) {
    return value;
  }
  if (providerKind === "anthropic") return "anthropic_messages";
  if (providerKind === "gemini") return "gemini_generate_content";
  if (providerKind === "ollama") return "ollama_generate";
  return "openai_responses";
}

function parseModelCapabilityOverrides(
  value: unknown,
  updatedAt: string
): AgentArborLocalSettings["modelCapabilityOverrides"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const overrides: ModelCapabilityOverrideSettings[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const model = optionalString(record.model);
    if (model === undefined) {
      continue;
    }
    const providerKind = optionalModelProviderKind(record.providerKind);
    overrides.push({
      ...(providerKind === undefined ? {} : { providerKind }),
      model,
      capabilities: parsePartialCapabilities(asRecord(record.capabilities)),
      updatedAt: optionalString(record.updatedAt) ?? updatedAt,
    });
  }
  return overrides;
}

function parsePartialCapabilities(record: Record<string, unknown>): NonNullable<AgentArborLocalSettings["modelCapabilityOverrides"]>[number]["capabilities"] {
  return sanitizeCapabilityOverride({
    contextWindowTokens: positiveIntegerFromUnknown(record.contextWindowTokens),
    maxOutputTokens: positiveIntegerFromUnknown(record.maxOutputTokens),
    supportsToolCalling: booleanFromUnknown(record.supportsToolCalling),
    supportsParallelToolCalls: booleanFromUnknown(record.supportsParallelToolCalls),
    supportsStructuredOutputs: booleanFromUnknown(record.supportsStructuredOutputs),
    supportsStreaming: booleanFromUnknown(record.supportsStreaming),
    supportsVisionInput: booleanFromUnknown(record.supportsVisionInput),
    supportsReasoningEffort: booleanFromUnknown(record.supportsReasoningEffort),
    preferredApiStyle: parsePreferredApiStyle(record.preferredApiStyle),
    stability: parseModelStability(record.stability),
    lastVerifiedAt: optionalString(record.lastVerifiedAt),
  });
}

function parseToolStates(value: unknown, updatedAt: string): AgentArborLocalSettings["toolStates"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = asRecord(item);
    const name = optionalString(record.name);
    return name === undefined
      ? undefined
      : {
          name,
          enabled: typeof record.enabled === "boolean" ? record.enabled : true,
          updatedAt: optionalString(record.updatedAt) ?? updatedAt,
        };
  }).filter((item): item is NonNullable<AgentArborLocalSettings["toolStates"]>[number] => item !== undefined);
}

function parseMcpServers(value: unknown, updatedAt: string): AgentArborLocalSettings["mcpServers"] {
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

function dedupeProfiles(profiles: readonly ModelProviderProfileSettings[]): readonly ModelProviderProfileSettings[] {
  const map = new Map<string, ModelProviderProfileSettings>();
  for (const profile of profiles) {
    map.set(profile.profileId, profile);
  }
  return [...map.values()];
}

function normalizeModelCapabilityOverrides(
  overrides: readonly ModelCapabilityOverrideSettings[],
  now: string
): readonly ModelCapabilityOverrideSettings[] {
  return overrides.map((override) => ({
    providerKind: normalizeModelProviderKind(override.providerKind),
    model: normalizeRequiredConfigString(override.model, "model"),
    capabilities: sanitizeCapabilityOverride(override.capabilities),
    updatedAt: normalizeOptionalString(override.updatedAt) ?? now,
  }));
}

function normalizeToolStates(states: readonly ToolStateSettings[], now: string): readonly ToolStateSettings[] {
  return states.map((state) => ({
    name: normalizeRequiredConfigString(state.name, "tool name"),
    enabled: state.enabled,
    updatedAt: normalizeOptionalString(state.updatedAt) ?? now,
  }));
}

function normalizeMcpServers(servers: readonly McpServerSettings[], now: string): readonly McpServerSettings[] {
  return servers.map((server) => ({
    serverId: normalizeProfileId(server.serverId),
    label: normalizeOptionalString(server.label) ?? server.serverId,
    transport: server.transport === "http" ? "http" : "stdio",
    command: normalizeOptionalString(server.command),
    args: sanitizeMcpArgs(server.args ?? []),
    url: normalizeOptionalString(server.url),
    envSecretRefs: server.envSecretRefs.map((ref) => normalizeOptionalString(ref)).filter((ref): ref is string => ref !== undefined),
    enabled: server.enabled,
    updatedAt: normalizeOptionalString(server.updatedAt) ?? now,
  }));
}

function normalizeModelCatalogs(
  catalogs: readonly ModelProviderModelCatalog[],
  profiles: readonly ModelProviderProfileSettings[],
  now: string
): readonly ModelProviderModelCatalog[] {
  const profileMap = new Map(profiles.map((profile) => [profile.profileId, profile]));
  const catalogMap = new Map<string, ModelProviderModelCatalog>();
  for (const catalog of catalogs) {
    const profileId = normalizeCatalogProfileId(catalog.profileId);
    if (profileId === undefined) {
      continue;
    }
    const profile = profileMap.get(profileId);
    if (profile === undefined) {
      continue;
    }
    catalogMap.set(profileId, {
      profileId,
      label: normalizeOptionalString(catalog.label) ?? profile.label,
      baseUrl:
        normalizeBaseUrl(catalog.baseUrl) ??
        normalizeBaseUrl(profile.baseUrl) ??
        DEFAULT_MODEL_PROVIDER_BASE_URL,
      modelsPath: normalizeModelCatalogPath(catalog.modelsPath),
      fetchedAt: normalizeCatalogFetchedAt(catalog.fetchedAt) ?? now,
      models: normalizeModelCatalogItems(catalog.models),
    });
  }
  return [...catalogMap.values()];
}

function normalizeModelCatalogItems(
  models: readonly ModelProviderModelCatalogItem[]
): readonly ModelProviderModelCatalogItem[] {
  const map = new Map<string, ModelProviderModelCatalogItem>();
  for (const model of models) {
    const id = normalizeOptionalString(model.id);
    if (id === undefined || map.has(id)) {
      continue;
    }
    map.set(id, {
      id,
      displayName: normalizeOptionalString(model.displayName) ?? id,
      owner: normalizeOptionalString(model.owner),
      createdAt: normalizeCatalogFetchedAt(model.createdAt),
    });
  }
  return [...map.values()];
}

function normalizeCatalogProfileId(profileId: string): string | undefined {
  try {
    return normalizeProfileId(profileId);
  } catch {
    return undefined;
  }
}

function normalizeModelCatalogPath(value: string | undefined): string {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) {
    return "/models";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeCatalogFetchedAt(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized !== undefined && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(normalized) ? normalized : undefined;
}

function secretRefForProfile(profileId: string): string {
  return "secret://local-dev/model-provider/" + normalizeProfileId(profileId) + "/api-key";
}

function normalizePreferredApiStyle(value: ModelCapabilities["preferredApiStyle"] | undefined): ModelCapabilities["preferredApiStyle"] | undefined {
  return value === "chat_completions" ||
    value === "responses" ||
    value === "messages" ||
    value === "gemini_generate_content" ||
    value === "openai_compatible"
    ? value
    : undefined;
}

function normalizeModelStability(value: ModelCapabilities["stability"] | undefined): ModelCapabilities["stability"] | undefined {
  return value === "stable" || value === "preview" || value === "deprecated" || value === "unknown"
    ? value
    : undefined;
}

function normalizeCapabilityVerifiedAt(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized !== undefined && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(normalized) ? normalized : undefined;
}

function booleanOrUndefined(value: boolean | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function booleanFromUnknown(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseAiMode(value: unknown): AgentArborLocalSettings["modelProvider"]["defaultAiMode"] {
  if (value === "none" || value === "fake" || value === "openai-compatible" || value === "openai-responses") {
    return value;
  }
  return "none";
}

function optionalModelProviderKind(value: unknown): AgentArborLocalSettings["modelProvider"]["providerKind"] | undefined {
  return value === "openai_compatible" || value === "anthropic" || value === "gemini" || value === "ollama" || value === "local"
    ? value
    : undefined;
}

function parsePreferredApiStyle(
  value: unknown
): NonNullable<AgentArborLocalSettings["modelCapabilityOverrides"]>[number]["capabilities"]["preferredApiStyle"] {
  return value === "chat_completions" ||
    value === "responses" ||
    value === "messages" ||
    value === "gemini_generate_content" ||
    value === "openai_compatible"
    ? value
    : undefined;
}

function parseModelStability(
  value: unknown
): NonNullable<AgentArborLocalSettings["modelCapabilityOverrides"]>[number]["capabilities"]["stability"] {
  return value === "stable" || value === "preview" || value === "deprecated" || value === "unknown"
    ? value
    : undefined;
}

function parseWebSearchProvider(
  value: unknown
): NonNullable<AgentArborLocalSettings["informationAccess"]>["webSearch"]["provider"] {
  return value === "none" ? "none" : "tavily";
}

function parseInformationSourcePreference(value: unknown): NonNullable<AgentArborLocalSettings["informationAccess"]>["sourcePreference"] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_INFORMATION_SOURCE_PREFERENCE];
  }
  const parsed = value.filter(isConfiguredInformationSourceKind);
  return parsed.length === 0 ? [...DEFAULT_INFORMATION_SOURCE_PREFERENCE] : [...new Set(parsed)];
}

function isConfiguredInformationSourceKind(value: unknown): value is ConfiguredInformationSourceKind {
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

function positiveIntegerFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : undefined;
}

function requiredString(value: unknown, fieldName: string): string {
  const result = optionalString(value);
  if (result === undefined) {
    throw new ConfigSchemaValidationError("Invalid AgentArbor config file: " + fieldName + " must be a non-empty string.");
  }
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function safeConfigId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
