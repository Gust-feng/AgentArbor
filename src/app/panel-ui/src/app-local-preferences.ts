export function readLocalPreference(key: string): string | undefined {
  const desktopValue = readDesktopLocalPreference(key);
  if (desktopValue !== undefined) return desktopValue;
  if (typeof localStorage === "undefined") return undefined;
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeLocalPreference(key: string, value: string): void {
  writeDesktopLocalPreference(key, value);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Browser storage is best-effort; desktop builds persist through the preload bridge.
  }
}

function readDesktopLocalPreference(key: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.agentarborDesktop?.getLocalPreference(key);
  } catch {
    return undefined;
  }
}

function writeDesktopLocalPreference(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.agentarborDesktop?.setLocalPreference(key, value);
  } catch {
    // Desktop preference persistence is best-effort and falls back to localStorage.
  }
}
