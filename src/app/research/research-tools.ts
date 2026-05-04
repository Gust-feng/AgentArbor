import type { InformationAccess, InformationSourceKind } from "../../domain/research/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";

export function createResearchSearchTool(researchRuntime: InformationAccess): ToolExecutor {
  return {
    definition: {
      name: "search",
      description:
        "Search AgentArbor information sources. Use this before read; returns research refs, source, status, and short snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Information need or search query." },
          sources: {
            type: "array",
            items: { type: "string" },
            description: "Optional source filters: web, codebase, soil, run_memory, docs, packages, github.",
          },
          limit: { type: "number", description: "Maximum result refs to return." },
        },
        required: ["query"],
      },
    },
    execute: async (input) => {
      const record = asRecord(input);
      return researchRuntime.search({
        query: stringOrFallback(record.query, ""),
        sources: informationSourcesOrUndefined(record.sources),
        limit: numberOrUndefined(record.limit),
      });
    },
  };
}

export function createResearchReadTool(researchRuntime: InformationAccess): ToolExecutor {
  return {
    definition: {
      name: "read",
      description:
        "Read a research ref, http/https URL, or repo file through ResearchRuntime. Returns safe summaries and truncated previews.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Research ref, http/https URL, repo:// URI, or repository path." },
          source: {
            type: "string",
            description: "Optional source override: page, codebase, soil, run_memory, docs, packages, github.",
          },
          maxLength: { type: "number", description: "Maximum preview characters." },
        },
        required: ["ref"],
      },
    },
    execute: async (input) => {
      const record = asRecord(input);
      return researchRuntime.read({
        ref: stringOrFallback(record.ref, ""),
        source: informationSourceOrUndefined(record.source),
        maxLength: numberOrUndefined(record.maxLength),
      });
    },
  };
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

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
