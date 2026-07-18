import { readLocalPreference, writeLocalPreference } from "./app-local-preferences";

export const DATA_COMPATIBILITY_NOTICE_KEY = "agentarbor.panel.notice.ordinary-run-v3";

export function isDataCompatibilityNoticeDismissed(): boolean {
  return readLocalPreference(DATA_COMPATIBILITY_NOTICE_KEY) === "dismissed";
}

export function dismissDataCompatibilityNotice(): void {
  writeLocalPreference(DATA_COMPATIBILITY_NOTICE_KEY, "dismissed");
}
