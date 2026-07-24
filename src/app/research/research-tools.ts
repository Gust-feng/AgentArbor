import type {
  InformationAccess,
  InformationAccessStatus,
  InformationReadResult,
  InformationSourceKind,
} from "../../domain/research/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";

type BatchReadItem = {
  readonly ref: string;
  readonly researchStatus: InformationAccessStatus;
  readonly refId?: string;
  readonly source?: InformationSourceKind;
  readonly title?: string;
  readonly uri?: string;
  readonly contentPreview?: string;
  readonly startChar?: number;
  readonly contentChars?: number;
  readonly charCount?: number;
  readonly hasMoreAfter?: boolean;
  readonly contentComplete?: boolean;
  readonly truncated: boolean;
  readonly sourceSearchRef?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly error?: string;
  readonly errorFacts?: Readonly<Record<string, string | number | boolean>>;
};

type ResearchReadRequestFacts = {
  readonly source?: InformationSourceKind;
  readonly maxLength?: number;
  readonly startChar: number;
};

type ResearchReadContinuation = {
  readonly nextInput: {
    readonly ref: string;
    readonly source?: InformationSourceKind;
    readonly maxLength?: number;
    readonly startChar: number;
  };
};

const MAX_RESEARCH_READ_BATCH_ITEMS = 16;
const MAX_CONCURRENT_RESEARCH_READS = 4;

export function createResearchSearchTool(researchRuntime: InformationAccess): ToolExecutor {
  const capabilities = researchRuntime.getCapabilities?.();
  const searchableSources = capabilities?.defaultSearchSources ?? ["web", "codebase"];
  const searchableDescription = formatSourceList(searchableSources);
  return {
    definition: {
      name: "ResearchSearch",
      description: [
        "Search available information sources and return references with titles, locations, status, and snippets.",
        searchableSources.length > 0
          ? `Available sources: ${searchableDescription}.`
          : "No search source is configured.",
        "Use read with a returned reference when more content is required.",
      ].join(" "),
      metadata: {
        category: "research",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
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
      const search = await researchRuntime.search({
        query: stringOrFallback(record.query, ""),
        site: stringOrUndefined(record.site),
        sources: informationSourcesOrUndefined(record.sources),
        limit: numberOrUndefined(record.limit),
        abortSignal: context.abortSignal,
      });
      return {
        query: search.query,
        site: search.site,
        researchStatus: search.status,
        message: search.message,
        results: search.results,
        ...researchTraceFacts(search.trace),
      };
    },
  };
}

export function createResearchReadTool(researchRuntime: InformationAccess): ToolExecutor {
  const capabilities = researchRuntime.getCapabilities?.();
  const readableSources = capabilities?.readableSources ?? ["page", "codebase"];
  const readableDescription = formatSourceList(readableSources);
  return {
    definition: {
      name: "ResearchRead",
      description: [
        "Read a reference, HTTP(S) URL, command-log reference, repository URI, or repository path and return contentPreview with source and status facts.",
        "Pass one reference or an array of references.",
        `Readable sources now: ${readableDescription || "none"}.`,
        "Use a returned continuation to read the next content range.",
      ].join(" "),
      metadata: {
        category: "research",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
      inputSchema: {
        type: "object",
        properties: {
          ref: {
            oneOf: [
              { type: "string" },
              {
                type: "array",
                items: { type: "string" },
                maxItems: MAX_RESEARCH_READ_BATCH_ITEMS,
              },
            ],
            description: "Research ref, http/https URL, command-log:// ref, repo:// URI, repository path, or an array of those strings.",
          },
          source: {
            type: "string",
            enum: readableSources,
            description: readableSources.length > 0
              ? `Optional source override. Use only when the ref alone is ambiguous. Current readable sources: ${readableDescription}.`
              : "Optional source override. No readable source is currently configured.",
          },
          maxLength: { type: "number", description: "Maximum preview characters." },
          startChar: { type: "number", description: "Zero-based character offset from a returned continuation.nextInput." },
        },
        required: ["ref"],
      },
    },
    execute: async (input, context) => {
      const record = asRecord(input);
      const requestFacts: ResearchReadRequestFacts = {
        source: informationSourceOrUndefined(record.source),
        maxLength: numberOrUndefined(record.maxLength),
        startChar: nonNegativeInteger(record.startChar),
      };
      const refs = refsFromInput(record.ref);
      if (refs !== undefined) {
        if (refs.length > MAX_RESEARCH_READ_BATCH_ITEMS) {
          throw new Error(`research read accepts at most ${MAX_RESEARCH_READ_BATCH_ITEMS} refs per batch.`);
        }
        const results = await mapWithConcurrency(refs, MAX_CONCURRENT_RESEARCH_READS, context.abortSignal, async (ref) => {
          try {
            const result = await researchRuntime.read({
              ref,
              ...requestFacts,
              abortSignal: context.abortSignal,
            });
            return batchReadItemFromResult(result, requestFacts);
          } catch (error) {
            if (isCancellation(error, context.abortSignal)) {
              throw cancellationError(context.abortSignal?.reason ?? error);
            }
            return {
              item: {
                ref,
                researchStatus: "provider-failed",
                truncated: false,
                error: errorMessage(error),
              } satisfies BatchReadItem,
            };
          }
        });
        const continuations = results
          .map((result) => result.continuation)
          .filter((continuation): continuation is ResearchReadContinuation => continuation !== undefined);
        return {
          items: results.map((result) => result.item),
          ...(continuations.length === 0 ? {} : { continuations }),
        };
      }
      const result = await researchRuntime.read({
        ref: stringOrFallback(record.ref, ""),
        ...requestFacts,
        abortSignal: context.abortSignal,
      });
      return singleReadOutputFromResult(result, requestFacts);
    },
  };
}

function singleReadOutputFromResult(read: InformationReadResult, request: ResearchReadRequestFacts) {
  const firstFailureStep = firstFailureSourceStep(read);
  const continuation = readContinuation(read, request);
  return {
    ref: read.ref,
    researchStatus: read.status,
    refId: read.result?.refId,
    source: read.result?.source,
    title: read.result?.title,
    uri: read.result?.uri,
    contentPreview: read.result?.contentPreview,
    startChar: read.result?.startChar,
    contentChars: read.result?.contentChars,
    charCount: read.result?.charCount,
    hasMoreAfter: read.result?.hasMoreAfter,
    contentComplete: read.result === undefined ? undefined : !read.result.hasMoreAfter,
    truncated: continuation !== undefined,
    continuation,
    sourceSearchRef: read.result?.sourceSearchRef,
    metadata: read.result?.metadata,
    ...researchTraceFacts(read.trace),
    error: read.status === "completed" ? undefined : firstFailureStep?.message,
    errorFacts: read.status === "completed" ? undefined : firstFailureStep?.errorFacts,
  };
}

function batchReadItemFromResult(
  read: InformationReadResult,
  request: ResearchReadRequestFacts,
): { readonly item: BatchReadItem; readonly continuation?: ResearchReadContinuation } {
  const result = read.result;
  const firstFailureStep = firstFailureSourceStep(read);
  const error = read.status === "completed" ? undefined : firstFailureStep?.message;
  const continuation = readContinuation(read, request);
  return {
    item: {
      ref: read.ref,
      researchStatus: read.status,
      refId: result?.refId,
      source: result?.source,
      title: result?.title,
      uri: result?.uri,
      contentPreview: result?.contentPreview,
      startChar: result?.startChar,
      contentChars: result?.contentChars,
      charCount: result?.charCount,
      hasMoreAfter: result?.hasMoreAfter,
      contentComplete: result === undefined ? undefined : !result.hasMoreAfter,
      truncated: continuation !== undefined,
      sourceSearchRef: result?.sourceSearchRef,
      metadata: result?.metadata,
      error,
      errorFacts: firstFailureStep?.errorFacts,
    },
    continuation,
  };
}

function readContinuation(
  read: InformationReadResult,
  request: ResearchReadRequestFacts,
): ResearchReadContinuation | undefined {
  const result = read.result;
  if (read.status !== "completed" || result?.hasMoreAfter !== true || result.truncated !== true) {
    return undefined;
  }
  const nextStartChar = result.startChar + result.contentChars;
  if (!Number.isSafeInteger(nextStartChar) || nextStartChar <= result.startChar || nextStartChar >= result.charCount) {
    return undefined;
  }
  return {
    nextInput: {
      ref: read.ref,
      source: request.source ?? result.source,
      maxLength: request.maxLength,
      startChar: nextStartChar,
    },
  };
}

function researchTraceFacts(trace: InformationReadResult["trace"]): {
  readonly traceId: string;
  readonly requestedSources: readonly InformationSourceKind[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly sourceSteps: InformationReadResult["trace"]["sourceSteps"];
} {
  return {
    traceId: trace.traceId,
    requestedSources: trace.requestedSources,
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    sourceSteps: trace.sourceSteps,
  };
}

function firstFailureSourceStep(read: InformationReadResult): InformationReadResult["trace"]["sourceSteps"][number] | undefined {
  return read.trace.sourceSteps.find((step) => step.status !== "completed");
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

async function mapWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  abortSignal: AbortSignal | undefined,
  operation: (input: TInput) => Promise<TOutput>,
): Promise<readonly TOutput[]> {
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;
  let stopped = false;
  const workers = Array.from(
    { length: Math.min(concurrency, inputs.length) },
    async () => {
      while (true) {
        if (stopped) return;
        throwIfCancelled(abortSignal);
        const index = nextIndex;
        if (index >= inputs.length) {
          return;
        }
        nextIndex += 1;
        try {
          results[index] = await operation(inputs[index]!);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) {
    return;
  }
  throw cancellationError(signal.reason);
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError");
}

function cancellationError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === "AbortError") {
    return reason;
  }
  const error = new Error(
    reason instanceof Error && reason.message.trim().length > 0
      ? reason.message
      : typeof reason === "string" && reason.trim().length > 0
        ? reason
        : "research read was cancelled.",
    reason instanceof Error ? { cause: reason } : undefined,
  );
  error.name = "AbortError";
  return error;
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
    value === "github" ||
    value === "command_log"
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

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
