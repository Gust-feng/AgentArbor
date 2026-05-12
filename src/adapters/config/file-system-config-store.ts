import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AgentArborLocalSettings,
  LocalDevSecretStore,
  McpServerSettings,
  ModelCapabilityOverrideSettings,
  NormalSettingsStore,
  SecretMetadata,
} from "../../domain/config/index.js";

export type AgentArborConfigDirectoryEnvironment = Readonly<Record<string, string | undefined>>;

export type ResolveAgentArborConfigDirectoryOptions = {
  readonly env?: AgentArborConfigDirectoryEnvironment;
  readonly platform?: NodeJS.Platform;
  readonly homeDirectory?: string;
};

type LocalDevSecretsFile = {
  readonly version: 1;
  readonly secrets: Readonly<Record<string, { readonly value: string; readonly updatedAt: string }>>;
  readonly updatedAt: string;
};

export class FileSystemNormalSettingsStore implements NormalSettingsStore {
  readonly settingsPath: string;

  constructor(readonly configDirectory: string) {
    this.settingsPath = path.join(configDirectory, "settings.json");
  }

  async readSettings(): Promise<AgentArborLocalSettings | undefined> {
    const raw = await readJsonFile(this.settingsPath);
    if (raw === undefined) {
      return undefined;
    }
    return parseSettingsFile(raw);
  }

  async writeSettings(settings: AgentArborLocalSettings): Promise<void> {
    await fs.mkdir(this.configDirectory, { recursive: true });
    await fs.writeFile(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

export class FileSystemLocalDevSecretStore implements LocalDevSecretStore {
  readonly secretsPath: string;

  constructor(readonly configDirectory: string) {
    this.secretsPath = path.join(configDirectory, "local-dev-secrets.json");
  }

  async getMetadata(secretRef: string): Promise<SecretMetadata> {
    const secrets = await this.readSecretsFile();
    const entry = secrets.secrets[secretRef];
    return entry === undefined ? { configured: false } : { configured: true, updatedAt: entry.updatedAt };
  }

  async readSecret(secretRef: string): Promise<string | undefined> {
    const secrets = await this.readSecretsFile();
    return secrets.secrets[secretRef]?.value;
  }

  async writeSecret(secretRef: string, value: string): Promise<SecretMetadata> {
    const current = await this.readSecretsFile();
    const updatedAt = new Date().toISOString();
    const next: LocalDevSecretsFile = {
      version: 1,
      secrets: {
        ...current.secrets,
        [secretRef]: { value, updatedAt },
      },
      updatedAt,
    };
    await fs.mkdir(this.configDirectory, { recursive: true });
    await fs.writeFile(this.secretsPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return { configured: true, updatedAt };
  }

  private async readSecretsFile(): Promise<LocalDevSecretsFile> {
    const raw = await readJsonFile(this.secretsPath);
    if (raw === undefined) {
      return { version: 1, secrets: {}, updatedAt: new Date(0).toISOString() };
    }
    return parseSecretsFile(raw);
  }
}

export function resolveAgentArborConfigDirectory(
  options: ResolveAgentArborConfigDirectoryOptions = {}
): string {
  const env = options.env ?? process.env;
  const explicit = nonBlank(env.AGENTARBOR_CONFIG_DIR);
  if (explicit !== undefined) {
    return path.resolve(explicit);
  }

  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? os.homedir();

  if (platform === "win32") {
    const localAppData = nonBlank(env.LOCALAPPDATA);
    return path.join(localAppData ?? homeDirectory, "AgentArbor", "config");
  }

  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Application Support", "AgentArbor", "config");
  }

  const xdgConfigHome = nonBlank(env.XDG_CONFIG_HOME);
  return path.join(xdgConfigHome ?? path.join(homeDirectory, ".config"), "agentarbor", "config");
}

async function readJsonFile(filePath: string): Promise<unknown | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function parseSettingsFile(raw: unknown): AgentArborLocalSettings {
  const record = asRecord(raw);
  const modelProvider = asRecord(record.modelProvider);
  const updatedAt = requiredString(record.updatedAt, "settings.updatedAt");
  const legacyProfile = parseModelProfile(modelProvider, {
    fallbackProfileId: "default",
    fallbackLabel: "Default",
    fallbackSecretRef: "secret://local-dev/model-provider/default/api-key",
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
  return {
    version: record.version === 3 ? 3 : record.version === 2 ? 2 : 1,
    modelProvider: activeProfile,
    activeModelProfileId: activeProfile.profileId,
    modelProfiles,
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
              maxResults: positiveInteger(tavily.maxResults) ?? 5,
              secretRef:
                optionalString(tavily.secretRef) ??
                "secret://local-dev/information-source/tavily/default/api-key",
              updatedAt: optionalString(tavily.updatedAt) ?? updatedAt,
            },
          },
    workspaceDirectory: optionalString(record.workspaceDirectory),
    updatedAt,
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
  return "openai_compatible_chat_completions";
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
  return {
    contextWindowTokens: positiveInteger(record.contextWindowTokens),
    maxOutputTokens: positiveInteger(record.maxOutputTokens),
    supportsToolCalling: booleanOrUndefined(record.supportsToolCalling),
    supportsParallelToolCalls: booleanOrUndefined(record.supportsParallelToolCalls),
    supportsStructuredOutputs: booleanOrUndefined(record.supportsStructuredOutputs),
    supportsStreaming: booleanOrUndefined(record.supportsStreaming),
    supportsVisionInput: booleanOrUndefined(record.supportsVisionInput),
    supportsReasoningEffort: booleanOrUndefined(record.supportsReasoningEffort),
    preferredApiStyle: parsePreferredApiStyle(record.preferredApiStyle),
    stability: parseModelStability(record.stability),
    lastVerifiedAt: optionalString(record.lastVerifiedAt),
  };
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
      args: Array.isArray(record.args) ? record.args.filter((arg): arg is string => typeof arg === "string") : [],
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

function dedupeProfiles(
  profiles: readonly AgentArborLocalSettings["modelProfiles"][number][]
): readonly AgentArborLocalSettings["modelProfiles"][number][] {
  const map = new Map<string, AgentArborLocalSettings["modelProfiles"][number]>();
  for (const profile of profiles) {
    map.set(profile.profileId, profile);
  }
  return [...map.values()];
}

function parseSecretsFile(raw: unknown): LocalDevSecretsFile {
  const record = asRecord(raw);
  const rawSecrets = asRecord(record.secrets);
  const secrets: Record<string, { value: string; updatedAt: string }> = {};
  for (const [secretRef, secret] of Object.entries(rawSecrets)) {
    const secretRecord = asRecord(secret);
    const value = optionalString(secretRecord.value);
    const updatedAt = optionalString(secretRecord.updatedAt);
    if (value !== undefined && updatedAt !== undefined) {
      secrets[secretRef] = { value, updatedAt };
    }
  }
  return {
    version: 1,
    secrets,
    updatedAt: optionalString(record.updatedAt) ?? new Date(0).toISOString(),
  };
}

function parseAiMode(value: unknown): AgentArborLocalSettings["modelProvider"]["defaultAiMode"] {
  if (value === "none" || value === "fake" || value === "openai-compatible") {
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
    return ["web", "codebase", "soil", "run_memory", "docs", "packages", "github"];
  }
  const parsed = value.filter(isConfiguredInformationSourceKind);
  return parsed.length === 0 ? ["web", "codebase", "soil", "run_memory", "docs", "packages", "github"] : [...new Set(parsed)];
}

function isConfiguredInformationSourceKind(value: unknown): value is NonNullable<AgentArborLocalSettings["informationAccess"]>["sourcePreference"][number] {
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

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function requiredString(value: unknown, fieldName: string): string {
  const result = optionalString(value);
  if (result === undefined) {
    throw new Error(`Invalid AgentArbor config file: ${fieldName} must be a non-empty string.`);
  }
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
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

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
