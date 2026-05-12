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
} as const;

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
  if (pathname === "/assets/panel.js") {
    return {
      contentType: "text/javascript; charset=utf-8",
      body: readPanelAsset(PANEL_ASSET_NAMES.js),
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

function readPanelAsset(assetName: typeof PANEL_ASSET_NAMES[keyof typeof PANEL_ASSET_NAMES]): string {
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
