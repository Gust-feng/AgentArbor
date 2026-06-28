import { readAgentArborPackageVersion } from "./product-info.js";

export type AppUpdateStatus =
  | "unconfigured"
  | "no_release"
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "failed";

export type AppUpdateManifest = {
  readonly version: string;
  readonly channel?: string;
  readonly releaseDate?: string;
  readonly notes?: string;
  readonly releasePageUrl?: string;
  readonly downloadUrl?: string;
  readonly sha256?: string;
};

export type AppUpdateInfo = {
  readonly ok: boolean;
  readonly status: AppUpdateStatus;
  readonly currentVersion: string;
  readonly manifestUrlConfigured: boolean;
  readonly checkedAt?: string;
  readonly latest?: AppUpdateManifest;
  readonly errorSummary?: string;
};

export type AppUpdateFetch = (
  url: string,
  init: { readonly method: "GET"; readonly headers: Record<string, string>; readonly signal?: AbortSignal }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}>;

export type AppUpdateServiceOptions = {
  readonly manifestUrl?: string;
  readonly currentVersion?: string;
  readonly fetch?: AppUpdateFetch;
};

export const DEFAULT_APP_UPDATE_MANIFEST_URL = "https://api.github.com/repos/Gust-feng/AgentArbor/releases/latest";

export class AppUpdateService {
  private current: AppUpdateInfo;

  constructor(private readonly options: Required<Pick<AppUpdateServiceOptions, "currentVersion">> & AppUpdateServiceOptions) {
    this.current = {
      ok: true,
      status: normalizeManifestUrl(options.manifestUrl) === undefined ? "unconfigured" : "idle",
      currentVersion: options.currentVersion,
      manifestUrlConfigured: normalizeManifestUrl(options.manifestUrl) !== undefined,
    };
  }

  status(): AppUpdateInfo {
    return this.current;
  }

  async check(input: { readonly signal?: AbortSignal } = {}): Promise<AppUpdateInfo> {
    const manifestUrl = normalizeManifestUrl(this.options.manifestUrl);
    if (manifestUrl === undefined) {
      this.current = {
        ok: true,
        status: "unconfigured",
        currentVersion: this.options.currentVersion,
        manifestUrlConfigured: false,
      };
      return this.current;
    }

    this.current = {
      ...this.current,
      ok: true,
      status: "checking",
      manifestUrlConfigured: true,
      errorSummary: undefined,
    };

    const checkedAt = new Date().toISOString();
    try {
      const response = await (this.options.fetch ?? defaultAppUpdateFetch)(manifestUrl, {
        method: "GET",
        headers: {
          accept: "application/vnd.github+json, application/json",
          "x-github-api-version": "2022-11-28",
        },
        signal: input.signal,
      });
      if (!response.ok) {
        if (response.status === 404) {
          this.current = {
            ok: true,
            status: "no_release",
            currentVersion: this.options.currentVersion,
            manifestUrlConfigured: true,
            checkedAt,
          };
          return this.current;
        }
        return this.recordFailure(`更新清单请求失败：HTTP ${response.status}`, checkedAt);
      }
      const manifest = parseAppUpdateManifest(await response.json());
      if (manifest === undefined) {
        return this.recordFailure("更新清单格式无效。", checkedAt);
      }
      const comparison = compareAppVersions(manifest.version, this.options.currentVersion);
      if (comparison === undefined) {
        return this.recordFailure("更新清单版本号无效。", checkedAt);
      }
      this.current = {
        ok: true,
        status: comparison > 0 ? "available" : "up_to_date",
        currentVersion: this.options.currentVersion,
        manifestUrlConfigured: true,
        checkedAt,
        latest: manifest,
      };
      return this.current;
    } catch (error) {
      if (isAbortError(error)) {
        return this.recordFailure("更新检查已取消。", checkedAt);
      }
      return this.recordFailure(error instanceof Error ? error.message : "更新检查失败。", checkedAt);
    }
  }

  private recordFailure(errorSummary: string, checkedAt: string): AppUpdateInfo {
    this.current = {
      ok: false,
      status: "failed",
      currentVersion: this.options.currentVersion,
      manifestUrlConfigured: normalizeManifestUrl(this.options.manifestUrl) !== undefined,
      checkedAt,
      errorSummary,
    };
    return this.current;
  }
}

export function createAppUpdateService(options: AppUpdateServiceOptions = {}): AppUpdateService {
  return new AppUpdateService({
    ...options,
    currentVersion: options.currentVersion ?? readAgentArborPackageVersion(),
  });
}

export function compareAppVersions(left: string, right: string): number | undefined {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (parsedLeft === undefined || parsedRight === undefined) {
    return undefined;
  }
  for (let index = 0; index < 3; index += 1) {
    const difference = parsedLeft.core[index]! - parsedRight.core[index]!;
    if (difference !== 0) return Math.sign(difference);
  }
  if (parsedLeft.prerelease === undefined && parsedRight.prerelease !== undefined) return 1;
  if (parsedLeft.prerelease !== undefined && parsedRight.prerelease === undefined) return -1;
  if (parsedLeft.prerelease === undefined && parsedRight.prerelease === undefined) return 0;
  return comparePrerelease(parsedLeft.prerelease!, parsedRight.prerelease!);
}

function parseAppUpdateManifest(raw: unknown): AppUpdateManifest | undefined {
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const version = optionalString(record.version) ?? optionalString(record.tag_name);
  if (version === undefined) {
    return undefined;
  }
  const releasePageUrl = optionalHttpUrl(record.releasePageUrl) ?? optionalHttpUrl(record.html_url);
  const downloadUrl = optionalHttpUrl(record.downloadUrl) ?? firstGitHubReleaseAssetDownloadUrl(record.assets);
  return {
    version,
    channel: optionalString(record.channel),
    releaseDate: optionalString(record.releaseDate) ?? optionalString(record.published_at),
    notes: normalizeNotes(record.notes) ?? normalizeNotes(record.body),
    ...(releasePageUrl === undefined ? {} : { releasePageUrl }),
    ...(downloadUrl === undefined ? {} : { downloadUrl }),
    sha256: optionalString(record.sha256) ?? firstGitHubReleaseAssetSha256(record.assets),
  };
}

function normalizeNotes(value: unknown): string | undefined {
  if (typeof value === "string") {
    return optionalString(value);
  }
  if (Array.isArray(value)) {
    const notes = value
      .map((item) => optionalString(item))
      .filter((item): item is string => item !== undefined);
    return notes.length === 0 ? undefined : notes.join("\n");
  }
  return undefined;
}

function optionalHttpUrl(value: unknown): string | undefined {
  const raw = optionalString(value);
  if (raw === undefined) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function firstGitHubReleaseAssetDownloadUrl(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const item of value) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const url = optionalHttpUrl((item as Record<string, unknown>).browser_download_url);
    if (url !== undefined) {
      return url;
    }
  }
  return undefined;
}

function firstGitHubReleaseAssetSha256(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const item of value) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const digest = optionalString((item as Record<string, unknown>).digest);
    if (digest === undefined) {
      continue;
    }
    const normalized = digest.replace(/^sha256:/iu, "").trim();
    if (/^[a-f0-9]{64}$/iu.test(normalized)) {
      return normalized.toLowerCase();
    }
  }
  return undefined;
}

function normalizeManifestUrl(value: string | undefined): string | undefined {
  return optionalHttpUrl(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseVersion(value: string): { readonly core: readonly [number, number, number]; readonly prerelease?: readonly string[] } | undefined {
  const normalized = value.trim().replace(/^v/iu, "").split("+", 1)[0] ?? "";
  const [coreText, prereleaseText] = normalized.split("-", 2);
  const coreParts = coreText.split(".");
  if (coreParts.length < 1 || coreParts.length > 3) {
    return undefined;
  }
  const parsed = coreParts.map((part) => {
    if (!/^(0|[1-9]\d*)$/u.test(part)) return undefined;
    return Number(part);
  });
  if (parsed.some((part) => part === undefined)) {
    return undefined;
  }
  const core: [number, number, number] = [
    parsed[0] ?? 0,
    parsed[1] ?? 0,
    parsed[2] ?? 0,
  ];
  const prerelease = prereleaseText === undefined
    ? undefined
    : prereleaseText.split(".").filter((part) => part.length > 0);
  return prerelease !== undefined && prerelease.length === 0 ? undefined : { core, prerelease };
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumber = numericPrereleasePart(leftPart);
    const rightNumber = numericPrereleasePart(rightPart);
    if (leftNumber !== undefined && rightNumber !== undefined) {
      const difference = leftNumber - rightNumber;
      if (difference !== 0) return Math.sign(difference);
      continue;
    }
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    const comparison = leftPart.localeCompare(rightPart);
    if (comparison !== 0) return Math.sign(comparison);
  }
  return 0;
}

function numericPrereleasePart(value: string): number | undefined {
  return /^(0|[1-9]\d*)$/u.test(value) ? Number(value) : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function defaultAppUpdateFetch(
  url: string,
  init: { readonly method: "GET"; readonly headers: Record<string, string>; readonly signal?: AbortSignal }
): Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}> {
  return fetch(url, init);
}
