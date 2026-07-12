import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  InformationSourceCapability,
  InformationAccessStatus,
  ResearchErrorFacts,
  InformationSourceKind,
  ReadResultRef,
  SearchResultRef,
} from "../../domain/research/index.js";
import type { ReadonlySoilStore } from "../../domain/soil/index.js";
import {
  createHttpStatusErrorFacts,
  createHttpTimeoutCause,
  normalizeHttpRequestFailure,
  type HttpRequestErrorFacts,
} from "../tool-center/adapters/http-request-tool.js";
import { createWebSearchTool, type FetchLike as WebSearchFetchLike, type WebSearchProvider } from "../tool-center/adapters/web-search-tool.js";

export type InformationSourceSearchRequest = {
  readonly query: string;
  readonly site?: string;
  readonly limit: number;
  readonly traceId?: string;
  readonly goalId?: string;
  readonly abortSignal?: AbortSignal;
};

export type InformationSourceReadRequest = {
  readonly ref: string;
  readonly query?: string;
  readonly uri?: string;
  readonly title?: string;
  readonly maxLength: number;
  readonly startChar: number;
  readonly sourceResult?: SearchResultRef;
  readonly abortSignal?: AbortSignal;
};

export type InformationSourceSearchResponse = {
  readonly status: InformationAccessStatus;
  readonly results: readonly SearchResultRef[];
  readonly message?: string;
};

export type InformationSourceReadResponse = {
  readonly status: InformationAccessStatus;
  readonly result?: ReadResultRef;
  readonly message?: string;
  readonly errorFacts?: ResearchErrorFacts;
};

export interface InformationSourceAdapter {
  readonly source: InformationSourceKind;
  readonly capability?: Omit<InformationSourceCapability, "source" | "searchable" | "readable">;
  search?(request: InformationSourceSearchRequest): Promise<InformationSourceSearchResponse>;
  read?(request: InformationSourceReadRequest): Promise<InformationSourceReadResponse>;
}

export type PageFetchLike = (
  url: string,
  init: {
    readonly method: "GET";
    readonly headers: Record<string, string>;
    readonly signal?: AbortSignal;
  }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  readonly text: () => Promise<string>;
}>;

export type CommandLogReadEntry = {
  readonly refId?: string;
  readonly title?: string;
  readonly uri?: string;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
};

export type CommandLogReadRegistry = {
  read(
    ref: string,
    request: {
      readonly maxLength: number;
      readonly startChar: number;
      readonly abortSignal?: AbortSignal;
    }
  ): Promise<CommandLogReadEntry | undefined> | CommandLogReadEntry | undefined;
};

const DEFAULT_PAGE_READ_TIMEOUT_MS = 15_000;
const MAX_PAGE_READ_TIMEOUT_MS = 120_000;

export function createWebInformationSourceAdapter(options: {
  readonly provider?: WebSearchProvider;
  readonly apiKey?: string;
  readonly fetch?: WebSearchFetchLike;
  readonly maxResults?: number;
  readonly endpoint?: string;
  readonly googleEngineId?: string;
  readonly tavilySearchDepth?: string;
  readonly exaSearchType?: string;
  readonly zaiSearchEngine?: string;
  readonly bingMarket?: string;
} = {}): InformationSourceAdapter {
  const provider = options.provider ?? "tavily";
  const tool = createWebSearchTool({
    provider,
    apiKey: options.apiKey,
    fetch: options.fetch,
    maxResults: options.maxResults,
    endpoint: options.endpoint,
    googleEngineId: options.googleEngineId,
    tavilySearchDepth: options.tavilySearchDepth,
    exaSearchType: options.exaSearchType,
    zaiSearchEngine: options.zaiSearchEngine,
    bingMarket: options.bingMarket,
  });
  const hasProvider =
    provider !== "none" &&
    stringOrUndefined(options.apiKey) !== undefined &&
    (options.fetch !== undefined || resolveGlobalWebSearchFetch() !== undefined) &&
    (provider !== "google" || stringOrUndefined(options.googleEngineId) !== undefined);
  return {
    source: "web",
    capability: {
      label: `${provider} web search`,
      modelVisible: hasProvider,
      unavailableReason: hasProvider ? undefined : "No configured web search provider is available.",
    },
    async search(request) {
      const providerQuery = searchQueryWithSite(request.query, request.site);
      const output = asRecord(
        await tool.execute(
          { query: providerQuery },
          {
            callerAgentId: "research-runtime",
            traceId: request.traceId ?? "research-trace",
            goalId: request.goalId ?? "research-goal",
            abortSignal: request.abortSignal,
          }
        )
      );
      const status = stringOrUndefined(output.status);
      if (status === "invalid_input") {
        return { status: "invalid-input", results: [], message: stringOrUndefined(output.message) };
      }
      if (status === "no_search_provider") {
        return { status: "no-provider", results: [], message: stringOrUndefined(output.message) };
      }
      if (status === "provider_failed") {
        return { status: "provider-failed", results: [], message: stringOrUndefined(output.message) };
      }

      const results = arrayItems(output.results).slice(0, request.limit).map((item, index) => {
        const record = asRecord(item);
        const uri = stringOrUndefined(record.url);
        const metadata: Readonly<Record<string, string | number | boolean>> =
          request.site === undefined ? { provider } : { provider, site: request.site };
        const publishedAt = stringOrUndefined(record.publishedAt);
        return {
          refId: createResearchRefId("web", `${providerQuery}:${uri ?? index}`),
          source: "web" as const,
          title: stringOrUndefined(record.title) ?? "Untitled web result",
          uri,
          snippet: truncate(normalizeWhitespace(stringOrUndefined(record.snippet) ?? ""), 320),
          status: uri === undefined ? "no-provider" as const : "available" as const,
          metadata: publishedAt === undefined ? metadata : { ...metadata, publishedAt },
        };
      });
      return {
        status: results.length > 0 ? "completed" : "empty",
        results,
      };
    },
  };
}

export function createPageInformationSourceAdapter(options: {
  readonly fetch?: PageFetchLike;
  readonly defaultMaxLength?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
} = {}): InformationSourceAdapter {
  return {
    source: "page",
    capability: {
      label: "HTTP/HTTPS page reader",
      modelVisible: options.fetch !== undefined || resolveGlobalPageFetch() !== undefined,
      unavailableReason: options.fetch !== undefined || resolveGlobalPageFetch() !== undefined
        ? undefined
        : "No fetch implementation is available for page reads.",
    },
    async read(request) {
      const uri = request.uri ?? request.ref;
      if (!isHttpUrl(uri)) {
        return {
          status: "invalid-input",
          message: "page read requires an http or https URL.",
        };
      }
      const fetchImpl = options.fetch ?? resolveGlobalPageFetch();
      if (fetchImpl === undefined) {
        return {
          status: "no-provider",
          message: "No fetch implementation is available for page reads.",
        };
      }
      const startedAt = Date.now();
      const timeoutMs = boundedPositiveInteger(
        options.defaultTimeoutMs,
        DEFAULT_PAGE_READ_TIMEOUT_MS,
        options.maxTimeoutMs ?? MAX_PAGE_READ_TIMEOUT_MS
      );
      const controller = new AbortController();
      const detachAbort = attachAbortForwarder(request.abortSignal, controller);
      const timeoutCause = createHttpTimeoutCause("page read", timeoutMs);
      const timeout = setTimeout(() => controller.abort(timeoutCause), timeoutMs);
      try {
        const response = await fetchImpl(uri, {
          method: "GET",
          headers: {
            accept: "text/html,text/plain;q=0.9,*/*;q=0.5",
            "user-agent": "AgentArbor-ResearchRuntime/0.1",
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          const facts = createHttpStatusErrorFacts({
            url: uri,
            method: "GET",
            durationMs: Date.now() - startedAt,
            statusCode: response.status,
            statusText: response.statusText,
          });
          return {
            status: "provider-failed",
            message: pageHttpStatusMessage(response.status, response.statusText),
            errorFacts: researchErrorFactsFromHttpRequest(facts),
          };
        }
        const rawPage = await response.text();
        const text = normalizeWhitespace(cleanPageText(rawPage));
        const maxLength = Math.max(200, request.maxLength || options.defaultMaxLength || 1_200);
        const window = contentWindow(text, request.startChar, maxLength);
        const refId = createResearchRefId("page", uri);
        return {
          status: "completed",
          result: {
            refId,
            source: "page",
            title: request.title ?? titleFromHtml(rawPage) ?? uri,
            uri,
            status: "completed",
            summary: truncate(window.contentPreview, 260),
            ...window,
            truncated: window.hasMoreAfter,
            sourceSearchRef: request.sourceResult?.refId,
            metadata: { contentLength: text.length },
          },
        };
      } catch (error) {
        const failure = normalizeHttpRequestFailure({
          error: controller.signal.aborted && controller.signal.reason === timeoutCause ? timeoutCause : error,
          url: uri,
          method: "GET",
          durationMs: Date.now() - startedAt,
        });
        return {
          status: "provider-failed",
          message: failure.message,
          errorFacts: researchErrorFactsFromHttpRequest(failure.facts),
        };
      } finally {
        clearTimeout(timeout);
        detachAbort();
      }
    },
  };
}

export function createCommandLogInformationSourceAdapter(options: {
  readonly registry?: CommandLogReadRegistry;
} = {}): InformationSourceAdapter {
  return {
    source: "command_log",
    capability: {
      label: "registered command logs",
      modelVisible: options.registry !== undefined,
      unavailableReason: options.registry === undefined
        ? "No command log registry is connected for read."
        : undefined,
    },
    async read(request) {
      if (!isCommandLogRef(request.ref)) {
        return {
          status: "invalid-input",
          message: "command log read requires a command-log://<id> ref.",
        };
      }
      const registry = options.registry;
      if (registry === undefined) {
        return {
          status: "no-provider",
          message: "No command log registry is connected for read.",
        };
      }
      const entry = await registry.read(request.ref, {
        maxLength: request.maxLength,
        startChar: request.startChar,
        abortSignal: request.abortSignal,
      });
      if (entry === undefined) {
        return {
          status: "invalid-input",
          message: "Unknown or unregistered command log ref.",
        };
      }
      const window = contentWindow(entry.content, request.startChar, request.maxLength);
      return {
        status: "completed",
        result: {
          refId: entry.refId ?? request.ref,
          source: "command_log",
          title: entry.title ?? `Command log ${commandLogId(request.ref)}`,
          uri: entry.uri ?? request.ref,
          status: "completed",
          summary: truncate(window.contentPreview, 260),
          ...window,
          truncated: window.hasMoreAfter,
          sourceSearchRef: request.sourceResult?.refId,
          metadata: {
            ...entry.metadata,
            refKind: "command_log",
          },
        },
      };
    },
  };
}

export function createCodebaseInformationSourceAdapter(options: {
  readonly rootDirectory?: string;
  readonly maxFiles?: number;
} = {}): InformationSourceAdapter {
  const rootDirectory = path.resolve(options.rootDirectory ?? process.cwd());
  const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? 800));
  return {
    source: "codebase",
    capability: {
      label: "local codebase text search",
      modelVisible: true,
    },
    async search(request) {
      const query = normalizeWhitespace(request.query);
      if (query.length === 0) {
        return { status: "invalid-input", results: [], message: "codebase search requires a query." };
      }
      const files = await collectTextFiles(rootDirectory, maxFiles);
      const queryLower = query.toLowerCase();
      const results: SearchResultRef[] = [];
      for (const file of files) {
        const text = await readTextFile(file);
        if (text === undefined) {
          continue;
        }
        const index = text.toLowerCase().indexOf(queryLower);
        if (index < 0) {
          continue;
        }
        const relativePath = toRepositoryPath(path.relative(rootDirectory, file));
        results.push({
          refId: createResearchRefId("codebase", relativePath),
          source: "codebase",
          title: relativePath,
          uri: `repo://${relativePath}`,
          snippet: snippetAround(text, index, query.length),
          status: "available",
          metadata: { path: relativePath },
        });
        if (results.length >= request.limit) {
          break;
        }
      }
      return {
        status: results.length > 0 ? "completed" : "empty",
        results,
      };
    },
    async read(request) {
      const relativePath = pathFromCodebaseReadRequest(request);
      if (relativePath === undefined) {
        return { status: "invalid-input", message: "codebase read requires a repository file ref or repo:// URI." };
      }
      const absolutePath = path.resolve(rootDirectory, relativePath);
      if (!isPathInside(rootDirectory, absolutePath)) {
        return { status: "invalid-input", message: "codebase read path escapes repository root." };
      }
      const text = await readTextFile(absolutePath);
      if (text === undefined) {
        return { status: "provider-failed", message: "codebase read could not read the requested text file." };
      }
      const normalized = normalizeWhitespace(text);
      const window = contentWindow(normalized, request.startChar, request.maxLength);
      const repoPath = toRepositoryPath(path.relative(rootDirectory, absolutePath));
      return {
        status: "completed",
        result: {
          refId: createResearchRefId("codebase-read", repoPath),
          source: "codebase",
          title: repoPath,
          uri: `repo://${repoPath}`,
          status: "completed",
          summary: truncate(window.contentPreview, 260),
          ...window,
          truncated: window.hasMoreAfter,
          sourceSearchRef: request.sourceResult?.refId,
          metadata: { path: repoPath },
        },
      };
    },
  };
}

export function createSoilInformationSourceAdapter(options: {
  readonly soilStore?: ReadonlySoilStore;
} = {}): InformationSourceAdapter {
  const hasProvider = hasSoilSearchRefs(options.soilStore);
  return createReadonlyRefSourceAdapter({
    source: "soil",
    label: "readonly Soil refs",
    modelVisible: hasProvider,
    unavailableReason: hasProvider ? undefined : "No readonly Soil refs are configured.",
    emptyStatus: hasProvider ? "empty" : "no-provider",
    emptyMessage:
      hasProvider
        ? "Readonly Soil store has no matching refs."
        : "No readonly Soil refs are configured for research.",
    items: () => {
      const soilStore = options.soilStore;
      if (soilStore === undefined) {
        return [];
      }
      return [
        ...soilStore.listConstraints().map((constraint) => ({
          id: constraint.id,
          title: `Constraint ${constraint.id}`,
          summary: `${constraint.level} ${constraint.enforcementGate} ${constraint.status}: ${constraint.statement}`,
          metadata: { kind: "constraint", status: constraint.status, level: constraint.level },
        })),
        ...soilStore.listCapabilityAssetRefs().map((ref) => ({
          id: ref.id,
          title: ref.id,
          summary: ref.summary,
          metadata: { kind: ref.kind },
        })),
        ...soilStore.listPathBiasRefs().map((ref) => ({
          id: ref.id,
          title: ref.id,
          summary: ref.summary,
          metadata: { kind: ref.kind },
        })),
      ];
    },
  });
}

export function createRunMemoryInformationSourceAdapter(options: {
  readonly soilStore?: ReadonlySoilStore;
} = {}): InformationSourceAdapter {
  return createReadonlyRefSourceAdapter({
    source: "run_memory",
    label: "historical run memory refs",
    modelVisible: false,
    unavailableReason: "Run Memory is not enabled in the current ordinary Agent tool contract.",
    emptyStatus: "no-provider",
    emptyMessage: "Run Memory is not enabled in the current ordinary Agent tool contract.",
    items: () =>
      options.soilStore?.listHistoricalRunRefs().map((ref) => ({
        id: ref.id,
        title: ref.id,
        summary: ref.summary,
        metadata: { kind: ref.kind },
      })) ?? [],
  });
}

export function createStubInformationSourceAdapter(
  source: Extract<InformationSourceKind, "docs" | "packages" | "github">
): InformationSourceAdapter {
  const label = source === "docs" ? "technical docs" : source === "packages" ? "package registry" : "GitHub";
  return {
    source,
    capability: {
      label,
      modelVisible: false,
      unavailableReason: `${label} provider is not connected in this MVP.`,
    },
    async search() {
      return {
        status: "stub",
        results: [],
        message: `${label} provider is a stub/no-provider in this MVP.`,
      };
    },
    async read(request) {
      return {
        status: "stub",
        result: {
          refId: createResearchRefId(source, request.ref),
          source,
          title: `${label} stub`,
          status: "stub",
          summary: `${label} provider is not connected in this MVP.`,
          startChar: request.startChar,
          contentChars: 0,
          charCount: 0,
          hasMoreAfter: false,
          truncated: false,
          sourceSearchRef: request.sourceResult?.refId,
        },
      };
    },
  };
}

function createReadonlyRefSourceAdapter(input: {
  readonly source: Extract<InformationSourceKind, "soil" | "run_memory">;
  readonly label: string;
  readonly modelVisible: boolean;
  readonly unavailableReason?: string;
  readonly emptyStatus: InformationAccessStatus;
  readonly emptyMessage: string;
  readonly items: () => readonly {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  }[];
}): InformationSourceAdapter {
  return {
    source: input.source,
    capability: {
      label: input.label,
      modelVisible: input.modelVisible,
      unavailableReason: input.unavailableReason,
    },
    async search(request) {
      const query = request.query.toLowerCase();
      const results = input.items()
        .filter((item) => `${item.id} ${item.title} ${item.summary}`.toLowerCase().includes(query))
        .slice(0, request.limit)
        .map((item) => ({
          refId: createResearchRefId(input.source, item.id),
          source: input.source,
          title: item.title,
          uri: item.id,
          snippet: truncate(normalizeWhitespace(item.summary), 320),
          status: "available" as const,
          metadata: item.metadata,
        }));
      return {
        status: results.length > 0 ? "completed" : input.emptyStatus,
        results,
        message: results.length > 0 ? undefined : input.emptyMessage,
      };
    },
    async read(request) {
      const item = input.items().find((candidate) => candidate.id === request.ref || request.ref.endsWith(hash(candidate.id)));
      if (item === undefined) {
        return {
          status: input.emptyStatus,
          message: input.emptyMessage,
        };
      }
      const window = contentWindow(item.summary, request.startChar, request.maxLength);
      return {
        status: "completed",
        result: {
          refId: createResearchRefId(input.source, item.id),
          source: input.source,
          title: item.title,
          uri: item.id,
          status: "completed",
          summary: truncate(item.summary, 260),
          ...window,
          truncated: window.hasMoreAfter,
          sourceSearchRef: request.sourceResult?.refId,
          metadata: item.metadata,
        },
      };
    },
  };
}

function pathFromCodebaseReadRequest(request: InformationSourceReadRequest): string | undefined {
  const metadataPath = request.sourceResult?.metadata?.path;
  if (typeof metadataPath === "string") {
    return metadataPath;
  }
  const uri = request.uri ?? request.ref;
  if (uri.startsWith("repo://")) {
    return uri.slice("repo://".length);
  }
  return uri.includes("://") || uri.startsWith("research:") ? undefined : uri;
}

function isCommandLogRef(value: string): boolean {
  return /^command-log:\/\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function commandLogId(ref: string): string {
  return ref.slice("command-log://".length);
}

function researchErrorFactsFromHttpRequest(facts: HttpRequestErrorFacts): ResearchErrorFacts {
  return compactResearchFacts({
    url: facts.url,
    method: facts.method,
    durationMs: facts.durationMs,
    code: facts.code,
    statusCode: facts.statusCode,
    statusText: facts.statusText,
    errno: facts.errno,
    syscall: facts.syscall,
    address: facts.address,
    port: facts.port,
    hostname: facts.hostname,
    timedOut: facts.timedOut,
    timeoutMs: facts.timeoutMs,
  });
}

function compactResearchFacts(facts: Readonly<Record<string, string | number | boolean | undefined>>): ResearchErrorFacts {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

async function collectTextFiles(root: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    if (files.length >= maxFiles) {
      return;
    }
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= maxFiles || shouldIgnoreEntry(entry.name)) {
        continue;
      }
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile() && isTextFileName(entry.name)) {
        files.push(child);
      }
    }
  };
  await walk(root);
  return files;
}

function shouldIgnoreEntry(name: string): boolean {
  return (
    name === ".git" ||
    name === "node_modules" ||
    name === "dist" ||
    name === ".runtime" ||
    name === "workspace" ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".gif")
  );
}

function isTextFileName(name: string): boolean {
  return /\.(?:ts|tsx|js|jsx|json|md|txt|yaml|yml|toml|html|css|svg)$/i.test(name);
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function isPathInside(root: string, child: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(child));
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function snippetAround(text: string, index: number, queryLength: number): string {
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + Math.max(queryLength, 1) + 180);
  return truncate(normalizeWhitespace(text.slice(start, end)), 320);
}

function createResearchRefId(source: string, value: string): string {
  return `research:${source}:${hash(value)}`;
}

function searchQueryWithSite(query: string, site: string | undefined): string {
  const normalizedSite = normalizeSiteConstraint(site);
  return normalizedSite === undefined ? query : `${query} site:${normalizedSite}`;
}

function normalizeSiteConstraint(value: string | undefined): string | undefined {
  const raw = stringOrUndefined(value);
  if (raw === undefined) {
    return undefined;
  }
  const withoutOperator = raw.replace(/^site:/i, "").trim();
  const candidate = hostnameFromUrl(withoutOperator) ?? withoutOperator.split(/[/?#]/u)[0]?.trim();
  if (candidate === undefined || candidate.length === 0 || /\s/u.test(candidate)) {
    return undefined;
  }
  return candidate.toLowerCase();
}

function hostnameFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.length > 0 ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function cleanPageText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function titleFromHtml(value: string): string | undefined {
  for (const pattern of [/<title\b[^>]*>([\s\S]*?)<\/title>/i, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i]) {
    const match = pattern.exec(value);
    const title = match?.[1] === undefined
      ? undefined
      : normalizeWhitespace(cleanPageText(match[1]));
    if (title !== undefined && title.length > 0) {
      return truncate(title, 90);
    }
  }
  return undefined;
}

function resolveGlobalPageFetch(): PageFetchLike | undefined {
  const fetchImpl = (globalThis as { fetch?: PageFetchLike }).fetch;
  return typeof fetchImpl === "function" ? fetchImpl : undefined;
}

function resolveGlobalWebSearchFetch(): WebSearchFetchLike | undefined {
  const fetchImpl = (globalThis as { fetch?: WebSearchFetchLike }).fetch;
  return typeof fetchImpl === "function" ? fetchImpl : undefined;
}

function hasSoilSearchRefs(soilStore: ReadonlySoilStore | undefined): boolean {
  if (soilStore === undefined) {
    return false;
  }
  return soilStore.listConstraints().length > 0 ||
    soilStore.listCapabilityAssetRefs().length > 0 ||
    soilStore.listPathBiasRefs().length > 0;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function pageHttpStatusMessage(statusCode: number, statusText: string | undefined): string {
  const text = stringOrUndefined(statusText);
  return `Page read returned HTTP ${statusCode}${text === undefined ? "" : ` ${text}`}.`;
}

function boundedPositiveInteger(value: unknown, fallback: number, max: number): number {
  const normalizedMax = Math.max(1, Math.floor(max));
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return Math.min(Math.max(1, Math.floor(fallback)), normalizedMax);
  }
  return Math.min(Math.floor(value), normalizedMax);
}

function attachAbortForwarder(parent: AbortSignal | undefined, controller: AbortController): () => void {
  if (parent === undefined) {
    return () => undefined;
  }
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) {
    abort();
    return () => undefined;
  }
  parent.addEventListener("abort", abort, { once: true });
  return () => parent.removeEventListener("abort", abort);
}

function arrayItems(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toRepositoryPath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function contentWindow(value: string, startChar: number, maxLength: number): {
  readonly contentPreview: string;
  readonly startChar: number;
  readonly contentChars: number;
  readonly charCount: number;
  readonly hasMoreAfter: boolean;
} {
  const normalizedStart = Math.min(value.length, Math.max(0, Math.floor(startChar)));
  const contentPreview = value.slice(normalizedStart, normalizedStart + Math.max(1, Math.floor(maxLength)));
  return {
    contentPreview,
    startChar: normalizedStart,
    contentChars: contentPreview.length,
    charCount: value.length,
    hasMoreAfter: normalizedStart + contentPreview.length < value.length,
  };
}
