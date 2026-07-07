import type { ArborMessage } from "../../domain/common.js";
import type { ToolCallRequest, ToolCallResult, ToolExecutionContext } from "../../domain/tools/index.js";
import { normalizeToolErrorFacts, toolDisplayName } from "../../domain/tools/index.js";
import { createMessage } from "../messages/create-message.js";
import { redactSensitiveText } from "../redaction.js";

export type ToolRequestedEventPayload = {
  readonly traceId: string;
  readonly goalId: string;
  readonly callerAgentId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly toolDisplayName: string;
  readonly input: unknown;
};

export type ToolCompletedEventPayload = ToolRequestedEventPayload & {
  readonly output: unknown;
  readonly durationMs: number;
};

export type ToolFailedEventPayload = ToolRequestedEventPayload & {
  readonly output?: unknown;
  readonly error: string;
  readonly errorDomain?: ToolCallResult["errorDomain"];
  readonly errorFacts?: ToolCallResult["errorFacts"];
  readonly durationMs: number;
};

export function createToolRequestedMessage(input: {
  readonly request: ToolCallRequest;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolRequestedEventPayload> {
  return createMessage({
    traceId: input.context.traceId,
    from: { id: "tool-center", role: "runtime" },
    to: { role: "runtime" },
    type: "tool.requested",
    intent: "request_tool_execution",
    payload: {
      traceId: input.context.traceId,
      goalId: input.context.goalId,
      callerAgentId: input.context.callerAgentId,
      callId: input.request.callId,
      toolName: input.request.toolName,
      toolDisplayName: toolDisplayName(input.request.toolName),
      input: toSafeToolEventSummaryValue(input.request.input),
    },
  });
}

export function createToolCompletedMessage(input: {
  readonly result: ToolCallResult;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolCompletedEventPayload> {
  return createMessage({
    traceId: input.context.traceId,
    from: { id: "tool-center", role: "runtime" },
    to: { role: "runtime" },
    type: "tool.completed",
    intent: "complete_tool_execution",
    payload: {
      traceId: input.context.traceId,
      goalId: input.context.goalId,
      callerAgentId: input.context.callerAgentId,
      callId: input.result.callId,
      toolName: input.result.toolName,
      toolDisplayName: toolDisplayName(input.result.toolName),
      input: toSafeToolEventSummaryValue(input.result.input),
      output: toSafeToolEventSummaryValue(toProjectedToolEventOutput(input.result)),
      durationMs: input.result.durationMs,
    },
  });
}

export function createToolFailedMessage(input: {
  readonly result: ToolCallResult;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolFailedEventPayload> {
  const errorDomain = input.result.errorDomain ?? input.result.projection?.envelope?.errorDomain;
  const errorFacts = normalizeToolErrorFacts(input.result.errorFacts ?? input.result.projection?.envelope?.errorFacts);
  const output = toProjectedToolEventOutput(input.result);
  return createMessage({
    traceId: input.context.traceId,
    from: { id: "tool-center", role: "runtime" },
    to: { role: "runtime" },
    type: "tool.failed",
    intent: "fail_tool_execution",
    payload: {
      traceId: input.context.traceId,
      goalId: input.context.goalId,
      callerAgentId: input.context.callerAgentId,
      callId: input.result.callId,
      toolName: input.result.toolName,
      toolDisplayName: toolDisplayName(input.result.toolName),
      input: toSafeToolEventSummaryValue(input.result.input),
      output: output === undefined ? undefined : toSafeToolEventSummaryValue(output),
      error: sanitizeError(input.result.error ?? "Tool execution failed."),
      errorDomain,
      errorFacts,
      durationMs: input.result.durationMs,
    },
  });
}

export function createToolApprovalRequiredMessage(input: {
  readonly result: ToolCallResult;
  readonly context: ToolExecutionContext;
}): ArborMessage {
  const confirmation = input.result.confirmationRequest;
  return createMessage({
    traceId: input.context.traceId,
    from: { id: input.context.callerAgentId, role: "agent" },
    to: { role: "runtime" },
    type: "user_approval.requested",
    intent: "request_tool_confirmation",
    payload: {
      traceId: input.context.traceId,
      goalId: input.context.goalId,
      callerAgentId: input.context.callerAgentId,
      callId: input.result.callId,
      toolName: input.result.toolName,
      toolDisplayName: toolDisplayName(input.result.toolName),
      confirmationId: confirmation?.confirmationId ?? `confirmation-${input.result.callId}`,
      title: confirmation?.title ?? "需要确认",
      question: confirmation?.actionSummary ?? toolDisplayName(input.result.toolName),
      consequence: confirmationConsequenceFromRequest(
        confirmation,
        toolDisplayName(input.result.toolName)
      ),
      riskLevel: confirmation?.riskLevel ?? "medium",
      affectedResources: confirmation?.affectedResources ?? [],
      sourceRefs: confirmation?.sourceRefs ?? [`tool:${input.result.callId}`],
    },
  });
}

function confirmationConsequenceFromRequest(
  confirmation: ToolCallResult["confirmationRequest"] | undefined,
  fallbackTitle: string
): string {
  if (confirmation?.consequence !== undefined && confirmation.consequence.trim().length > 0) {
    return confirmation.consequence;
  }
  const title = confirmation?.title ?? fallbackTitle;
  const resources = confirmation?.affectedResources ?? [];
  const target = resources.length === 0 ? "" : `目标：${resources.slice(0, 4).join("、")}。`;
  return `${target}批准后只执行本次${title}。`;
}

export function toSafeToolEventValue(value: unknown): unknown {
  return truncateDeep(toJsonSafe(value), 0, { omitVerboseOutput: false });
}

function toSafeToolEventSummaryValue(value: unknown): unknown {
  return truncateDeep(toJsonSafe(value), 0, { omitVerboseOutput: true });
}

function toProjectedToolEventOutput(result: ToolCallResult): unknown {
  if (result.projection === undefined) {
    return result.output;
  }
  return {
    action: toolDisplayName(result.toolName),
    summary: result.projection.uiSummary,
    diagnosticRef: result.projection.diagnosticRef,
    display: result.projection.display,
    envelope: result.projection.envelope,
    result: safeToolResultEnvelope(result.output),
    truncated: result.projection.truncated === true,
    redacted: result.projection.redacted === true,
  };
}

function safeToolResultEnvelope(output: unknown): Readonly<Record<string, unknown>> | undefined {
  const record = asRecord(output);
  const result = asRecord(record.result);
  if (Object.keys(result).length === 0) {
    return undefined;
  }
  const entries = Array.isArray(result.entries)
    ? result.entries.slice(0, 12).map((entry) => {
        const entryRecord = asRecord(entry);
        return {
          path: typeof entryRecord.path === "string" ? entryRecord.path : undefined,
          name: typeof entryRecord.name === "string" ? entryRecord.name : undefined,
          kind: typeof entryRecord.kind === "string" ? entryRecord.kind : undefined,
          bytes: typeof entryRecord.bytes === "number" ? entryRecord.bytes : undefined,
          depth: typeof entryRecord.depth === "number" ? entryRecord.depth : undefined,
        };
      })
    : undefined;
  const matches = Array.isArray(result.matches)
    ? result.matches.slice(0, 12).map((match) => {
        const matchRecord = asRecord(match);
        return {
          path: typeof matchRecord.path === "string" ? matchRecord.path : undefined,
          line: typeof matchRecord.line === "number" ? matchRecord.line : undefined,
        };
      })
    : undefined;
  const skippedSamples = Array.isArray(result.skippedSamples)
    ? result.skippedSamples.slice(0, 8).map((sample) => {
        const sampleRecord = asRecord(sample);
        return {
          path: typeof sampleRecord.path === "string" ? sampleRecord.path : undefined,
          reason: typeof sampleRecord.reason === "string" ? sampleRecord.reason : undefined,
          bytes: typeof sampleRecord.bytes === "number" ? sampleRecord.bytes : undefined,
          errorCode: typeof sampleRecord.errorCode === "string" ? sampleRecord.errorCode : undefined,
        };
      })
    : undefined;
  return {
    path: typeof result.path === "string" ? result.path : undefined,
    query: typeof result.query === "string" ? result.query : undefined,
    engine: typeof result.engine === "string" ? result.engine : undefined,
    command: typeof result.command === "string" ? result.command : undefined,
    args: Array.isArray(result.args) ? result.args.filter((value): value is string => typeof value === "string") : undefined,
    cwd: typeof result.cwd === "string" ? result.cwd : undefined,
    exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
    timedOut: result.timedOut === true ? true : undefined,
    background: result.background === true ? true : undefined,
    pid: typeof result.pid === "number" ? result.pid : undefined,
    logPath: typeof result.logPath === "string" ? result.logPath : undefined,
    stopCommand: typeof result.stopCommand === "string" ? result.stopCommand : undefined,
    durationMs: typeof result.durationMs === "number" ? result.durationMs : undefined,
    waitForPort: typeof result.waitForPort === "number" ? result.waitForPort : undefined,
    portReady: typeof result.portReady === "boolean" ? result.portReady : undefined,
    stdoutTruncated: typeof result.stdoutTruncated === "boolean" ? result.stdoutTruncated : undefined,
    stderrTruncated: typeof result.stderrTruncated === "boolean" ? result.stderrTruncated : undefined,
    stdoutChars: typeof result.stdoutChars === "number" ? result.stdoutChars : undefined,
    stderrChars: typeof result.stderrChars === "number" ? result.stderrChars : undefined,
    stdoutOmittedChars: typeof result.stdoutOmittedChars === "number" ? result.stdoutOmittedChars : undefined,
    stderrOmittedChars: typeof result.stderrOmittedChars === "number" ? result.stderrOmittedChars : undefined,
    bytes: typeof result.bytes === "number" ? result.bytes : undefined,
    append: typeof result.append === "boolean" ? result.append : undefined,
    overwrite: typeof result.overwrite === "boolean" ? result.overwrite : undefined,
    dryRun: typeof result.dryRun === "boolean" ? result.dryRun : undefined,
    replacements: typeof result.replacements === "number" ? result.replacements : undefined,
    wouldReplace: typeof result.wouldReplace === "number" ? result.wouldReplace : undefined,
    previousLength: typeof result.previousLength === "number" ? result.previousLength : undefined,
    nextLength: typeof result.nextLength === "number" ? result.nextLength : undefined,
    depth: typeof result.depth === "number" ? result.depth : undefined,
    maxDepth: typeof result.maxDepth === "number" ? result.maxDepth : undefined,
    entries,
    entriesReturned: typeof result.entriesReturned === "number" ? result.entriesReturned : undefined,
    matches,
    totalEntries: typeof result.totalEntries === "number" ? result.totalEntries : undefined,
    searchedFiles: typeof result.searchedFiles === "number" ? result.searchedFiles : undefined,
    skippedFactsAvailable: typeof result.skippedFactsAvailable === "boolean" ? result.skippedFactsAvailable : undefined,
    skippedFactsComplete: typeof result.skippedFactsComplete === "boolean" ? result.skippedFactsComplete : undefined,
    skippedFiles: typeof result.skippedFiles === "number" ? result.skippedFiles : undefined,
    skippedBinaryFiles: typeof result.skippedBinaryFiles === "number" ? result.skippedBinaryFiles : undefined,
    skippedTooLargeFiles: typeof result.skippedTooLargeFiles === "number" ? result.skippedTooLargeFiles : undefined,
    skippedUnreadableFiles: typeof result.skippedUnreadableFiles === "number" ? result.skippedUnreadableFiles : undefined,
    skippedDirectories: typeof result.skippedDirectories === "number" ? result.skippedDirectories : undefined,
    skippedOtherEntries: typeof result.skippedOtherEntries === "number" ? result.skippedOtherEntries : undefined,
    skippedSamples,
  };
}

function toJsonSafe(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toJsonSafe(item);
    }
    return result;
  }
  return String(value);
}

function truncateDeep(
  value: unknown,
  depth: number,
  options: { readonly omitVerboseOutput: boolean }
): unknown {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 497)}...` : value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 8).map((item) => truncateDeep(item, depth + 1, options));
    return value.length > 8 ? [...items, "[truncated]"] : items;
  }
  if (typeof value === "object" && value !== null) {
    if (depth >= 4) {
      return "[truncated]";
    }
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 16);
    const result: Record<string, unknown> = {};
    const hasVerboseOutput = options.omitVerboseOutput && entries.some(([key]) => isVerboseToolOutputKey(key));
    let verboseOutputOmitted = false;
    for (const [key, item] of entries) {
      if (options.omitVerboseOutput && (isVerboseToolOutputKey(key) || (hasVerboseOutput && isDerivedVerboseSummaryKey(key)))) {
        verboseOutputOmitted = true;
        continue;
      }
      result[key] = truncateDeep(item, depth + 1, options);
    }
    if (Object.keys(value as Record<string, unknown>).length > entries.length) {
      result.truncated = true;
    }
    if (verboseOutputOmitted) {
      result.verboseOutputOmitted = true;
    }
    return result;
  }
  return value;
}

function sanitizeError(value: string): string {
  return redactSensitiveText(value).slice(0, 500);
}

function isVerboseToolOutputKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === "content" ||
    normalized === "contentpreview" ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "output" ||
    normalized === "preview" ||
    normalized === "raw" ||
    normalized === "rawoutput" ||
    normalized === "rawresponse" ||
    normalized === "providerresponse" ||
    normalized === "fulltext" ||
    normalized === "pagetext" ||
    normalized === "pagebody" ||
    normalized === "html" ||
    normalized === "body" ||
    normalized === "prompt" ||
    normalized === "sanitizedmessages" ||
    normalized === "messages"
  );
}

function isDerivedVerboseSummaryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "summary" || normalized === "title";
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}
