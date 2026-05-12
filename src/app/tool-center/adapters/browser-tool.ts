import type { ToolExecutor } from "../../../domain/tools/index.js";

export type BrowserAutomation = {
  snapshot(input: {
    readonly url: string;
    readonly waitMs: number;
    readonly maxTextChars: number;
    readonly abortSignal?: AbortSignal;
  }): Promise<BrowserSnapshotResult>;
};

export type BrowserSnapshotResult = {
  readonly url: string;
  readonly title?: string;
  readonly text?: string;
};

export type BrowserToolOptions = {
  readonly automation?: BrowserAutomation;
};

export function createBrowserSnapshotTool(options: BrowserToolOptions = {}): ToolExecutor {
  const automation = options.automation ?? createPlaywrightBrowserAutomation();
  return {
    definition: {
      name: "browser_snapshot",
      description: "Open a web page in a controlled browser and return a safe text snapshot. Requires Playwright at runtime.",
      metadata: {
        category: "web",
        riskLevel: "medium",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1_200,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "HTTP or HTTPS URL to open." },
          waitMs: { type: "number", description: "Optional wait time after page load, max 5000ms." },
          maxTextChars: { type: "number", description: "Optional safe text preview budget." },
        },
        required: ["url"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const url = requireHttpUrl(record.url);
      const waitMs = Math.min(5_000, positiveInteger(record.waitMs) ?? 500);
      const maxTextChars = Math.min(6_000, positiveInteger(record.maxTextChars) ?? 2_000);
      const snapshot = await automation.snapshot({ url, waitMs, maxTextChars, abortSignal: context.abortSignal });
      const text = truncateText(snapshot.text ?? "", maxTextChars);
      return {
        action: "browser_snapshot",
        status: "completed",
        refId: `browser:page:${safeRefToken(snapshot.url)}`,
        summary: `${snapshot.title ?? "浏览器页面"} · ${snapshot.url}`,
        result: {
          url: snapshot.url,
          title: snapshot.title,
          text,
        },
        truncated: (snapshot.text?.length ?? 0) > text.length,
      };
    },
  };
}

function createPlaywrightBrowserAutomation(): BrowserAutomation {
  return {
    async snapshot(input) {
      const playwright = await loadPlaywright();
      const browser = await playwright.chromium.launch({ headless: true });
      const abort = input.abortSignal;
      try {
        throwIfAborted(abort);
        const page = await browser.newPage();
        const abortPromise = new Promise<never>((_, reject) => {
          abort?.addEventListener("abort", () => reject(new Error("Browser tool cancelled.")), { once: true });
        });
        await Promise.race([
          page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 15_000 }),
          abortPromise,
        ]);
        if (input.waitMs > 0) {
          await Promise.race([page.waitForTimeout(input.waitMs), abortPromise]);
        }
        const [url, title, text] = await Promise.all([
          page.url(),
          page.title().catch(() => undefined),
          page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""),
        ]);
        return {
          url,
          title,
          text: truncateText(text, input.maxTextChars),
        };
      } finally {
        await browser.close().catch(() => undefined);
      }
    },
  };
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<PlaywrightModule>;
    return await dynamicImport("playwright");
  } catch {
    throw new Error("browser_snapshot requires Playwright to be installed and available in this workspace.");
  }
}

type PlaywrightModule = {
  readonly chromium: {
    launch(options: { readonly headless: boolean }): Promise<{
      newPage(): Promise<{
        goto(url: string, options: { readonly waitUntil: "domcontentloaded"; readonly timeout: number }): Promise<unknown>;
        waitForTimeout(ms: number): Promise<void>;
        title(): Promise<string>;
        url(): string;
        locator(selector: string): {
          innerText(options: { readonly timeout: number }): Promise<string>;
        };
      }>;
      close(): Promise<void>;
    }>;
  };
};

function requireHttpUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("url must be an HTTP or HTTPS URL.");
  }
  const text = value.trim();
  const parsed = new URL(text);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("browser_snapshot only accepts HTTP or HTTPS URLs.");
  }
  return parsed.toString();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("Browser tool cancelled.");
  }
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function safeRefToken(value: string): string {
  const token = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return token.length === 0 ? "page" : token;
}
