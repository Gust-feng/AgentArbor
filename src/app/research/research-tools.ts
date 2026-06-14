import type {
  InformationAccess,
  InformationAccessStatus,
  InformationReadResult,
  InformationSourceKind,
} from "../../domain/research/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";

type BatchReadItem = {
  readonly ref: string;
  readonly status: InformationAccessStatus;
  readonly refId?: string;
  readonly source?: InformationSourceKind;
  readonly title?: string;
  readonly uri?: string;
  readonly summary?: string;
  readonly contentPreview?: string;
  readonly truncated: boolean;
  readonly sourceSearchRef?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly error?: string;
};

export function createResearchSearchTool(researchRuntime: InformationAccess): ToolExecutor {
  const capabilities = researchRuntime.getCapabilities?.();
  const searchableSources = capabilities?.defaultSearchSources ?? ["web", "codebase"];
  const searchableDescription = formatSourceList(searchableSources);
  return {
    definition: {
      name: "search",
      description: [
        "Search currently available AgentArbor information sources and return refs with titles, URLs/URIs, source names, statuses, and snippets.",
        searchableSources.length > 0
          ? `Model-visible search sources now: ${searchableDescription}.`
          : "No model-visible search source is currently configured.",
        "Use read with a returned ref when the full preview is needed.",
      ].join(" "),
      modelContract: {
        purpose: "Search the currently available AgentArbor information sources and return refs the model can inspect with read.",
        whenToUse: [
          "Use when you need to locate current source material before answering or editing.",
          "Use when you need refs from the currently model-visible information sources.",
        ],
        whenNotToUse: [
          "Do not use as the final evidence for detailed work; expand important refs with read first.",
        ],
        inputNotes: [
          "query is required and should describe the information need.",
          "site is optional and limits web-like search sources to a domain, for example example.com.",
          "sources is optional; omit it unless a specific currently available source is needed.",
          "limit optionally caps returned refs.",
        ],
        runtimeHints: [
          { label: "searchable sources", value: searchableDescription || "none" },
        ],
        usageNotes: [
          "Search returns real refs from currently available sources only.",
          "Use site only for domain-limited research; source adapters that cannot apply a site constraint may ignore it.",
          "Leave sources empty unless the user explicitly needs a particular available source.",
          "Call read with a returned ref before relying on a snippet for detailed work.",
        ],
        outputNotes: [
          "results[].refId is the value to pass to read.",
          "results[].uri or results[].url identifies the source location when available.",
          "status explains whether the search completed, was empty, partial, or unavailable.",
        ],
        examples: [
          { title: "Search current codebase and available sources", input: { query: "tool self description", limit: 5 } },
          { title: "Search one domain", input: { query: "AgentArbor docs", site: "example.com", sources: ["web"] } },
        ],
      },
      metadata: {
        category: "research",
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
          query: { type: "string", description: "Information need or search query." },
          site: {
            type: "string",
            description: "Optional domain/site constraint for web-like sources, for example example.com. Omit for broad search.",
          },
          sources: {
            type: "array",
            items: { type: "string", enum: searchableSources },
            description: searchableSources.length > 0
              ? `Optional filters. Only these sources are currently model-visible: ${searchableDescription}. Leave empty to search the default available sources.`
              : "Optional filters. No model-visible source is currently configured.",
          },
          limit: { type: "number", description: "Maximum result refs to return." },
        },
        required: ["query"],
      },
    },
    execute: async (input, context) => {
      const record = asRecord(input);
      return researchRuntime.search({
        query: stringOrFallback(record.query, ""),
        site: stringOrUndefined(record.site),
        sources: informationSourcesOrUndefined(record.sources),
        limit: numberOrUndefined(record.limit),
        abortSignal: context.abortSignal,
      });
    },
  };
}

export function createResearchReadTool(researchRuntime: InformationAccess): ToolExecutor {
  const capabilities = researchRuntime.getCapabilities?.();
  const readableSources = capabilities?.readableSources ?? ["page", "codebase"];
  const readableDescription = formatSourceList(readableSources);
  return {
    definition: {
      name: "read",
      description: [
        "Read a research ref, HTTP/HTTPS URL, repo:// URI, or repository path and return the actual content preview for model use.",
        "Pass ref as a string for the existing single-read output, or as a string array to read multiple refs in one call.",
        `Readable sources now: ${readableDescription || "none"}.`,
        "Single-read output includes title, uri/url, source, status, contentPreview, truncated, and metadata when available. Batch output is an array with one item per ref and does not fail the whole batch when one ref fails.",
      ].join(" "),
      modelContract: {
        purpose: "Read one or more research refs, URLs, repo URIs, or repository paths and return contentPreview for model reasoning.",
        whenToUse: [
          "Use after search when a snippet is not enough.",
          "Use directly for a known URL, repo:// URI, or workspace path that should be inspected.",
          "Use a ref array when several refs are needed and independent per-ref status is acceptable.",
        ],
        whenNotToUse: [
          "Do not use for writing or editing files; it only reads content.",
        ],
        inputNotes: [
          "ref is required and may be a returned refId, HTTP/HTTPS URL, repo:// URI, repository path, or an array of those strings.",
          "source is optional and should only disambiguate refs.",
          "maxLength increases or bounds the returned preview.",
        ],
        runtimeHints: [
          { label: "readable sources", value: readableDescription || "none" },
        ],
        usageNotes: [
          "Use read to expand a search ref, URL, repo:// URI, or repository path into content the model can continue reasoning over.",
          "For batch reads, inspect each array item status and error instead of assuming every ref succeeded.",
          "Do not treat UI activity text as the read result; inspect contentPreview and status.",
          "Increase maxLength when the next step needs more source text.",
        ],
        outputNotes: [
          "Single ref calls keep the existing result.contentPreview shape.",
          "Batch ref calls return an array; each item has ref, status, contentPreview, truncated, and error when the item failed.",
          "truncated indicates whether a longer read may be needed.",
          "sourceSearchRef links the read result back to a search result when available.",
        ],
        examples: [
          { title: "Read search result", input: { ref: "research:web:example", maxLength: 6000 } },
          { title: "Read multiple search results", input: { ref: ["research:web:one", "research:web:two"], maxLength: 4000 } },
          { title: "Read repository path", input: { ref: "src/app/research/research-tools.ts", source: "codebase" } },
        ],
      },
      metadata: {
        category: "research",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1200,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          ref: {
            oneOf: [
              { type: "string" },
              { type: "array", items: { type: "string" } },
            ],
            description: "Research ref, http/https URL, repo:// URI, repository path, or an array of those strings.",
          },
          source: {
            type: "string",
            enum: readableSources,
            description: readableSources.length > 0
              ? `Optional source override. Use only when the ref alone is ambiguous. Current readable sources: ${readableDescription}.`
              : "Optional source override. No readable source is currently configured.",
          },
          maxLength: { type: "number", description: "Maximum preview characters." },
        },
        required: ["ref"],
      },
    },
    execute: async (input, context) => {
      const record = asRecord(input);
      const refs = refsFromInput(record.ref);
      if (refs !== undefined) {
        return Promise.all(refs.map(async (ref) => {
          try {
            const result = await researchRuntime.read({
              ref,
              source: informationSourceOrUndefined(record.source),
              maxLength: numberOrUndefined(record.maxLength),
              abortSignal: context.abortSignal,
            });
            return batchReadItemFromResult(result);
          } catch (error) {
            return {
              ref,
              status: "provider-failed",
              truncated: false,
              error: errorMessage(error),
            } satisfies BatchReadItem;
          }
        }));
      }
      return researchRuntime.read({
        ref: stringOrFallback(record.ref, ""),
        source: informationSourceOrUndefined(record.source),
        maxLength: numberOrUndefined(record.maxLength),
        abortSignal: context.abortSignal,
      });
    },
  };
}

function batchReadItemFromResult(read: InformationReadResult): BatchReadItem {
  const result = read.result;
  const error = read.status === "completed" ? undefined : firstTraceMessage(read);
  return {
    ref: read.ref,
    status: read.status,
    refId: result?.refId,
    source: result?.source,
    title: result?.title,
    uri: result?.uri,
    summary: result?.summary,
    contentPreview: result?.contentPreview,
    truncated: result?.truncated ?? false,
    sourceSearchRef: result?.sourceSearchRef,
    metadata: result?.metadata,
    error,
  };
}

function firstTraceMessage(read: InformationReadResult): string | undefined {
  return read.trace.sourceSteps.map((step) => step.message).find((message): message is string => message !== undefined);
}

function refsFromInput(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 0) {
    return [];
  }
  return value.map((item) => stringOrFallback(item, ""));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "read failed for this ref.";
}

function informationSourcesOrUndefined(value: unknown): readonly InformationSourceKind[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const sources = value.map(informationSourceOrUndefined).filter((source): source is InformationSourceKind => source !== undefined);
  return sources.length === 0 ? undefined : sources;
}

function informationSourceOrUndefined(value: unknown): InformationSourceKind | undefined {
  if (
    value === "web" ||
    value === "page" ||
    value === "codebase" ||
    value === "soil" ||
    value === "run_memory" ||
    value === "docs" ||
    value === "packages" ||
    value === "github"
  ) {
    return value;
  }
  return undefined;
}

function formatSourceList(sources: readonly InformationSourceKind[]): string {
  return sources.join(", ");
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
