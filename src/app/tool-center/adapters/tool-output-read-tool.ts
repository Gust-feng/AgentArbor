import type { ToolContinuation, ToolExecutor } from "../../../domain/tools/index.js";
import {
  TOOL_OUTPUT_REF_PREFIX,
  ToolOutputStoreError,
  type ToolOutputSlice,
  type ToolOutputStore,
} from "../tool-output-store.js";
import {
  DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS,
  MAX_TOOL_OUTPUT_READ_CHARS,
} from "../tool-output-limits.js";
import { asRecord, throwIfAborted } from "./local-workspace-common.js";
import { utf16SafePrefixLength } from "../text-window.js";

export const MIN_TOOL_OUTPUT_READ_CHARS = 2;
export const DEFAULT_TOOL_OUTPUT_READ_CHARS = MAX_TOOL_OUTPUT_READ_CHARS;
export { MAX_TOOL_OUTPUT_READ_CHARS };

export type ReadToolOutputResult = {
  readonly ref: string;
  readonly mediaType: "text/plain" | "application/json";
  readonly sourceToolName: string;
  readonly sourceCallId: string;
  readonly content: string;
  readonly startChar: number;
  readonly textChars: number;
  readonly totalChars: number;
  readonly hasMoreAfter: boolean;
  readonly truncated: boolean;
  readonly continuationAvailability: "live_only";
  readonly continuation?: ToolContinuation;
};

export function createReadToolOutputTool(store: ToolOutputStore): ToolExecutor {
  return {
    definition: {
      name: "read_tool_output",
      description: "Read an exact character window from a retained tool result without executing the original tool again.",
      metadata: {
        category: "other",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
      modelContract: {
        purpose: "Continue reading a large tool result from a tool-output:// reference without repeating the source operation.",
        whenToUse: [
          "Use when another tool result provides a tool-output:// continuation ref.",
          "Use continuation.nextInput exactly to read the next unread character window.",
        ],
        whenNotToUse: [
          "Do not use this tool to rerun, refresh, paginate, or otherwise contact the original source.",
          "Do not use it for workspace files, command logs, HTTP pagination, or Sub-Agent outputs that provide their own reader tool.",
        ],
        inputNotes: [
          `ref must use the ${TOOL_OUTPUT_REF_PREFIX} scheme returned by a previous tool result.`,
          "startChar is a zero-based UTF-16 code-unit offset, defaults to 0, and must not split a surrogate pair.",
          `maxChars defaults to ${DEFAULT_TOOL_OUTPUT_READ_CHARS}, must be at least ${MIN_TOOL_OUTPUT_READ_CHARS}, and cannot exceed ${MAX_TOOL_OUTPUT_READ_CHARS}.`,
        ],
        outputNotes: [
          "content is the exact retained text or canonical JSON window; window boundaries never split a UTF-16 surrogate pair.",
          "sourceToolName and sourceCallId identify the original execution; this read does not execute it again.",
          "truncated is true only when hasMoreAfter is true and continuation.nextInput points to the first unread character.",
          "continuationAvailability is live_only because retained bytes are process-local and are lost after restart.",
          "The final window releases the process-local ref; retain the returned content instead of rereading from the beginning.",
        ],
        examples: [{
          title: "Continue a retained result",
          input: {
            ref: "tool-output://example-ref",
            startChar: 0,
            maxChars: DEFAULT_TOOL_OUTPUT_READ_CHARS,
          },
        }],
      },
      inputSchema: {
        type: "object",
        properties: {
          ref: {
            type: "string",
            description: "Opaque tool-output:// reference returned by a previous tool result.",
          },
          startChar: {
            type: "number",
            minimum: 0,
            description: "Optional zero-based character offset. Defaults to 0.",
          },
          maxChars: {
            type: "number",
            minimum: MIN_TOOL_OUTPUT_READ_CHARS,
            maximum: MAX_TOOL_OUTPUT_READ_CHARS,
            description: `Optional maximum characters to return. Defaults to ${DEFAULT_TOOL_OUTPUT_READ_CHARS}.`,
          },
        },
        required: ["ref"],
        additionalProperties: false,
      },
    },
    execute: async (input, context): Promise<ReadToolOutputResult> => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const ref = requiredToolOutputRef(record.ref);
      const startChar = optionalInteger(record.startChar, "startChar") ?? 0;
      const maxChars = optionalInteger(record.maxChars, "maxChars") ?? DEFAULT_TOOL_OUTPUT_READ_CHARS;
      if (startChar < 0) {
        throw new Error("read_tool_output startChar must be a non-negative integer.");
      }
      if (maxChars < MIN_TOOL_OUTPUT_READ_CHARS || maxChars > MAX_TOOL_OUTPUT_READ_CHARS) {
        throw new Error(
          `read_tool_output maxChars must be between ${MIN_TOOL_OUTPUT_READ_CHARS} and ${MAX_TOOL_OUTPUT_READ_CHARS}.`,
        );
      }

      const slice = await store.read(ref, { startChar, maxChars });
      throwIfAborted(context.abortSignal);
      if (slice === undefined) {
        throw new ToolOutputStoreError(
          "tool_output_not_found",
          `Retained tool output was not found or has expired: ${ref}`,
          { ref },
        );
      }
      const result = fitReadResultToInlineBudget(slice, maxChars);
      if (!result.hasMoreAfter) {
        await store.release(slice.ref);
      }
      return result;
    },
  };
}

function fitReadResultToInlineBudget(
  slice: ToolOutputSlice,
  requestedMaxChars: number,
): ReadToolOutputResult {
  const full = readToolOutputResult(slice, slice.content, requestedMaxChars);
  if (serializedReadResultChars(full) <= DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS) {
    return full;
  }

  let low = 0;
  let high = slice.content.length;
  let best: ReadToolOutputResult | undefined;
  while (low <= high) {
    const candidateMaxChars = Math.floor((low + high) / 2);
    const prefixLength = utf16SafePrefixLength(slice.content, candidateMaxChars);
    const candidate = readToolOutputResult(
      slice,
      slice.content.slice(0, prefixLength),
      requestedMaxChars,
    );
    if (serializedReadResultChars(candidate) <= DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS) {
      if (candidate.textChars > 0 && (best === undefined || candidate.textChars > best.textChars)) {
        best = candidate;
      }
      low = candidateMaxChars + 1;
    } else {
      high = candidateMaxChars - 1;
    }
  }

  if (best === undefined) {
    const metadataChars = serializedReadResultChars(readToolOutputResult(slice, "", requestedMaxChars));
    throw new ToolOutputStoreError(
      "tool_output_read_budget_exceeded",
      "Retained tool output metadata leaves no transport-safe room for the next content segment.",
      {
        ref: slice.ref,
        startChar: slice.startChar,
        totalChars: slice.totalChars,
        metadataChars,
        maxInlineOutputChars: DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS,
      },
    );
  }
  return best;
}

function readToolOutputResult(
  slice: ToolOutputSlice,
  content: string,
  requestedMaxChars: number,
): ReadToolOutputResult {
  const textChars = content.length;
  const nextStartChar = slice.startChar + textChars;
  const hasMoreAfter = nextStartChar < slice.totalChars;
  const continuation: ToolContinuation | undefined = hasMoreAfter
    ? {
        ref: slice.ref,
        nextInput: {
          ref: slice.ref,
          startChar: nextStartChar,
          maxChars: requestedMaxChars,
        },
        note: "Call read_tool_output with nextInput to read the next retained segment; the original tool will not run again.",
      }
    : undefined;
  return {
    ref: slice.ref,
    mediaType: slice.mediaType,
    sourceToolName: slice.sourceToolName,
    sourceCallId: slice.sourceCallId,
    content,
    startChar: slice.startChar,
    textChars,
    totalChars: slice.totalChars,
    hasMoreAfter,
    truncated: hasMoreAfter,
    continuationAvailability: "live_only",
    continuation,
  };
}

function serializedReadResultChars(result: ReadToolOutputResult): number {
  return JSON.stringify(result).length;
}

function requiredToolOutputRef(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith(TOOL_OUTPUT_REF_PREFIX)) {
    throw new Error(`read_tool_output ref must use the ${TOOL_OUTPUT_REF_PREFIX} scheme.`);
  }
  return value;
}

function optionalInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`read_tool_output ${fieldName} must be a safe integer.`);
  }
  return value as number;
}
