import React, { useEffect, useState } from "react";
import { getInitialTheme } from "../app-theme";
import type { ConfigResponse } from "../contracts/config";
import { ThemeSwitcher } from "./theme-switcher";

export function AppearanceSettings(props: { readonly config?: ConfigResponse }): React.ReactElement {
  const browserAppearance = useBrowserAppearanceSnapshot();
  const configuredAppearance = props.config?.appearance;
  const documentColorScheme = configuredAppearance?.colorScheme ?? browserAppearance.documentColorScheme;
  const [initialTheme] = useState(() => getInitialTheme());
  const [currentStyleId, setCurrentStyleId] = useState(initialTheme.styleId);
  const [currentColorId, setCurrentColorId] = useState(initialTheme.colorId);
  return (
    <div className="workspace-settings-stack">
      <ThemeSwitcher
        activeStyleId={currentStyleId}
        activeColorId={currentColorId}
        onStyleChange={setCurrentStyleId}
        onColorChange={setCurrentColorId}
      />
      <section className="settings-card">
        <h3>当前环境</h3>
        <div className="settings-row">
          <span>主题来源</span>
          <div><span className="settings-value">本机偏好，立即生效</span></div>
        </div>
        <div className="settings-row">
          <span>文档色彩方案</span>
          <div><span className="settings-value">{colorSchemeLabel(documentColorScheme)}</span></div>
        </div>
        <div className="settings-row">
          <span>系统偏好</span>
          <div><span className="settings-value">{colorSchemeLabel(browserAppearance.systemColorPreference)}</span></div>
        </div>
        <div className="settings-row">
          <span>界面密度</span>
          <div><span className="settings-value">{configuredAppearance?.densityLabel ?? "标准"}</span></div>
        </div>
      </section>
    </div>
  );
}

type BrowserAppearanceSnapshot = {
  readonly documentColorScheme: string;
  readonly systemColorPreference: "light" | "dark" | "unknown";
};

function useBrowserAppearanceSnapshot(): BrowserAppearanceSnapshot {
  const [snapshot, setSnapshot] = useState<BrowserAppearanceSnapshot>(() => readBrowserAppearanceSnapshot());
  useEffect(() => {
    setSnapshot(readBrowserAppearanceSnapshot());
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setSnapshot(readBrowserAppearanceSnapshot());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return snapshot;
}

function readBrowserAppearanceSnapshot(): BrowserAppearanceSnapshot {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { documentColorScheme: "unknown", systemColorPreference: "unknown" };
  }
  const documentColorScheme = window.getComputedStyle(document.documentElement).colorScheme.trim() || "unknown";
  const systemColorPreference = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  return { documentColorScheme, systemColorPreference };
}

function colorSchemeLabel(value: string | undefined): string {
  if (value === "light") return "浅色";
  if (value === "dark") return "深色";
  if (value === undefined || value === "unknown") return "未声明";
  return value;
}
