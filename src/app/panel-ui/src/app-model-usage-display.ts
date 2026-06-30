const STORAGE_MODEL_USAGE_DISPLAY_KEY = "agentarbor:model-usage-display";

export const MODEL_USAGE_DISPLAY_CHANGED_EVENT = "agentarbor:model-usage-display-changed";

export function getModelUsageDisplayEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_MODEL_USAGE_DISPLAY_KEY) === "true";
  } catch {
    // Local UI preferences are best-effort only.
    return false;
  }
}

export function saveModelUsageDisplayEnabled(enabled: boolean): void {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_MODEL_USAGE_DISPLAY_KEY, enabled ? "true" : "false");
    } catch {
      // Local UI preferences are best-effort only.
    }
  }
  dispatchModelUsageDisplayChanged();
}

export function subscribeModelUsageDisplayChanged(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(MODEL_USAGE_DISPLAY_CHANGED_EVENT, callback);
  return () => window.removeEventListener(MODEL_USAGE_DISPLAY_CHANGED_EVENT, callback);
}

function dispatchModelUsageDisplayChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MODEL_USAGE_DISPLAY_CHANGED_EVENT));
}
