import { getJson, postJson } from "./api";
import type { AppUpdateInfo } from "./contracts/app-update";

export function loadAppUpdateStatus(): Promise<AppUpdateInfo> {
  return getJson<AppUpdateInfo>("/api/app/update");
}

export function checkAppUpdate(): Promise<AppUpdateInfo> {
  return postJson<AppUpdateInfo>("/api/app/update/check", {});
}

export function installAppUpdate(): Promise<AppUpdateInfo> {
  return postJson<AppUpdateInfo>("/api/app/update/install", {});
}