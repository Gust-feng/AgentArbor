import { readAgentArborPackageVersion } from "./product-info.js";

export type AppUpdateStatus =
  | "unsupported"
  | "unconfigured"
  | "no_release"
  | "idle"
  | "checking"
  | "downloading"
  | "downloaded"
  | "installing"
  | "up_to_date"
  | "available"
  | "failed";

export type AppUpdateRuntime = "manifest" | "electron" | "unsupported";

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
  readonly runtime: AppUpdateRuntime;
  readonly currentVersion: string;
  readonly manifestUrlConfigured: boolean;
  readonly canCheck: boolean;
  readonly canInstall: boolean;
  readonly checkedAt?: string;
  readonly downloadedAt?: string;
  readonly latest?: AppUpdateManifest;
  readonly progress?: AppUpdateProgress;
  readonly errorSummary?: string;
};

export type AppUpdateProgress = {
  readonly percent: number;
  readonly transferredBytes: number;
  readonly totalBytes: number;
  readonly bytesPerSecond: number;
};

export type AppUpdateCheckInput = {
  readonly signal?: AbortSignal;
};

export interface AppUpdateServiceLike {
  status(): AppUpdateInfo;
  check(input?: AppUpdateCheckInput): Promise<AppUpdateInfo>;
  install(): Promise<AppUpdateInfo>;
}

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

export class ManifestAppUpdateService implements AppUpdateServiceLike {
  private current: AppUpdateInfo;

  constructor(private readonly options: Required<Pick<AppUpdateServiceOptions, "currentVersion">> & AppUpdateServiceOptions) {
    const manifestUrlConfigured = normalizeManifestUrl(options.manifestUrl) !== undefined;
    this.current = {
      ok: true,
      status: manifestUrlConfigured ? "idle" : "unconfigured",
      runtime: "manifest",
      currentVersion: options.currentVersion,
      manifestUrlConfigured,
      canCheck: manifestUrlConfigured,
      canInstall: false,
    };
  }

  status(): AppUpdateInfo {
    return this.current;
  }

  async check(input: AppUpdateCheckInput = {}): Promise<AppUpdateInfo> {
    const manifestUrl = normalizeManifestUrl(this.options.manifestUrl);
    if (manifestUrl === undefined) {
      this.current = {
        ok: true,
        status: "unconfigured",
        runtime: "manifest",
        currentVersion: this.options.currentVersion,
        manifestUrlConfigured: false,
        canCheck: false,
        canInstall: false,
      };
      return this.current;
    }

    this.current = {
      ...this.current,
      ok: true,
      status: "checking",
      runtime: "manifest",
      manifestUrlConfigured: true,
      canCheck: true,
      canInstall: false,
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
            runtime: "manifest",
            currentVersion: this.options.currentVersion,
            manifestUrlConfigured: true,
            canCheck: true,
            canInstall: false,
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
      const updateAvailable = comparison > 0;
      this.current = {
        ok: true,
        status: updateAvailable ? "available" : "up_to_date",
        runtime: "manifest",
        currentVersion: this.options.currentVersion,
        manifestUrlConfigured: true,
        canCheck: true,
        canInstall: false,
        checkedAt,
        ...(updateAvailable ? { latest: manifest } : {}),
      };
      return this.current;
    } catch (error) {
      if (isAbortError(error)) {
        return this.recordFailure("更新检查已取消。", checkedAt);
      }
      return this.recordFailure(error instanceof Error ? error.message : "更新检查失败。", checkedAt);
    }
  }

  async install(): Promise<AppUpdateInfo> {
    this.current = {
      ...this.current,
      ok: false,
      status: "failed",
      canInstall: false,
      errorSummary: "当前运行方式只能检查发布信息，不能自动安装更新。",
    };
    return this.current;
  }

  private recordFailure(errorSummary: string, checkedAt: string): AppUpdateInfo {
    this.current = {
      ok: false,
      status: "failed",
      runtime: "manifest",
      currentVersion: this.options.currentVersion,
      manifestUrlConfigured: normalizeManifestUrl(this.options.manifestUrl) !== undefined,
      canCheck: normalizeManifestUrl(this.options.manifestUrl) !== undefined,
      canInstall: false,
      checkedAt,
      errorSummary,
    };
    return this.current;
  }
}

export class UnsupportedAppUpdateService implements AppUpdateServiceLike {
  private readonly current: AppUpdateInfo;

  constructor(input: { readonly currentVersion?: string; readonly reason?: string } = {}) {
    this.current = {
      ok: true,
      status: "unsupported",
      runtime: "unsupported",
      currentVersion: input.currentVersion ?? readAgentArborPackageVersion(),
      manifestUrlConfigured: false,
      canCheck: false,
      canInstall: false,
      errorSummary: input.reason,
    };
  }

  status(): AppUpdateInfo {
    return this.current;
  }

  async check(): Promise<AppUpdateInfo> {
    return this.current;
  }

  async install(): Promise<AppUpdateInfo> {
    return this.current;
  }
}

export function createAppUpdateService(options: AppUpdateServiceOptions = {}): ManifestAppUpdateService {
  return new ManifestAppUpdateService({
    ...options,
    currentVersion: options.currentVersion ?? readAgentArborPackageVersion(),
  });
}

export function createUnsupportedAppUpdateService(input: { readonly currentVersion?: string; readonly reason?: string } = {}): UnsupportedAppUpdateService {
  return new UnsupportedAppUpdateService(input);
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
