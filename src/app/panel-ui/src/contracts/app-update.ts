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