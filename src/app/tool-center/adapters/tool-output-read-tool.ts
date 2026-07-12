import type { ToolContinuation, ToolExecutor } from "../../../domain/tools/index.js";
import {
  TOOL_OUTPUT_REF_PREFIX,
  ToolOutputStoreError,
  type ToolOutputStore,
} from "../tool-output-store.js";
import { asRecord, throwIfAborted } from "./local-workspace-common.js";

export const MIN_TOOL_OUTPUT_READ_CHARS = 2;
export const DEFAULT_TOOL_OUTPUT_READ_CHARS = 30_000;
// A tool result is JSON encoded before it reaches the provider. Keeping the
// raw window at 30k also keeps the worst-case six-character JSON escapes below
// the shared 220k transport guard, so this reader never needs to offload itself.
export const MAX_TOOL_OUTPUT_READ_CHARS = 30_000;

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
      const nextStartChar = slice.startChar + slice.textChars;
      const continuation: ToolContinuation | undefined = slice.hasMoreAfter
        ? {
            ref: slice.ref,
            nextInput: {
              ref: slice.ref,
              startChar: nextStartChar,
              maxChars,
            },
            note: "Call read_tool_output with nextInput to read the next retained segment; the original tool will not run again.",
          }
        : undefined;
      if (!slice.hasMoreAfter) {
        await store.release(slice.ref);
      }
      return {
        ref: slice.ref,
        mediaType: slice.mediaType,
        sourceToolName: slice.sourceToolName,
        sourceCallId: slice.sourceCallId,
        content: slice.content,
        startChar: slice.startChar,
        textChars: slice.textChars,
        totalChars: slice.totalChars,
        hasMoreAfter: slice.hasMoreAfter,
        truncated: slice.hasMoreAfter,
        continuation,
      };
    },
  };
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
