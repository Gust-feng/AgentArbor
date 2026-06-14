import type { ToolExecutor, ToolExecutionContext } from "../../../domain/tools/index.js";

export type FetchLike = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  }
) => Promise<FetchLikeResponse>;

export type FetchLikeResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
};

export type WebSearchToolOptions = {
  readonly apiKey?: string;
  readonly maxResults?: number;
  readonly fetch?: FetchLike;
};

export type WebSearchToolOutput = {
  readonly provider: "tavily" | "none";
  readonly status: "completed" | "no_search_provider" | "invalid_input" | "provider_failed";
  readonly searched: boolean;
  readonly query: string;
  readonly results: readonly {
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
  }[];
  readonly message?: string;
};

const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const DEFAULT_MAX_RESULTS = 5;

export function createWebSearchTool(options: WebSearchToolOptions = {}): ToolExecutor {
  return {
    definition: {
      name: "web_search",
      description: "Search the web for current information only when a real provider is configured. Without a provider, returns no_search_provider and does not claim a search occurred.",
      modelContract: {
        usageNotes: [
          "Use this for live/current web lookup only.",
          "If status is no_search_provider, no live web search was performed; tell the user or choose another available source.",
          "Do not treat an empty no_search_provider result as evidence that nothing exists on the web.",
        ],
        outputNotes: [
          "searched is true only when a provider request was attempted.",
          "status no_search_provider means the tool did not access the web.",
          "results contain provider snippets, not full page reads.",
        ],
      },
      metadata: {
        category: "web",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 800,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
    execute: (input, context) => executeWebSearch(input, context, options),
  };
}

async function executeWebSearch(
  input: unknown,
  _context: ToolExecutionContext,
  options: WebSearchToolOptions
): Promise<WebSearchToolOutput> {
  const query = queryFromInput(input);
  if (_context.abortSignal?.aborted === true) {
    return {
      provider: "none",
      status: "provider_failed",
      searched: false,
      query: "",
      results: [],
      message: "web_search was cancelled.",
    };
  }
  if (query === undefined) {
    return {
      provider: "none",
      status: "invalid_input",
      searched: false,
      query: "",
      results: [],
      message: "web_search requires a non-empty string query.",
    };
  }

  const fetchImpl = options.fetch ?? resolveGlobalFetch();
  const apiKey = normalizeOptionalString(options.apiKey);
  if (apiKey === undefined || fetchImpl === undefined) {
    return {
      provider: "none",
      status: "no_search_provider",
      searched: false,
      query,
      results: [],
      message: "No configured search provider; no live web search was performed. Set a Tavily API key to enable live search.",
    };
  }

  const maxResults = Math.max(1, Math.floor(options.maxResults ?? DEFAULT_MAX_RESULTS));
  const response = await fetchImpl(TAVILY_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "basic",
    }),
    signal: _context.abortSignal,
  });

  if (!response.ok) {
    return {
      provider: "tavily",
      status: "provider_failed",
      searched: true,
      query,
      results: [],
      message: `Tavily search returned HTTP ${response.status}.`,
    };
  }

  const raw = await response.json();
  return {
    provider: "tavily",
    status: "completed",
    searched: true,
    query,
    results: resultsFromTavily(raw).slice(0, maxResults),
  };
}

function queryFromInput(input: unknown): string | undefined {
  const record = asRecord(input);
  const value = record?.query;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function resultsFromTavily(raw: unknown): WebSearchToolOutput["results"] {
  const record = asRecord(raw);
  const results = Array.isArray(record?.results) ? record.results : [];
  return results.map((item) => {
    const result = asRecord(item);
    return {
      title: stringOrFallback(result?.title, "Untitled result"),
      url: stringOrFallback(result?.url, ""),
      snippet: stringOrFallback(result?.content ?? result?.snippet, ""),
    };
  });
}

function resolveGlobalFetch(): FetchLike | undefined {
  const fetchImpl = (globalThis as { fetch?: FetchLike }).fetch;
  return typeof fetchImpl === "function" ? fetchImpl : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return undefined;
}
