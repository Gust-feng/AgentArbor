import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { applyTheme, getInitialTheme } from "./app-theme";
import { applyMotionPreference, applyStartupAnimationPreference } from "./app-motion";
import { panelQueryClient } from "./panel-query-client";
import "./styles.css";

applyMotionPreference();
applyStartupAnimationPreference();

const startupTheme = window.agentarborDesktop?.getStartupThemeSnapshot();
const { styleId, colorId } = startupTheme ?? getInitialTheme();
applyTheme(styleId, colorId);
if (startupTheme !== undefined) {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--startup-intro-shell-bg", startupTheme.backgroundColor);
  rootStyle.setProperty("--startup-intro-title-color", startupTheme.textColor);
}

if (window.agentarborDesktop !== undefined) {
  document.documentElement.dataset.desktopShell = "true";
}

const startupMode = new URLSearchParams(window.location.search).get("agentarborStartup");
if (startupMode === "main") {
  document.documentElement.dataset.desktopStartupMode = startupMode;
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <QueryClientProvider client={panelQueryClient}>
      <App />
    </QueryClientProvider>
  </ErrorBoundary>
);
