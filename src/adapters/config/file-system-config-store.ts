import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AgentArborLocalSettings,
  LocalDevSecretStore,
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
  return {
    version: 1,
    modelProvider: {
      profileId: "default",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: requiredString(modelProvider.baseUrl, "settings.modelProvider.baseUrl"),
      model: optionalString(modelProvider.model),
      defaultAiMode: parseAiMode(modelProvider.defaultAiMode),
      secretRef: requiredString(modelProvider.secretRef, "settings.modelProvider.secretRef"),
      updatedAt: requiredString(modelProvider.updatedAt, "settings.modelProvider.updatedAt"),
    },
    updatedAt: requiredString(record.updatedAt, "settings.updatedAt"),
  };
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

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
