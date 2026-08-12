declare module "*.svg" {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_AGENTARBOR_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.svg?raw" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}

interface Window {
  readonly agentarborDesktop?: {
    readonly getLocalPreference: (key: string) => string | undefined;
    readonly setLocalPreference: (key: string, value: string) => boolean;
    readonly getStartupThemeSnapshot: () => {
      readonly styleId: "default" | "classic" | "glass";
      readonly colorId: "system" | "light" | "dark" | "warm" | "forest" | "slate" | "aurora" | "sunset" | "ocean";
      readonly backgroundColor: string;
      readonly shellColor: string;
      readonly borderColor: string;
      readonly textColor: string;
      readonly mainWindow: {
        readonly width: number;
        readonly height: number;
      };
    };
    readonly expandStartupWindow: (options?: { readonly reducedMotion?: boolean }) => Promise<{
      readonly durationMs: number;
      readonly nativeExpanded: boolean;
      readonly startupRect: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly targetWindow: {
        readonly width: number;
        readonly height: number;
      };
    }>;
    readonly beginStartupWindowExpansion: () => Promise<{
      readonly started: boolean;
      readonly durationMs: number;
    }>;
    readonly consumeStartupAnimation: () => boolean;
    readonly notifyStartupOverlayReady: () => void;
    readonly notifyStartupMainReady: () => void;
    readonly notifyStartupMainHandoffVisible: () => void;
    readonly notifyStartupRendererFrameStats: (stats: {
      readonly frameCount: number;
      readonly maxFrameMs: number;
      readonly maxFrameAtMs: number;
      readonly averageFrameMs: number;
      readonly totalMs: number;
      readonly visual?: {
        readonly sampleCount: number;
        readonly shellNodeMax: number;
        readonly missingOverlayCount: number;
        readonly missingFrameCount: number;
        readonly missingTextCount: number;
        readonly duplicateHeadingVisibleCount: number;
        readonly visibleChromeDuringExpansionCount: number;
        readonly overlayBackgroundOpaqueCount: number;
        readonly seenExpandingOpaqueSurface: boolean;
        readonly seenExpandingTransparentSurface: boolean;
        readonly titleHandoffSampleCount: number;
        readonly titleHandoffOpaqueSurfaceCount: number;
        readonly titleHandoffMaxCenterErrorPx: number;
        readonly titleHandoffMaxSizeErrorPx: number;
        readonly titleHandoffMinCenterErrorPx: number;
        readonly titleHandoffLastCenterErrorPx: number;
        readonly titleHandoffLastSizeErrorPx: number;
      };
    }) => void;
    readonly getWindowState: () => Promise<{
      readonly maximized: boolean;
      readonly animating: boolean;
    }>;
    readonly onWindowStateChanged: (callback: (state: {
      readonly maximized: boolean;
      readonly animating: boolean;
    }) => void) => () => void;
    readonly minimizeWindow: () => void;
    readonly toggleMaximizeWindow: () => void;
    readonly closeWindow: () => void;
  };
}