import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { applyMotionPreference } from "./app-motion";
import { startPanelResponsivenessDiagnostics } from "./app-responsiveness-diagnostics";
import { panelQueryClient } from "./panel-query-client";
import { scheduleOfficePreviewWarmup } from "./personal-workbench/workbench/app/components/officePreviewRuntime";
import "./personal-workbench/workbench/styles/index.css";

applyMotionPreference();
startPanelResponsivenessDiagnostics();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <QueryClientProvider client={panelQueryClient}>
      <App />
    </QueryClientProvider>
  </ErrorBoundary>
);

scheduleOfficePreviewWarmup();
