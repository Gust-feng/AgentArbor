import { readAgentArborPackageVersion } from "./product-info.js";
import type {
  AppUpdateCheckInput,
  AppUpdateInfo,
  AppUpdateManifest,
  AppUpdateProgress,
  AppUpdateServiceLike,
  AppUpdateStatus,
} from "./app-update-service.js";

export type ElectronUpdaterUpdateInfo = {
  readonly version?: string;
  readonly releaseName?: string;
  readonly releaseDate?: string;
  readonly releaseNotes?: unknown;
  readonly path?: string;
  readonly files?: readonly { readonly url?: string; readonly sha512?: string }[];
};

export type ElectronUpdaterDownloadProgress = {
  readonly percent?: number;
  readonly transferred?: number;
  readonly total?: number;
  readonly bytesPerSecond?: number;
};

export type ElectronUpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "checking-for-update", listener: () => void): ElectronUpdaterLike;
  on(event: "update-available", listener: (info: ElectronUpdaterUpdateInfo) => void): ElectronUpdaterLike;
  on(event: "update-not-available", listener: (info: ElectronUpdaterUpdateInfo) => void): ElectronUpdaterLike;
  on(event: "download-progress", listener: (progress: ElectronUpdaterDownloadProgress) => void): ElectronUpdaterLike;
  on(event: "update-downloaded", listener: (info: ElectronUpdaterUpdateInfo) => void): ElectronUpdaterLike;
  on(event: "error", listener: (error: Error) => void): ElectronUpdaterLike;
};

export type ElectronAppUpdateServiceOptions = {
  readonly updater: ElectronUpdaterLike;
  readonly currentVersion?: string;
  readonly enabled?: boolean;
  readonly runtime?: "electron" | "unsupported";
  readonly reason?: string;
};

export class ElectronAppUpdateService implements AppUpdateServiceLike {
  private current: AppUpdateInfo;
  private checkPromise: Promise<AppUpdateInfo> | undefined;
  private downloadPromise: Promise<AppUpdateInfo> | undefined;
  private installed = false;

  constructor(private readonly options: Required<Pick<ElectronAppUpdateServiceOptions, "currentVersion" | "enabled" | "runtime">> & ElectronAppUpdateServiceOptions) {
    this.current = {
      ok: true,
      status: options.enabled ? "idle" : "unsupported",
      runtime: options.runtime,
      currentVersion: options.currentVersion,
      manifestUrlConfigured: options.enabled,
      canCheck: options.enabled,
      canInstall: false,
      ...(options.reason === undefined ? {} : { errorSummary: options.reason }),
    };

    this.options.updater.autoDownload = false;
    this.options.updater.autoInstallOnAppQuit = false;
    this.registerUpdaterEvents();
  }

  status(): AppUpdateInfo {
    return this.current;
  }

  async check(_input: AppUpdateCheckInput = {}): Promise<AppUpdateInfo> {
    if (!this.options.enabled) {
      return this.current;
    }
    if (this.checkPromise !== undefined) {
      return this.checkPromise;
    }
    this.current = {
      ...this.current,
      ok: true,
      status: "checking",
      canCheck: true,
      canInstall: false,
      checkedAt: new Date().toISOString(),
      downloadedAt: undefined,
      progress: undefined,
      errorSummary: undefined,
    };
    this.checkPromise = this.runCheck().finally(() => {
      this.checkPromise = undefined;
    });
    return this.checkPromise;
  }

  async install(): Promise<AppUpdateInfo> {
    if (!this.options.enabled) {
      return this.current;
    }
    if (this.current.status !== "downloaded") {
      this.current = {
        ...this.current,
        ok: false,
        status: "failed",
        canInstall: false,
        errorSummary: "更新尚未下载完成，不能安装。",
      };
      return this.current;
    }
    this.current = {
      ...this.current,
      ok: true,
      status: "installing",
      canCheck: false,
      canInstall: false,
      errorSummary: undefined,
    };
    this.installed = true;
    this.options.updater.quitAndInstall(false, true);
    return this.current;
  }

  private async runCheck(): Promise<AppUpdateInfo> {
    try {
      await this.options.updater.checkForUpdates();
      return this.current;
    } catch (error) {
      return this.recordFailure(error instanceof Error ? error.message : "自动更新检查失败。");
    }
  }

  private async downloadLatest(): Promise<AppUpdateInfo> {
    if (this.downloadPromise !== undefined) {
      return this.downloadPromise;
    }
    this.current = {
      ...this.current,
      ok: true,
      status: "downloading",
      canCheck: false,
      canInstall: false,
      progress: emptyProgress(),
      errorSummary: undefined,
    };
    this.downloadPromise = this.options.updater.downloadUpdate()
      .then(() => this.current)
      .catch((error: unknown) => this.recordFailure(error instanceof Error ? error.message : "自动更新下载失败。"))
      .finally(() => {
        this.downloadPromise = undefined;
      });
    return this.downloadPromise;
  }

  private registerUpdaterEvents(): void {
    this.options.updater.on("checking-for-update", () => {
      if (!this.options.enabled) return;
      this.current = {
        ...this.current,
        ok: true,
        status: "checking",
        canCheck: true,
        canInstall: false,
        checkedAt: new Date().toISOString(),
        errorSummary: undefined,
      };
    });

    this.options.updater.on("update-not-available", (info) => {
      if (!this.options.enabled) return;
      this.current = {
        ...this.current,
        ok: true,
        status: "up_to_date",
        canCheck: true,
        canInstall: false,
        checkedAt: new Date().toISOString(),
        latest: updateManifestFromElectronInfo(info),
        progress: undefined,
        errorSummary: undefined,
      };
    });

    this.options.updater.on("update-available", (info) => {
      if (!this.options.enabled) return;
      this.current = {
        ...this.current,
        ok: true,
        status: "available",
        canCheck: false,
        canInstall: false,
        latest: updateManifestFromElectronInfo(info),
        progress: undefined,
        errorSummary: undefined,
      };
      void this.downloadLatest();
    });

    this.options.updater.on("download-progress", (progress) => {
      if (!this.options.enabled) return;
      this.current = {
        ...this.current,
        ok: true,
        status: "downloading",
        canCheck: false,
        canInstall: false,
        progress: normalizeProgress(progress),
        errorSummary: undefined,
      };
    });

    this.options.updater.on("update-downloaded", (info) => {
      if (!this.options.enabled || this.installed) return;
      this.current = {
        ...this.current,
        ok: true,
        status: "downloaded",
        canCheck: false,
        canInstall: true,
        downloadedAt: new Date().toISOString(),
        latest: updateManifestFromElectronInfo(info, this.current.latest),
        progress: completeProgress(this.current.progress),
        errorSummary: undefined,
      };
    });

    this.options.updater.on("error", (error) => {
      if (!this.options.enabled) return;
      this.recordFailure(error.message);
    });
  }

  private recordFailure(errorSummary: string): AppUpdateInfo {
    this.current = {
      ...this.current,
      ok: false,
      status: "failed",
      canCheck: this.options.enabled,
      canInstall: false,
      errorSummary,
    };
    return this.current;
  }
}

export function createElectronAppUpdateService(options: ElectronAppUpdateServiceOptions): ElectronAppUpdateService {
  return new ElectronAppUpdateService({
    ...options,
    currentVersion: options.currentVersion ?? readAgentArborPackageVersion(),
    enabled: options.enabled ?? true,
    runtime: options.runtime ?? (options.enabled === false ? "unsupported" : "electron"),
  });
}

function updateManifestFromElectronInfo(
  info: ElectronUpdaterUpdateInfo,
  fallback?: AppUpdateManifest
): AppUpdateManifest {
  const version = optionalString(info.version) ?? fallback?.version ?? "unknown";
  const downloadUrl = firstElectronFileUrl(info.files) ?? optionalString(info.path) ?? fallback?.downloadUrl;
  return {
    version,
    releaseDate: optionalString(info.releaseDate) ?? fallback?.releaseDate,
    notes: normalizeElectronReleaseNotes(info.releaseNotes) ?? fallback?.notes,
    ...(downloadUrl === undefined ? {} : { downloadUrl }),
  };
}

function normalizeElectronReleaseNotes(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const notes = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item !== null && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return optionalString(record.note) ?? optionalString(record.notes);
        }
        return undefined;
      })
      .filter((item): item is string => item !== undefined && item.trim().length > 0);
    return notes.length === 0 ? undefined : notes.join("\n");
  }
  return undefined;
}

function firstElectronFileUrl(files: readonly { readonly url?: string }[] | undefined): string | undefined {
  if (files === undefined) return undefined;
  for (const file of files) {
    const url = optionalString(file.url);
    if (url !== undefined) return url;
  }
  return undefined;
}

function normalizeProgress(progress: ElectronUpdaterDownloadProgress): AppUpdateProgress {
  return {
    percent: finiteNumber(progress.percent),
    transferredBytes: finiteNumber(progress.transferred),
    totalBytes: finiteNumber(progress.total),
    bytesPerSecond: finiteNumber(progress.bytesPerSecond),
  };
}

function emptyProgress(): AppUpdateProgress {
  return {
    percent: 0,
    transferredBytes: 0,
    totalBytes: 0,
    bytesPerSecond: 0,
  };
}

function completeProgress(progress: AppUpdateProgress | undefined): AppUpdateProgress | undefined {
  if (progress === undefined) {
    return undefined;
  }
  return {
    ...progress,
    percent: 100,
  };
}

function finiteNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
