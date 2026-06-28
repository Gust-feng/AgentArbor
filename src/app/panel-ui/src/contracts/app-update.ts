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
