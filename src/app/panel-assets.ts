import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PanelStaticAsset = {
  readonly contentType: string;
  readonly body: string;
};

const PANEL_ASSET_NAMES = {
  html: "index.html",
  css: "panel.css",
  js: "panel.js",
  apiClient: "api-client.js",
  state: "state.js",
  toolDisplayRenderer: "tool-display-renderer.js",
} as const;

const PANEL_JS_ASSETS = new Set<string>([
  PANEL_ASSET_NAMES.js,
  PANEL_ASSET_NAMES.apiClient,
  PANEL_ASSET_NAMES.state,
  PANEL_ASSET_NAMES.toolDisplayRenderer,
]);

export function createPanelHtml(): string {
  return readPanelAsset(PANEL_ASSET_NAMES.html);
}

export function readPanelStaticAsset(pathname: string): PanelStaticAsset | undefined {
  if (pathname === "/assets/panel.css") {
    return {
      contentType: "text/css; charset=utf-8",
      body: readPanelAsset(PANEL_ASSET_NAMES.css),
    };
  }
  const scriptAsset = panelScriptAssetName(pathname);
  if (scriptAsset !== undefined) {
    return {
      contentType: "text/javascript; charset=utf-8",
      body: readPanelAsset(scriptAsset),
    };
  }
  return undefined;
}

export function createPanelClientScript(): string {
  return readPanelAsset(PANEL_ASSET_NAMES.js);
}

export function createPanelStylesheet(): string {
  return readPanelAsset(PANEL_ASSET_NAMES.css);
}

function readPanelAsset(assetName: string): string {
  const assetPath = resolvePanelAssetPath(assetName);
  return readFileSync(assetPath, "utf8");
}

function resolvePanelAssetPath(assetName: string): string {
  for (const root of panelAssetRoots()) {
    const candidate = path.join(root, assetName);
    try {
      readFileSync(candidate);
      return candidate;
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Panel static asset not found: ${assetName}`);
}

function panelScriptAssetName(pathname: string): string | undefined {
  const prefix = "/assets/";
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  const assetName = pathname.slice(prefix.length);
  return PANEL_JS_ASSETS.has(assetName) ? assetName : undefined;
}

function panelAssetRoots(): readonly string[] {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(moduleDirectory, "panel-ui"),
    path.join(process.cwd(), "src", "app", "panel-ui"),
  ];
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { readonly code?: unknown }).code === "ENOENT";
}
