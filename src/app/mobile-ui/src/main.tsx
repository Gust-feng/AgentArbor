import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { RemoteMobileClient } from "./remote-client";
import { createIndexedDbMobileRemoteStorage } from "./storage";
import "./styles.css";

// Apply the system surface before React mounts. The native SplashScreen and
// the first WebView frame then agree on light/dark mode instead of flashing a
// light canvas while useMobileTheme's effect runs.
const initialMobileTheme = typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-color-scheme: dark)").matches
  ? "dark"
  : "light";
document.documentElement.dataset.theme = initialMobileTheme;
document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
  "content",
  initialMobileTheme === "dark" ? "#181916" : "#f4f2ef",
);

const root = createRoot(document.getElementById("root")!);

async function createClient(): Promise<RemoteMobileClient> {
  const isDevelopmentDemo = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("runtime") !== "1";
  document.documentElement.dataset.mobileDemo = isDevelopmentDemo ? "true" : "false";
  if (isDevelopmentDemo) {
    const { DemoRemoteClient } = await import("./demo-client");
    return new DemoRemoteClient();
  }
  return new RemoteMobileClient(createIndexedDbMobileRemoteStorage());
}

void createClient().then((client) => {
  root.render(<StrictMode><App client={client} /></StrictMode>);
});
