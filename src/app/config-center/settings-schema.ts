import type {
  AgentArborLocalSettings,
  ConfiguredInformationSourceKind,
  ConfiguredWebSearchProvider,
  ConfiguredWebSearchProviderKind,
  InformationAccessSettings,
  ModelProviderProfileSettings,
  WebSearchProviderSettings,
} from "../../domain/config/index.js";
import { listBuiltinModelProviderPresets } from "../../domain/config/index.js";
import {
  normalizeOpenAIModelRequestSettings,
} from "./openai-request-settings.js";
import {
  DEFAULT_MODEL_PROVIDER_BASE_URL,
  MODEL_PROVIDER_SECRET_REF,
  createDefaultModelProviderProfile,
  dedupeProfiles,
  normalizeBuiltInModelProviderProfiles,
  normalizeModelCapabilityOverrides,
  normalizeModelCatalogs,
  normalizeModelProfile,
  normalizePositiveInteger,
  parseModelCapabilityOverrides,
  parseModelCatalogs,
  parseModelProfile,
} from "./model-provider-settings.js";
import {
  normalizeCommandShellSettings,
  parseCommandShellSettings,
  toSanitizedCommandShellConfig,
  normalizeCommandShellUpdate,
} from "./command-shell-settings.js";
import {
  normalizeToolConfirmationSettings,
  normalizeToolConfirmationUpdate,
  parseToolConfirmationSettings,
  toSanitizedToolConfirmationConfig,
} from "./tool-confirmation-settings.js";
import {
  normalizeSkillTriggerSettings,
  normalizeSkillTriggerUpdate,
  parseSkillTriggerSettings,
  toSanitizedSkillTriggerConfig,
} from "./skill-trigger-settings.js";
import {
  createDefaultDesktopAgentSettings,
  normalizeDesktopAgentSettings,
  normalizeDesktopAgentUpdate,
  parseDesktopAgentSettings,
  toSanitizedDesktopAgentConfig,
} from "./desktop-agent-settings.js";
import {
  ConfigSchemaValidationError,
  asRecord,
  normalizeRequiredConfigString,
  optionalString,
  requiredString,
} from "./settings-utils.js";
import {
  normalizeMcpServers,
  normalizeToolStates,
  parseMcpCommandLine,
  parseMcpServers,
  parseToolStates,
  sanitizeMcpArgs,
} from "./tool-mcp-settings.js";

export {
  DEFAULT_MODEL_PROVIDER_BASE_URL,
  MODEL_PROVIDER_SECRET_REF,
  normalizeAiMode,
  normalizeBaseUrl,
  normalizeModelProfile,
  normalizeModelProviderKind,
  normalizeModelProtocolKind,
  normalizePositiveInteger,
  normalizeProfileId,
  sanitizeCapabilityOverride,
} from "./model-provider-settings.js";
export { normalizeOpenAIModelRequestSettings } from "./openai-request-settings.js";
export { ConfigSchemaValidationError, normalizeRequiredConfigString } from "./settings-utils.js";
export {
  normalizeCommandShellSettings,
  normalizeCommandShellUpdate,
  toSanitizedCommandShellConfig,
} from "./command-shell-settings.js";
export {
  normalizeToolConfirmationSettings,
  normalizeToolConfirmationUpdate,
  toSanitizedToolConfirmationConfig,
} from "./tool-confirmation-settings.js";
export {
  normalizeSkillTriggerSettings,
  normalizeSkillTriggerUpdate,
  normalizeSkillTriggerMode,
  toSanitizedSkillTriggerConfig,
} from "./skill-trigger-settings.js";
export {
  DESKTOP_AGENT_SYSTEM_PROMPT_MAX_CHARS,
  DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT,
  normalizeDesktopAgentSettings,
  normalizeDesktopAgentUpdate,
  toSanitizedDesktopAgentConfig,
} from "./desktop-agent-settings.js";
export { parseMcpCommandLine, sanitizeMcpArgs } from "./tool-mcp-settings.js";

export const INFORMATION_TAVILY_SECRET_REF = "secret://local-dev/information-source/tavily/default/api-key";
export const INFORMATION_EXA_SECRET_REF = "secret://local-dev/information-source/exa/default/api-key";
export const INFORMATION_ZAI_SECRET_REF = "secret://local-dev/information-source/zai/default/api-key";
export const INFORMATION_METASO_SECRET_REF = "secret://local-dev/information-source/metaso/default/api-key";
export const INFORMATION_GOOGLE_SECRET_REF = "secret://local-dev/information-source/google/default/api-key";
export const INFORMATION_BING_SECRET_REF = "secret://local-dev/information-source/bing/default/api-key";
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
const DEFAULT_EXA_MAX_RESULTS = 5;
const DEFAULT_ZAI_MAX_RESULTS = 5;
const DEFAULT_METASO_MAX_RESULTS = 5;
const DEFAULT_GOOGLE_MAX_RESULTS = 5;
const DEFAULT_BING_MAX_RESULTS = 5;

export function parseLocalSettingsFile(raw: unknown): AgentArborLocalSettings {
  const record = asRecord(raw);
  if (record.version !== 3) {
    throw new ConfigSchemaValidationError(
      "Invalid AgentArbor config file: settings version must be 3."
    );
  }
  const modelProvider = asRecord(record.modelProvider);
  const updatedAt = requiredString(record.updatedAt, "settings.updatedAt");
  const legacyProfile = parseModelProfile(modelProvider, {
    fallbackProfileId: "default",
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
  const exa = asRecord(informationAccess.exa);
  const zai = asRecord(informationAccess.zai);
  const metaso = asRecord(informationAccess.metaso);
  const google = asRecord(informationAccess.google);
  const bing = asRecord(informationAccess.bing);
  return normalizeLocalSettings({
    version: 3,
    modelProvider: activeProfile,
    activeModelProfileId: activeProfile.profileId,
    modelProfiles,
    modelProviderOrder: parseModelProviderOrder(record.modelProviderOrder, modelProfiles),
    modelCatalogs: parseModelCatalogs(record.modelCatalogs, updatedAt),
    modelCapabilityOverrides: parseModelCapabilityOverrides(record.modelCapabilityOverrides, updatedAt),
    toolStates: parseToolStates(record.toolStates, updatedAt),
    toolConfirmation: parseToolConfirmationSettings(
      record.toolConfirmation ?? record.toolConfirmationPolicy,
      updatedAt
    ),
    desktopAgent: parseDesktopAgentSettings(record.desktopAgent, updatedAt),
    skillTrigger: parseSkillTriggerSettings(record.skillTrigger, updatedAt),
    commandShell: parseCommandShellSettings(record.commandShell, updatedAt),
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
              endpoint: optionalString(tavily.endpoint),
              searchDepth: optionalString(tavily.searchDepth) ?? "basic",
              updatedAt: optionalString(tavily.updatedAt) ?? updatedAt,
            },
            exa: {
              providerKind: "exa",
              maxResults: positiveIntegerFromUnknown(exa.maxResults) ?? DEFAULT_EXA_MAX_RESULTS,
              secretRef: optionalString(exa.secretRef) ?? INFORMATION_EXA_SECRET_REF,
              endpoint: optionalString(exa.endpoint),
              searchType: optionalString(exa.searchType) ?? "auto",
              updatedAt: optionalString(exa.updatedAt) ?? updatedAt,
            },
            zai: {
              providerKind: "zai",
              maxResults: positiveIntegerFromUnknown(zai.maxResults) ?? DEFAULT_ZAI_MAX_RESULTS,
              secretRef: optionalString(zai.secretRef) ?? INFORMATION_ZAI_SECRET_REF,
              endpoint: optionalString(zai.endpoint),
              searchEngine: optionalString(zai.searchEngine) ?? "search-prime",
              updatedAt: optionalString(zai.updatedAt) ?? updatedAt,
            },
            metaso: {
              providerKind: "metaso",
              maxResults: positiveIntegerFromUnknown(metaso.maxResults) ?? DEFAULT_METASO_MAX_RESULTS,
              secretRef: optionalString(metaso.secretRef) ?? INFORMATION_METASO_SECRET_REF,
              endpoint: optionalString(metaso.endpoint),
              updatedAt: optionalString(metaso.updatedAt) ?? updatedAt,
            },
            google: {
              providerKind: "google",
              maxResults: positiveIntegerFromUnknown(google.maxResults) ?? DEFAULT_GOOGLE_MAX_RESULTS,
              secretRef: optionalString(google.secretRef) ?? INFORMATION_GOOGLE_SECRET_REF,
              endpoint: optionalString(google.endpoint),
              engineId: optionalString(google.engineId),
              updatedAt: optionalString(google.updatedAt) ?? updatedAt,
            },
            bing: {
              providerKind: "bing",
              maxResults: positiveIntegerFromUnknown(bing.maxResults) ?? DEFAULT_BING_MAX_RESULTS,
              secretRef: optionalString(bing.secretRef) ?? INFORMATION_BING_SECRET_REF,
              endpoint: optionalString(bing.endpoint),
              market: optionalString(bing.market) ?? "en-US",
              updatedAt: optionalString(bing.updatedAt) ?? updatedAt,
            },
          },
    workspaceDirectory: optionalString(record.workspaceDirectory),
    updatedAt,
  });
}

export function createDefaultLocalSettings(now: string = new Date().toISOString()): AgentArborLocalSettings {
  const defaultProfile = createDefaultModelProviderProfile(now);
  return {
    version: 3,
    modelProvider: defaultProfile,
    activeModelProfileId: defaultProfile.profileId,
    modelProfiles: [defaultProfile],
    modelProviderOrder: [],
    modelCatalogs: [],
    modelCapabilityOverrides: [],
    toolStates: [],
    toolConfirmation: normalizeToolConfirmationSettings(undefined, now),
    desktopAgent: createDefaultDesktopAgentSettings(now),
    skillTrigger: normalizeSkillTriggerSettings(undefined, now),
    commandShell: normalizeCommandShellSettings(undefined, now),
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
  const legacyProfile = normalizeModelProfile(settings.modelProvider, createDefaultModelProviderProfile(now));
  // Profiles are independent records. The active legacy profile may supply
  // compatibility defaults, but visual state must never flow into another profile.
  const profileFallback = { ...legacyProfile, logoDataUrl: undefined, model: undefined, openAI: undefined };
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
    modelProviderOrder: normalizeModelProviderOrder(settings.modelProviderOrder ?? [], profiles),
    modelCatalogs,
    modelCapabilityOverrides: normalizeModelCapabilityOverrides(settings.modelCapabilityOverrides ?? [], now),
    toolStates: normalizeToolStates(settings.toolStates ?? [], now),
    toolConfirmation: normalizeToolConfirmationSettings(settings.toolConfirmation, now),
    desktopAgent: normalizeDesktopAgentSettings(settings.desktopAgent, now),
    skillTrigger: normalizeSkillTriggerSettings(settings.skillTrigger, now),
    commandShell: normalizeCommandShellSettings(settings.commandShell, now),
    mcpServers: normalizeMcpServers(settings.mcpServers ?? [], now),
    informationAccess: normalizeInformationAccessSettings(settings.informationAccess, now),
  };
}

function parseModelProviderOrder(
  raw: unknown,
  profiles: readonly ModelProviderProfileSettings[]
): readonly string[] {
  return Array.isArray(raw) ? normalizeModelProviderOrder(raw, profiles) : [];
}

function normalizeModelProviderOrder(
  order: readonly unknown[],
  profiles: readonly ModelProviderProfileSettings[]
): readonly string[] {
  const profileIds = new Set(profiles.map((profile) => profile.profileId));
  const knownKeys = new Set<string>([
    ...profiles.map((profile) => `profile:${profile.profileId}`),
    ...listBuiltinModelProviderPresets().map((preset) => `preset:${preset.presetId}`),
  ]);
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of order) {
    const rawKey = optionalString(value);
    const key = rawKey === undefined ? undefined : normalizeProviderOrderKey(rawKey, profileIds);
    if (key === undefined || !knownKeys.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function normalizeProviderOrderKey(key: string, profileIds: ReadonlySet<string>): string {
  if (!key.startsWith("preset:")) {
    return key;
  }
  const presetId = key.slice("preset:".length);
  return profileIds.has(presetId) ? `profile:${presetId}` : key;
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
      searchDepth: "basic",
      updatedAt: now,
    },
    exa: {
      providerKind: "exa",
      maxResults: DEFAULT_EXA_MAX_RESULTS,
      secretRef: INFORMATION_EXA_SECRET_REF,
      searchType: "auto",
      updatedAt: now,
    },
    zai: {
      providerKind: "zai",
      maxResults: DEFAULT_ZAI_MAX_RESULTS,
      secretRef: INFORMATION_ZAI_SECRET_REF,
      searchEngine: "search-prime",
      updatedAt: now,
    },
    metaso: {
      providerKind: "metaso",
      maxResults: DEFAULT_METASO_MAX_RESULTS,
      secretRef: INFORMATION_METASO_SECRET_REF,
      updatedAt: now,
    },
    google: {
      providerKind: "google",
      maxResults: DEFAULT_GOOGLE_MAX_RESULTS,
      secretRef: INFORMATION_GOOGLE_SECRET_REF,
      updatedAt: now,
    },
    bing: {
      providerKind: "bing",
      maxResults: DEFAULT_BING_MAX_RESULTS,
      secretRef: INFORMATION_BING_SECRET_REF,
      market: "en-US",
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
      updatedAt: normalizeOptionalString(settings.webSearch?.updatedAt) ?? settings.tavily?.updatedAt ?? now,
    },
    tavily: {
      providerKind: "tavily",
      maxResults: normalizePositiveInteger(settings.tavily?.maxResults) ?? DEFAULT_TAVILY_MAX_RESULTS,
      secretRef: normalizeOptionalString(settings.tavily?.secretRef) ?? INFORMATION_TAVILY_SECRET_REF,
      endpoint: normalizeOptionalString(settings.tavily?.endpoint),
      searchDepth: normalizeOptionalString(settings.tavily?.searchDepth) ?? "basic",
      updatedAt: normalizeOptionalString(settings.tavily?.updatedAt) ?? now,
    },
    exa: normalizeWebSearchProviderSettings(settings.exa, {
      providerKind: "exa",
      maxResults: DEFAULT_EXA_MAX_RESULTS,
      secretRef: INFORMATION_EXA_SECRET_REF,
      searchType: "auto",
      updatedAt: now,
    }),
    zai: normalizeWebSearchProviderSettings(settings.zai, {
      providerKind: "zai",
      maxResults: DEFAULT_ZAI_MAX_RESULTS,
      secretRef: INFORMATION_ZAI_SECRET_REF,
      searchEngine: "search-prime",
      updatedAt: now,
    }),
    metaso: normalizeWebSearchProviderSettings(settings.metaso, {
      providerKind: "metaso",
      maxResults: DEFAULT_METASO_MAX_RESULTS,
      secretRef: INFORMATION_METASO_SECRET_REF,
      updatedAt: now,
    }),
    google: normalizeWebSearchProviderSettings(settings.google, {
      providerKind: "google",
      maxResults: DEFAULT_GOOGLE_MAX_RESULTS,
      secretRef: INFORMATION_GOOGLE_SECRET_REF,
      updatedAt: now,
    }),
    bing: normalizeWebSearchProviderSettings(settings.bing, {
      providerKind: "bing",
      maxResults: DEFAULT_BING_MAX_RESULTS,
      secretRef: INFORMATION_BING_SECRET_REF,
      market: "en-US",
      updatedAt: now,
    }),
  };
}

export function normalizeOptionalString(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeWebSearchProvider(value: ConfiguredWebSearchProvider | undefined): ConfiguredWebSearchProvider | undefined {
  return isWebSearchProvider(value) ? value : undefined;
}

export function isWebSearchProvider(value: unknown): value is ConfiguredWebSearchProvider {
  return value === "tavily" ||
    value === "exa" ||
    value === "zai" ||
    value === "metaso" ||
    value === "google" ||
    value === "bing" ||
    value === "model_builtin" ||
    value === "none";
}

export function isWebSearchProviderKind(value: unknown): value is ConfiguredWebSearchProviderKind {
  return value === "tavily" ||
    value === "exa" ||
    value === "zai" ||
    value === "metaso" ||
    value === "google" ||
    value === "bing";
}

export function webSearchProviderSettings(
  informationAccess: InformationAccessSettings,
  provider: ConfiguredWebSearchProvider
): WebSearchProviderSettings | undefined {
  if (provider === "none" || provider === "model_builtin") {
    return undefined;
  }
  return informationAccess[provider];
}

export function normalizeSourcePreference(
  value: readonly ConfiguredInformationSourceKind[] | undefined
): readonly ConfiguredInformationSourceKind[] {
  const normalized = [...new Set((value ?? []).filter(isConfiguredInformationSourceKind))];
  return normalized.length === 0 ? [...DEFAULT_INFORMATION_SOURCE_PREFERENCE] : normalized;
}

function parseWebSearchProvider(
  value: unknown
): NonNullable<AgentArborLocalSettings["informationAccess"]>["webSearch"]["provider"] {
  return isWebSearchProvider(value) ? value : "tavily";
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

function normalizeWebSearchProviderSettings<T extends ConfiguredWebSearchProviderKind>(
  settings: (WebSearchProviderSettings & { readonly providerKind: T }) | undefined,
  fallback: WebSearchProviderSettings & { readonly providerKind: T }
): WebSearchProviderSettings & { readonly providerKind: T } {
  return {
    providerKind: fallback.providerKind,
    maxResults: normalizePositiveInteger(settings?.maxResults) ?? fallback.maxResults,
    secretRef: normalizeOptionalString(settings?.secretRef) ?? fallback.secretRef,
    endpoint: normalizeOptionalString(settings?.endpoint) ?? fallback.endpoint,
    searchDepth: normalizeOptionalString(settings?.searchDepth) ?? fallback.searchDepth,
    searchType: normalizeOptionalString(settings?.searchType) ?? fallback.searchType,
    searchEngine: normalizeOptionalString(settings?.searchEngine) ?? fallback.searchEngine,
    engineId: normalizeOptionalString(settings?.engineId) ?? fallback.engineId,
    market: normalizeOptionalString(settings?.market) ?? fallback.market,
    updatedAt: normalizeOptionalString(settings?.updatedAt) ?? fallback.updatedAt,
  };
}
