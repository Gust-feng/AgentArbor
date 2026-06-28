import type {
  InformationAccess,
  InformationAccessCapabilities,
  InformationAccessStatus,
  InformationQuery,
  InformationReadRequest,
  InformationReadResult,
  InformationSearchResult,
  InformationSourceKind,
  ResearchTrace,
  ResearchTraceSourceStep,
  SearchResultRef,
} from "../../domain/research/index.js";
import type { ReadonlySoilStore } from "../../domain/soil/index.js";
import { createMinimalReadonlySoilStore } from "../../domain/soil/index.js";
import type { Constraint } from "../../domain/constraints.js";
import { createId, nowIso } from "../../kernel/id.js";
import type { FetchLike as WebSearchFetchLike, WebSearchProvider } from "../tool-center/adapters/web-search-tool.js";
import {
  createCodebaseInformationSourceAdapter,
  createCommandLogInformationSourceAdapter,
  createPageInformationSourceAdapter,
  createRunMemoryInformationSourceAdapter,
  createSoilInformationSourceAdapter,
  createStubInformationSourceAdapter,
  createWebInformationSourceAdapter,
  type CommandLogReadRegistry,
  type InformationSourceAdapter,
  type PageFetchLike,
} from "./source-adapters.js";

export type ResearchRuntimeOptions = {
  readonly adapters: readonly InformationSourceAdapter[];
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly defaultLimit?: number;
  readonly defaultReadMaxLength?: number;
};

export type CreateDefaultResearchRuntimeOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly tavilyFetch?: WebSearchFetchLike;
  readonly webSearchFetch?: WebSearchFetchLike;
  readonly pageFetch?: PageFetchLike;
  readonly commandLogRegistry?: CommandLogReadRegistry;
  readonly codebaseRoot?: string;
  readonly soilStore?: ReadonlySoilStore;
  readonly constraints?: readonly Constraint[];
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly webSearchProvider?: WebSearchProvider;
  readonly webSearchApiKey?: string;
  readonly webSearchMaxResults?: number;
  readonly googleEngineId?: string;
  readonly tavilyMaxResults?: number;
};

const DEFAULT_SOURCE_PREFERENCE: readonly InformationSourceKind[] = [
  "web",
  "codebase",
  "soil",
  "run_memory",
  "docs",
  "packages",
  "github",
];
const DEFAULT_LIMIT = 5;
const DEFAULT_READ_MAX_LENGTH = 1_200;

export class ResearchRuntime implements InformationAccess {
  private readonly adapters: ReadonlyMap<InformationSourceKind, InformationSourceAdapter>;
  private readonly sourcePreference: readonly InformationSourceKind[];
  private readonly defaultLimit: number;
  private readonly defaultReadMaxLength: number;
  private readonly searchResultsByRef = new Map<string, SearchResultRef>();

  constructor(options: ResearchRuntimeOptions) {
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.source, adapter]));
    this.sourcePreference = options.sourcePreference ?? DEFAULT_SOURCE_PREFERENCE;
    this.defaultLimit = Math.max(1, Math.floor(options.defaultLimit ?? DEFAULT_LIMIT));
    this.defaultReadMaxLength = Math.max(200, Math.floor(options.defaultReadMaxLength ?? DEFAULT_READ_MAX_LENGTH));
  }

  async search(query: InformationQuery): Promise<InformationSearchResult> {
    const startedAt = nowIso();
    const normalizedQuery = normalizeOptionalString(query.query);
    const normalizedSite = normalizeOptionalString(query.site);
    const requestedSources = resolveRequestedSources({
      requested: query.sources,
      preference: query.sourcePreference ?? this.sourcePreference,
      includeReadOnlyPage: false,
      allowedSources: this.modelVisibleSearchableSources(),
    });
    if (normalizedQuery === undefined) {
      const message = "search requires a non-empty query.";
      const trace = createTrace({
        action: "search",
        startedAt,
        query: "",
        site: normalizedSite,
        requestedSources,
        sourceSteps: requestedSources.map((source) => ({
          source,
          status: "invalid-input",
          resultRefs: [],
          message,
        })),
      });
      return { action: "search", query: "", status: "invalid-input", message, results: [], trace };
    }

    const limit = Math.max(1, Math.floor(query.limit ?? this.defaultLimit));
    const results: SearchResultRef[] = [];
    const sourceSteps: ResearchTraceSourceStep[] = [];
    const sourceCapabilities = new Map(this.sourceCapabilities().map((source) => [source.source, source]));
    for (const source of requestedSources) {
      if (results.length >= limit) {
        break;
      }
      const capability = sourceCapabilities.get(source);
      if (capability?.modelVisible === false) {
        sourceSteps.push({
          source,
          status: "no-provider",
          resultRefs: [],
          message: capability.unavailableReason ?? "Source is not currently model-visible.",
        });
        continue;
      }
      const adapter = this.adapters.get(source);
      if (adapter?.search === undefined) {
        sourceSteps.push({
          source,
          status: adapter === undefined ? "no-provider" : "not-supported",
          resultRefs: [],
          message: adapter === undefined ? "No adapter is registered for this source." : "Source does not support search.",
        });
        continue;
      }
      const response = await adapter.search({
        query: normalizedQuery,
        site: normalizedSite,
        limit: limit - results.length,
        traceId: query.traceId,
        goalId: query.goalId,
        abortSignal: query.abortSignal,
      });
      for (const result of response.results) {
        this.searchResultsByRef.set(result.refId, result);
        results.push(result);
      }
      sourceSteps.push({
        source,
        status: response.status,
        resultRefs: response.results.map((result) => result.refId),
        message: response.message,
      });
    }

    const trace = createTrace({
      action: "search",
      startedAt,
      query: normalizedQuery,
      site: normalizedSite,
      requestedSources,
      sourceSteps,
    });
    const message = firstTraceMessage(sourceSteps);
    return {
      action: "search",
      query: normalizedQuery,
      site: normalizedSite,
      status: trace.status,
      message,
      results,
      trace,
    };
  }

  async read(request: InformationReadRequest): Promise<InformationReadResult> {
    const startedAt = nowIso();
    const ref = normalizeOptionalString(request.ref);
    if (ref === undefined) {
      const trace = createTrace({
        action: "read",
        startedAt,
        ref: "",
        requestedSources: request.source === undefined ? [] : [request.source],
        sourceSteps: [
          {
            source: request.source ?? "page",
            status: "invalid-input",
            resultRefs: [],
            message: "read requires a non-empty ref or URL.",
          },
        ],
      });
      return { action: "read", ref: "", status: "invalid-input", trace };
    }

    const sourceResult = this.searchResultsByRef.get(ref);
    const source = resolveReadSource(request, sourceResult, ref);
    const capability = this.sourceCapabilities().find((item) => item.source === source);
    if (capability?.modelVisible === false) {
      const trace = createTrace({
        action: "read",
        startedAt,
        ref,
        requestedSources: [source],
        sourceSteps: [
          {
            source,
            status: "no-provider",
            resultRefs: [],
            message: capability.unavailableReason ?? "Source is not currently model-visible.",
          },
        ],
      });
      return { action: "read", ref, status: trace.status, trace };
    }
    const adapter = this.adapters.get(source);
    if (adapter?.read === undefined) {
      const trace = createTrace({
        action: "read",
        startedAt,
        ref,
        requestedSources: [source],
        sourceSteps: [
          {
            source,
            status: adapter === undefined ? "no-provider" : "not-supported",
            resultRefs: [],
            message: adapter === undefined ? "No adapter is registered for this source." : "Source does not support read.",
          },
        ],
      });
      return { action: "read", ref, status: trace.status, trace };
    }

    const response = await adapter.read({
      ref,
      query: request.query,
      uri: sourceResult?.uri,
      title: sourceResult?.title,
      maxLength: Math.max(200, Math.floor(request.maxLength ?? this.defaultReadMaxLength)),
      sourceResult,
      abortSignal: request.abortSignal,
    });
    const sourceSteps: ResearchTraceSourceStep[] = [
      {
        source,
        status: response.status,
        resultRefs: response.result === undefined ? [] : [response.result.refId],
        message: response.message,
        errorFacts: response.errorFacts,
      },
    ];
    const trace = createTrace({
      action: "read",
      startedAt,
      ref,
      query: request.query,
      requestedSources: [source],
      sourceSteps,
    });
    return {
      action: "read",
      ref,
      status: trace.status,
      result: response.result,
      trace,
    };
  }

  getCapabilities(): InformationAccessCapabilities {
    const sources = this.sourceCapabilities();
    const modelVisibleSources = sources.filter((source) => source.modelVisible);
    const searchableSources = modelVisibleSources
      .filter((source) => source.searchable && source.source !== "page")
      .map((source) => source.source);
    const readableSources = modelVisibleSources
      .filter((source) => source.readable)
      .map((source) => source.source);
    return {
      sources,
      searchableSources,
      readableSources,
      defaultSearchSources: this.modelVisibleSearchableSources(),
    };
  }

  private modelVisibleSearchableSources(): readonly InformationSourceKind[] {
    const capabilitiesBySource = new Map(this.sourceCapabilities().map((source) => [source.source, source]));
    const sources = this.sourcePreference.filter((source) => {
      const capability = capabilitiesBySource.get(source);
      return capability?.modelVisible === true && capability.searchable && source !== "page";
    });
    if (sources.length > 0) {
      return sources;
    }
    return [...capabilitiesBySource.values()]
      .filter((source) => source.modelVisible && source.searchable && source.source !== "page")
      .map((source) => source.source);
  }

  private sourceCapabilities(): InformationAccessCapabilities["sources"] {
    return [...this.adapters.values()].map((adapter) => ({
      source: adapter.source,
      label: adapter.capability?.label ?? defaultSourceLabel(adapter.source),
      searchable: adapter.search !== undefined,
      readable: adapter.read !== undefined,
      modelVisible: adapter.capability?.modelVisible ?? (adapter.search !== undefined || adapter.read !== undefined),
      unavailableReason: adapter.capability?.unavailableReason,
    }));
  }
}

export function createDefaultResearchRuntime(options: CreateDefaultResearchRuntimeOptions = {}): ResearchRuntime {
  const env = options.env ?? process.env;
  const soilStore =
    options.soilStore ??
    (options.constraints === undefined ? undefined : createMinimalReadonlySoilStore(options.constraints));
  const provider = options.webSearchProvider ?? webSearchProviderFromEnv(env);
  const apiKey = options.webSearchApiKey ?? webSearchApiKeyFromEnv(env, provider);
  const providerSettings = webSearchSettingsFromEnv(env, provider);
  return new ResearchRuntime({
    sourcePreference: options.sourcePreference,
    adapters: [
      createWebInformationSourceAdapter({
        provider,
        apiKey,
        fetch: options.webSearchFetch ?? options.tavilyFetch,
        maxResults: options.webSearchMaxResults ?? options.tavilyMaxResults ?? providerSettings.maxResults,
        endpoint: providerSettings.endpoint,
        googleEngineId: options.googleEngineId ?? providerSettings.googleEngineId,
        tavilySearchDepth: providerSettings.tavilySearchDepth,
        exaSearchType: providerSettings.exaSearchType,
        zaiSearchEngine: providerSettings.zaiSearchEngine,
        bingMarket: providerSettings.bingMarket,
      }),
      createPageInformationSourceAdapter({ fetch: options.pageFetch }),
      createCommandLogInformationSourceAdapter({ registry: options.commandLogRegistry }),
      createCodebaseInformationSourceAdapter({ rootDirectory: options.codebaseRoot }),
      createSoilInformationSourceAdapter({ soilStore }),
      createRunMemoryInformationSourceAdapter({ soilStore }),
      createStubInformationSourceAdapter("docs"),
      createStubInformationSourceAdapter("packages"),
      createStubInformationSourceAdapter("github"),
    ],
  });
}

function webSearchProviderFromEnv(env: Readonly<Record<string, string | undefined>>): WebSearchProvider {
  const provider = normalizeOptionalString(env.AGENTARBOR_WEB_SEARCH_PROVIDER);
  if (provider === "model_builtin") {
    return "none";
  }
  if (
    provider === "tavily" ||
    provider === "exa" ||
    provider === "zai" ||
    provider === "metaso" ||
    provider === "google" ||
    provider === "bing" ||
    provider === "none"
  ) {
    return provider;
  }
  if (firstNonBlank(env.AGENTARBOR_EXA_API_KEY) !== undefined) return "exa";
  if (firstNonBlank(env.AGENTARBOR_ZAI_API_KEY) !== undefined) return "zai";
  if (firstNonBlank(env.AGENTARBOR_METASO_API_KEY, env.METASO_API_KEY) !== undefined) return "metaso";
  if (firstNonBlank(env.AGENTARBOR_GOOGLE_API_KEY) !== undefined) return "google";
  if (firstNonBlank(env.AGENTARBOR_BING_API_KEY) !== undefined) return "bing";
  return "tavily";
}

function webSearchApiKeyFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  provider: WebSearchProvider
): string | undefined {
  if (provider === "none") {
    return undefined;
  }
  const generic = env.AGENTARBOR_WEB_SEARCH_API_KEY;
  if (provider === "exa") return firstNonBlank(generic, env.AGENTARBOR_EXA_API_KEY, env.EXA_API_KEY);
  if (provider === "zai") return firstNonBlank(generic, env.AGENTARBOR_ZAI_API_KEY, env.ZAI_API_KEY, env.ZHIPUAI_API_KEY);
  if (provider === "metaso") return firstNonBlank(generic, env.AGENTARBOR_METASO_API_KEY, env.METASO_API_KEY);
  if (provider === "google") return firstNonBlank(generic, env.AGENTARBOR_GOOGLE_API_KEY, env.GOOGLE_API_KEY);
  if (provider === "bing") return firstNonBlank(generic, env.AGENTARBOR_BING_API_KEY, env.BING_API_KEY);
  return firstNonBlank(generic, env.AGENTARBOR_TAVILY_API_KEY, env.TAVILY_API_KEY);
}

function webSearchSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  provider: WebSearchProvider
): {
  readonly maxResults?: number;
  readonly endpoint?: string;
  readonly googleEngineId?: string;
  readonly tavilySearchDepth?: string;
  readonly exaSearchType?: string;
  readonly zaiSearchEngine?: string;
  readonly bingMarket?: string;
} {
  const maxResults = positiveIntegerFromString(env.AGENTARBOR_WEB_SEARCH_MAX_RESULTS) ??
    (provider === "tavily" ? positiveIntegerFromString(env.AGENTARBOR_TAVILY_MAX_RESULTS) : undefined);
  return {
    maxResults,
    endpoint: firstNonBlank(env.AGENTARBOR_WEB_SEARCH_ENDPOINT),
    googleEngineId: firstNonBlank(env.AGENTARBOR_WEB_SEARCH_GOOGLE_ENGINE_ID, env.AGENTARBOR_GOOGLE_CSE_ID),
    tavilySearchDepth: firstNonBlank(env.AGENTARBOR_TAVILY_SEARCH_DEPTH),
    exaSearchType: firstNonBlank(env.AGENTARBOR_EXA_SEARCH_TYPE),
    zaiSearchEngine: firstNonBlank(env.AGENTARBOR_ZAI_SEARCH_ENGINE),
    bingMarket: firstNonBlank(env.AGENTARBOR_BING_MARKET),
  };
}

function firstTraceMessage(sourceSteps: readonly ResearchTraceSourceStep[]): string | undefined {
  for (const step of sourceSteps) {
    if (step.status === "completed") {
      continue;
    }
    if (step.message !== undefined && step.message.trim().length > 0) {
      return step.message;
    }
  }
  return undefined;
}

function resolveReadSource(
  request: InformationReadRequest,
  sourceResult: SearchResultRef | undefined,
  ref: string
): InformationSourceKind {
  if (request.source !== undefined) {
    return request.source;
  }
  if (sourceResult?.source === "web" && sourceResult.uri !== undefined) {
    return "page";
  }
  if (sourceResult !== undefined) {
    return sourceResult.source;
  }
  if (isHttpUrl(ref)) {
    return "page";
  }
  if (isCommandLogRef(ref)) {
    return "command_log";
  }
  const sourceFromRef = sourceFromResearchRef(ref);
  return sourceFromRef ?? "codebase";
}

function resolveRequestedSources(input: {
  readonly requested?: readonly InformationSourceKind[];
  readonly preference: readonly InformationSourceKind[];
  readonly includeReadOnlyPage: boolean;
  readonly allowedSources?: readonly InformationSourceKind[];
}): readonly InformationSourceKind[] {
  const hasExplicitRequest = input.requested !== undefined && input.requested.length > 0;
  const raw = hasExplicitRequest ? input.requested : input.preference;
  const unique = [...new Set(raw)];
  const withoutReadOnly = input.includeReadOnlyPage ? unique : unique.filter((source) => source !== "page");
  if (input.allowedSources === undefined || hasExplicitRequest) {
    return withoutReadOnly;
  }
  const allowed = new Set(input.allowedSources);
  return withoutReadOnly.filter((source) => allowed.has(source));
}

function createTrace(input: {
  readonly action: "search" | "read";
  readonly startedAt: string;
  readonly query?: string;
  readonly site?: string;
  readonly ref?: string;
  readonly requestedSources: readonly InformationSourceKind[];
  readonly sourceSteps: readonly ResearchTraceSourceStep[];
}): ResearchTrace {
  return {
    traceId: createId("research-trace"),
    action: input.action,
    query: input.query,
    site: input.site,
    ref: input.ref,
    requestedSources: [...input.requestedSources],
    status: summarizeStatus(input.sourceSteps),
    startedAt: input.startedAt,
    completedAt: nowIso(),
    sourceSteps: input.sourceSteps.map((step) => ({
      ...step,
      resultRefs: [...step.resultRefs],
    })),
  };
}

function summarizeStatus(steps: readonly ResearchTraceSourceStep[]): InformationAccessStatus {
  if (steps.some((step) => step.status === "completed")) {
    return steps.every((step) => step.status === "completed" || step.status === "empty") ? "completed" : "partial";
  }
  if (steps.length === 0) {
    return "empty";
  }
  if (steps.every((step) => step.status === "stub")) {
    return "stub";
  }
  if (steps.every((step) => step.status === "no-provider" || step.status === "stub")) {
    return "no-provider";
  }
  if (steps.every((step) => step.status === "empty")) {
    return "empty";
  }
  return steps[0]?.status ?? "empty";
}

function sourceFromResearchRef(ref: string): InformationSourceKind | undefined {
  if (!ref.startsWith("research:")) {
    return undefined;
  }
  const source = ref.split(":")[1];
  return isInformationSourceKind(source) ? source : undefined;
}

function isInformationSourceKind(value: string | undefined): value is InformationSourceKind {
  return (
    value === "web" ||
    value === "page" ||
    value === "codebase" ||
    value === "soil" ||
    value === "run_memory" ||
    value === "docs" ||
    value === "packages" ||
    value === "github" ||
    value === "command_log"
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function positiveIntegerFromString(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function defaultSourceLabel(source: InformationSourceKind): string {
  switch (source) {
    case "web":
      return "web search";
    case "page":
      return "web page reader";
    case "codebase":
      return "codebase";
    case "soil":
      return "soil";
    case "run_memory":
      return "run memory";
    case "docs":
      return "technical docs";
    case "packages":
      return "package registry";
    case "github":
      return "GitHub";
    case "command_log":
      return "registered command logs";
  }
}

function isCommandLogRef(value: string): boolean {
  return value.startsWith("command-log://");
}
