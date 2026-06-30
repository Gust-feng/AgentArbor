import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type DesktopLocalPreferenceStoreOptions = {
  readonly userDataDirectory: string;
  readonly appDataDirectory?: string;
  readonly legacyUserDataDirectories?: readonly string[];
};

export type DesktopLocalPreferenceStore = {
  readonly preferencePath: string;
  read(key: unknown): string | undefined;
  write(payload: unknown): boolean;
  readAll(): Record<string, string>;
};

const LEGACY_LOCAL_STORAGE_PREFERENCE_KEYS = [
  "agentarbor:style",
  "agentarbor:color",
  "agentarbor:motion",
  "agentarbor:startup-animation",
  "agentarbor:model-usage-display",
  "agentarbor.panel.sidebar.collapsed",
  "agentarbor.panel.agent_cluster.enabled",
] as const;

export function createDesktopLocalPreferenceStore(
  options: DesktopLocalPreferenceStoreOptions
): DesktopLocalPreferenceStore {
  const preferencePath = desktopLocalPreferencePath(options.userDataDirectory);
  let cachedPreferences: Record<string, string> | undefined;
  let legacyMigrationAttempted = false;

  const readAll = (): Record<string, string> => {
    if (cachedPreferences === undefined) {
      cachedPreferences = readDesktopLocalPreferences(preferencePath);
    }
    if (!legacyMigrationAttempted) {
      legacyMigrationAttempted = true;
      const migrated = migrateLegacyLocalStoragePreferences({
        ...options,
        currentPreferences: cachedPreferences,
      });
      if (migrated.changed) {
        cachedPreferences = migrated.preferences;
        persistDesktopLocalPreferences(preferencePath, cachedPreferences);
      }
    }
    return { ...cachedPreferences };
  };

  return {
    preferencePath,
    read(key: unknown): string | undefined {
      const normalizedKey = normalizeDesktopLocalPreferenceKey(key);
      if (normalizedKey === undefined) return undefined;
      return readAll()[normalizedKey];
    },
    write(payload: unknown): boolean {
      const preference = readDesktopLocalPreferencePayload(payload);
      if (preference === undefined) return false;
      const preferences = readAll();
      preferences[preference.key] = preference.value;
      const saved = persistDesktopLocalPreferences(preferencePath, preferences);
      if (saved) {
        cachedPreferences = preferences;
      }
      return saved;
    },
    readAll,
  };
}

export function normalizeDesktopLocalPreferenceKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim();
  return /^agentarbor[:.][a-z0-9:._-]+$/i.test(key) ? key : undefined;
}

function readDesktopLocalPreferencePayload(payload: unknown): { readonly key: string; readonly value: string } | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const record = payload as { readonly key?: unknown; readonly value?: unknown };
  const key = normalizeDesktopLocalPreferenceKey(record.key);
  const value = typeof record.value === "string" ? record.value : undefined;
  if (key === undefined || value === undefined) return undefined;
  return { key, value };
}

function desktopLocalPreferencePath(userDataDirectory: string): string {
  return path.join(userDataDirectory, "preferences", "local-preferences.json");
}

function readDesktopLocalPreferences(preferencePath: string): Record<string, string> {
  if (!existsSync(preferencePath)) {
    return {};
  }
  try {
    const raw = JSON.parse(readFileSync(preferencePath, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object") return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      const normalizedKey = normalizeDesktopLocalPreferenceKey(key);
      if (normalizedKey !== undefined && typeof value === "string") {
        result[normalizedKey] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function persistDesktopLocalPreferences(preferencePath: string, preferences: Record<string, string>): boolean {
  try {
    mkdirSync(path.dirname(preferencePath), { recursive: true });
    writeFileSync(preferencePath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

function migrateLegacyLocalStoragePreferences(input: {
  readonly userDataDirectory: string;
  readonly appDataDirectory?: string;
  readonly legacyUserDataDirectories?: readonly string[];
  readonly currentPreferences: Record<string, string>;
}): { readonly preferences: Record<string, string>; readonly changed: boolean } {
  const legacyPreferences = readLegacyLocalStoragePreferences(input);
  let changed = false;
  const preferences = { ...input.currentPreferences };
  for (const [key, value] of Object.entries(legacyPreferences)) {
    if (preferences[key] !== undefined) continue;
    preferences[key] = value;
    changed = true;
  }
  return { preferences, changed };
}

function readLegacyLocalStoragePreferences(input: {
  readonly userDataDirectory: string;
  readonly appDataDirectory?: string;
  readonly legacyUserDataDirectories?: readonly string[];
}): Record<string, string> {
  const preferences: Record<string, string> = {};
  for (const directory of legacyUserDataDirectories(input)) {
    for (const levelDbDirectory of legacyLocalStorageLevelDbDirectories(directory)) {
      readLegacyLevelDbPreferencesInto(levelDbDirectory, preferences);
    }
  }
  return preferences;
}

function legacyUserDataDirectories(input: {
  readonly userDataDirectory: string;
  readonly appDataDirectory?: string;
  readonly legacyUserDataDirectories?: readonly string[];
}): readonly string[] {
  const candidates = [
    input.userDataDirectory,
    ...(input.legacyUserDataDirectories ?? []),
    ...(input.appDataDirectory === undefined
      ? []
      : [
          path.join(input.appDataDirectory, "agentarbor"),
          path.join(input.appDataDirectory, "agentarbor\u5de5\u4f5c\u53f0"),
        ]),
  ];
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function legacyLocalStorageLevelDbDirectories(userDataDirectory: string): readonly string[] {
  return [
    path.join(userDataDirectory, "Local Storage", "leveldb"),
    path.join(userDataDirectory, "Partitions", "agentarbor", "Local Storage", "leveldb"),
  ];
}

function readLegacyLevelDbPreferencesInto(levelDbDirectory: string, preferences: Record<string, string>): void {
  let entries: readonly string[];
  try {
    entries = readdirSync(levelDbDirectory);
  } catch {
    return;
  }
  const sortedEntries = [...entries].sort();
  for (const entry of sortedEntries) {
    if (!/\.(log|ldb|sst)$/i.test(entry)) continue;
    const filePath = path.join(levelDbDirectory, entry);
    let raw: string;
    try {
      raw = readFileSync(filePath, "latin1");
    } catch {
      continue;
    }
    for (const key of LEGACY_LOCAL_STORAGE_PREFERENCE_KEYS) {
      const value = lastLegacyLocalStorageValue(raw, key);
      if (value !== undefined) {
        preferences[key] = value;
      }
    }
  }
}

function lastLegacyLocalStorageValue(raw: string, key: string): string | undefined {
  let value: string | undefined;
  let searchFrom = 0;
  while (true) {
    const index = raw.indexOf(key, searchFrom);
    if (index === -1) return value;
    const candidate = readLegacyLocalStorageValueAt(raw, index + key.length);
    if (candidate !== undefined) {
      value = candidate;
    }
    searchFrom = index + key.length;
  }
}

function readLegacyLocalStorageValueAt(raw: string, start: number): string | undefined {
  let index = start;
  while (index < raw.length && isLegacyLocalStorageSeparator(raw.charCodeAt(index))) {
    index += 1;
  }
  const valueStart = index;
  while (index < raw.length && isLegacyLocalStorageValueCharacter(raw.charCodeAt(index))) {
    index += 1;
  }
  if (index === valueStart) return undefined;
  return raw.slice(valueStart, index);
}

function isLegacyLocalStorageSeparator(code: number): boolean {
  return code < 32 || code === 127;
}

function isLegacyLocalStorageValueCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 46 ||
    code === 58 ||
    code === 95
  );
}
