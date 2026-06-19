import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { applyTheme, getInitialTheme } from "./app-theme";
import "./styles.css";

const { styleId, colorId } = getInitialTheme();
applyTheme(styleId, colorId);

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
