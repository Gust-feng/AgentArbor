import type {
  ToolCallRequest,
  ToolContentBlock,
  ToolContinuation,
  ToolDisplayProjection,
  ToolResult,
} from "../../domain/tools/index.js";
import { toolContinuationFromUnknown } from "./tool-result-continuation.js";

export type SubAgentContinuationRef = {
  readonly index?: number;
  readonly sub_agent_id?: string;
  readonly sub_agent_name?: string;
  readonly run_id?: string;
  readonly full_output_ref?: string;
  readonly continuation: ToolContinuation;
};

export function isSubAgentToolName(toolName: string): boolean {
  return toolName === "call_sub_agent" || toolName === "call_sub_agents" || toolName === "spawn_sub_agent";
}

export function projectSubAgentToolModelResult(input: {
  readonly request: ToolCallRequest;
  readonly output: unknown;
  readonly display: ToolDisplayProjection;
  readonly truncated: boolean;
  readonly fallbackText: string;
}): ToolResult {
  const record = asRecord(input.output);
  const continuationRefs = subAgentToolContinuationRefs(record);
  const continuation = continuationRefs[0]?.continuation;
  return ensureToolResultContent({
    content: genericToolResultContent(record, input.display),
    structuredContent: subAgentStructuredContent(input.request, input.output, input.display, input.truncated, continuationRefs),
    isError: record.isError === true ? true : undefined,
    continuation,
  }, input.fallbackText);
}

export function projectSubAgentToolAgentContent(input: {
  readonly request: ToolCallRequest;
  readonly output: unknown;
  readonly truncated: boolean;
}): unknown {
  const record = asRecord(input.output);
  const result = asRecord(record.result);
  const summary = stringOrUndefined(record.summary);
  const action = stringOrUndefined(record.action) ?? input.request.toolName;
  if (Array.isArray(result.results)) {
    const continuationRefs = subAgentToolContinuationRefs(record);
    return {
      action,
      status: stringOrUndefined(record.status),
      summary,
      result: {
        results: result.results.map(projectSubAgentResultItem),
        stats: optionalRecord(result.stats),
      },
      continuations: continuationRefs.length === 0 ? undefined : continuationRefs,
      truncated: input.truncated,
    };
  }

  const projectedResult = projectSubAgentResultItem(result);
  return {
    action,
    status: stringOrUndefined(record.status),
    sub_agent_name: stringOrUndefined(record.sub_agent_name),
    sub_agent_id: stringOrUndefined(record.sub_agent_id),
    spawned_role: stringOrUndefined(record.spawned_role),
    spawned_id: stringOrUndefined(record.spawned_id),
    summary,
    full_output: projectedResult.full_output,
    result: projectedResult,
    truncated: input.truncated,
  };
}

function subAgentStructuredContent(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection,
  truncated: boolean,
  continuationRefs: readonly SubAgentContinuationRef[]
): unknown {
  return structuredSnapshot({
    ...asRecord(genericStructuredContent(request, output, display, truncated)),
    continuations: continuationRefs.length === 0 ? undefined : continuationRefs,
  });
}

function subAgentToolContinuationRefs(record: Readonly<Record<string, unknown>>): readonly SubAgentContinuationRef[] {
  const result = asRecord(record.result);
  const refs: SubAgentContinuationRef[] = [];
  const recordContinuation = toolContinuationFromUnknown(record.continuation);
  if (recordContinuation !== undefined) {
    refs.push({ continuation: recordContinuation });
  }
  const resultContinuation = toolContinuationFromUnknown(result.continuation);
  if (resultContinuation !== undefined) {
    refs.push({
      run_id: stringOrUndefined(result.run_id),
      full_output_ref: stringOrUndefined(result.full_output_ref),
      continuation: resultContinuation,
    });
  }
  if (Array.isArray(result.results)) {
    for (const item of result.results) {
      const itemRecord = asRecord(item);
      const continuation = toolContinuationFromUnknown(itemRecord.continuation);
      if (continuation !== undefined) {
        refs.push({
          index: numberOrUndefined(itemRecord.index),
          sub_agent_id: stringOrUndefined(itemRecord.sub_agent_id),
          sub_agent_name: stringOrUndefined(itemRecord.sub_agent_name),
          run_id: stringOrUndefined(itemRecord.run_id),
          full_output_ref: stringOrUndefined(itemRecord.full_output_ref),
          continuation,
        });
      }
    }
  }
  return uniqueSubAgentContinuationRefs(refs);
}

function uniqueSubAgentContinuationRefs(refs: readonly SubAgentContinuationRef[]): readonly SubAgentContinuationRef[] {
  const seen = new Set<string>();
  const uniqueRefs: SubAgentContinuationRef[] = [];
  for (const ref of refs) {
    const key = JSON.stringify(ref.continuation);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRefs.push(ref);
    }
  }
  return uniqueRefs;
}

function projectSubAgentResultItem(value: unknown): {
  readonly index?: number;
  readonly sub_agent_id?: string;
  readonly sub_agent_name?: string;
  readonly task?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly full_output?: string;
  readonly full_output_chars?: number;
  readonly full_output_ref?: string;
  readonly continuation?: ToolContinuation;
  readonly tool_calls?: number;
  readonly model_rounds?: number;
  readonly duration_ms?: number;
  readonly run_id?: string;
  readonly error?: string;
} {
  const record = asRecord(value);
  return {
    index: numberOrUndefined(record.index),
    sub_agent_id: stringOrUndefined(record.sub_agent_id),
    sub_agent_name: stringOrUndefined(record.sub_agent_name),
    task: stringOrUndefined(record.task),
    status: stringOrUndefined(record.status),
    summary: stringOrUndefined(record.summary),
    full_output: textOrUndefined(record.full_output),
    full_output_chars: numberOrUndefined(record.full_output_chars),
    full_output_ref: stringOrUndefined(record.full_output_ref),
    continuation: toolContinuationFromUnknown(record.continuation),
    tool_calls: numberOrUndefined(record.tool_calls),
    model_rounds: numberOrUndefined(record.model_rounds),
    duration_ms: numberOrUndefined(record.duration_ms),
    run_id: stringOrUndefined(record.run_id),
    error: stringOrUndefined(record.error),
  };
}

function genericToolResultContent(
  record: Readonly<Record<string, unknown>>,
  display: ToolDisplayProjection
): readonly ToolContentBlock[] {
  const result = asRecord(record.result);
  if (display.kind === "generic_tool_summary") {
    return [
      ...textContentBlocks(display.summary),
      ...(display.items ?? []).flatMap((item) => textContentBlocks(item)),
    ];
  }
  return textContentBlocks(stringOrUndefined(result.text) ?? stringOrUndefined(record.summary));
}

function genericStructuredContent(
  request: ToolCallRequest,
  output: unknown,
  display: ToolDisplayProjection,
  truncated: boolean
): unknown {
  const record = asRecord(output);
  const result = asRecord(record.result);
  return structuredSnapshot({
    toolName: request.toolName,
    action: stringOrUndefined(record.action),
    display,
    result: structuredRecordWithoutVerbose(result),
    truncated,
  });
}

function ensureToolResultContent(result: ToolResult, fallbackText: string): ToolResult {
  if (result.content.length > 0) {
    return result;
  }
  return {
    ...result,
    content: [{ type: "text", text: fallbackText }],
  };
}

function textContentBlocks(value: string | undefined): readonly ToolContentBlock[] {
  return value === undefined || value.length === 0 ? [] : [{ type: "text", text: value }];
}

function structuredSnapshot(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      result[key] = item;
    }
  }
  return result;
}

function structuredRecordWithoutVerbose(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (isVerboseToolResultStructuredKey(key)) {
      continue;
    }
    result[key] = item;
  }
  return result;
}

function isVerboseToolResultStructuredKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "content" ||
    normalized === "contentpreview" ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "body" ||
    normalized === "text" ||
    normalized === "raw";
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const record = asRecord(value);
  return Object.keys(record).length === 0 ? undefined : record;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
