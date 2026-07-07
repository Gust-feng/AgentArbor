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

const DEFAULT_BROWSER_TEXT_CHARS = 64_000;
const MAX_BROWSER_TEXT_CHARS = 128_000;
const MAX_BROWSER_START_CHAR = 2_000_000;

export function createBrowserSnapshotTool(options: BrowserToolOptions = {}): ToolExecutor {
  const automation = options.automation ?? createPlaywrightBrowserAutomation();
  return {
    definition: {
      name: "browser_snapshot",
      description: "Open an HTTP or HTTPS page in a fresh Playwright browser session and return a text snapshot. Requires Playwright at runtime.",
      modelContract: {
        purpose: "Open an HTTP or HTTPS page in a fresh Playwright browser session and return the page title, final URL, and body text snapshot.",
        whenToUse: [
          "Use when a web page needs to be inspected beyond search snippets and the current rendered page text matters.",
          "Use for pages that need browser rendering but do not require the user's logged-in browser session.",
        ],
        whenNotToUse: [
          "Do not use for API endpoints, simple raw HTTP fetches, logged-in browser sessions, or interactive browser control; use http_request for raw HTTP and a real browser bridge for interactive browsing.",
          "Do not use for non-HTTP URLs.",
        ],
        inputNotes: [
          "url is required and must use http or https.",
          "waitMs optionally waits after load and is capped at 5000ms.",
          "maxTextChars optionally caps returned body text.",
          "startChar continues a truncated body text snapshot from a zero-based character offset.",
        ],
        outputNotes: [
          "result.url is the final page URL after navigation.",
          "result.title is the browser page title when available.",
          "result.text is the returned body text snapshot.",
          "result.hasMoreAfter/result.nextStartChar provide the continuation point when truncated is true.",
          "result.reachedStartCharCeiling=true means there is more text beyond the supported continuation window and no nextStartChar will be returned.",
          "truncated tells whether the body text was capped.",
        ],
        runtimeHints: [
          { label: "browser engine", value: "Playwright Chromium when available" },
          { label: "session state", value: "fresh isolated browser session; no existing login state" },
          { label: "max text chars", value: String(MAX_BROWSER_TEXT_CHARS) },
          { label: "max startChar", value: String(MAX_BROWSER_START_CHAR) },
        ],
        examples: [
          { title: "Read rendered page text", input: { url: "https://example.com", waitMs: 500, maxTextChars: 12000 } },
        ],
      },
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
          maxTextChars: { type: "number", description: "Optional maximum text characters to return." },
          startChar: { type: "number", description: "Zero-based body text offset for continuing a truncated snapshot." },
        },
        required: ["url"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const url = requireHttpUrl(record.url);
      const waitMs = Math.min(5_000, positiveInteger(record.waitMs) ?? 500);
      const maxTextChars = Math.min(MAX_BROWSER_TEXT_CHARS, positiveInteger(record.maxTextChars) ?? DEFAULT_BROWSER_TEXT_CHARS);
      const startChar = Math.min(MAX_BROWSER_START_CHAR, nonNegativeInteger(record.startChar) ?? 0);
      const snapshot = await automation.snapshot({
        url,
        waitMs,
        maxTextChars: Math.min(MAX_BROWSER_START_CHAR + MAX_BROWSER_TEXT_CHARS + 1, startChar + maxTextChars + 1),
        abortSignal: context.abortSignal,
      });
      const fullText = snapshot.text ?? "";
      const text = fullText.slice(startChar, startChar + maxTextChars);
      const hasMoreAfter = fullText.length > startChar + text.length;
      const rawNextStartChar = hasMoreAfter ? startChar + text.length : undefined;
      const nextStartChar = rawNextStartChar !== undefined && rawNextStartChar <= MAX_BROWSER_START_CHAR
        ? rawNextStartChar
        : undefined;
      const reachedStartCharCeiling = hasMoreAfter && nextStartChar === undefined;
      return {
        action: "browser_snapshot",
        status: "completed",
        refId: `browser:page:${safeRefToken(snapshot.url)}`,
        summary: `${snapshot.title ?? "浏览器页面"} · ${snapshot.url}`,
        result: {
          url: snapshot.url,
          title: snapshot.title,
          text,
          startChar,
          textChars: text.length,
          totalTextChars: fullText.length,
          hasMoreAfter,
          nextStartChar,
          reachedStartCharCeiling,
          startCharCeiling: MAX_BROWSER_START_CHAR,
        },
        truncated: hasMoreAfter,
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

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
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
