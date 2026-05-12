import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolDefinitionMetadata,
  ToolExecutionContext,
  ToolExecutor,
  ToolPermissionCheck,
  ToolSafeProjection,
} from "../../domain/tools/index.js";
import type { ConfirmationRequest } from "../../domain/basic-agent/index.js";
import { nowIso } from "../../kernel/id.js";
import {
  projectToolApprovalRequired,
  projectToolFailure,
  projectToolResult,
  redactOrdinaryText,
} from "../basic-agent-runtime/index.js";

export type ToolCenterOptions = {
  readonly maxCallsPerRun?: number;
  readonly platform?: NodeJS.Platform;
};

const DEFAULT_MAX_CALLS_PER_RUN = 20;

export class ToolCenter {
  private readonly tools = new Map<string, ToolExecutor>();
  private callCount = 0;
  private readonly maxCallsPerRun: number;
  private readonly platform: NodeJS.Platform;

  constructor(options: ToolCenterOptions = {}) {
    this.maxCallsPerRun = Math.max(0, Math.floor(options.maxCallsPerRun ?? DEFAULT_MAX_CALLS_PER_RUN));
    this.platform = options.platform ?? process.platform;
  }

  register(executor: ToolExecutor): void {
    this.tools.set(executor.definition.name, executor);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((executor) => cloneToolDefinition(executor.definition));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission?: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    const startedAt = Date.now();
    if (isAbortSignalAborted(context.abortSignal)) {
      return cancelledToolResult(request, startedAt);
    }
    const executor = this.tools.get(request.toolName);
    if (executor === undefined) {
      return failedToolResult(request, startedAt, `Tool is not registered: ${request.toolName}`);
    }

    if (permission?.allowedTools !== undefined && !permission.allowedTools.includes(request.toolName)) {
      return failedToolResult(
        request,
        startedAt,
        `Tool ${request.toolName} is not allowed for agent ${permission.callerAgentId}.`
      );
    }

    if (this.callCount >= this.maxCallsPerRun) {
      return failedToolResult(request, startedAt, `Tool call budget exhausted: maxCallsPerRun=${this.maxCallsPerRun}.`);
    }

    const metadata = normalizeToolMetadata(executor.definition);
    if (requiresConfirmation(request, metadata, this.platform, permission?.approvedConfirmationIds)) {
      return approvalRequiredToolResult(request, startedAt, executor.definition, metadata);
    }

    this.callCount += 1;
    try {
      const output = await executor.execute(request.input, context);
      if (isAbortSignalAborted(context.abortSignal)) {
        return cancelledToolResult(request, startedAt);
      }
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output,
        status: "completed",
        durationMs: Date.now() - startedAt,
        projection: projectToolResult({
          request,
          output,
          maxPreviewChars: metadata.visibleResultPolicy.maxPreviewChars,
        }),
      };
    } catch (error) {
      if (isAbortSignalAborted(context.abortSignal)) {
        return cancelledToolResult(request, startedAt);
      }
      return failedToolResult(request, startedAt, sanitizeError(error));
    }
  }

  resetCallCount(): void {
    this.callCount = 0;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

function failedToolResult(
  request: ToolCallRequest,
  startedAt: number,
  error: string,
  projection?: ToolSafeProjection
): ToolCallResult {
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "failed",
    error,
    durationMs: Date.now() - startedAt,
    projection: projection ?? projectToolFailure({ request, error }),
  };
}

function approvalRequiredToolResult(
  request: ToolCallRequest,
  startedAt: number,
  definition: ToolDefinition,
  metadata: ToolDefinitionMetadata
): ToolCallResult {
  const confirmationRequest: ConfirmationRequest = {
    confirmationId: confirmationIdForToolCall(request.callId),
    runId: request.callId,
    title: "需要确认",
    actionSummary: redactOrdinaryText(
      `工具 ${definition.name} 请求执行 ${metadata.operationType} 操作。${definition.description}`,
      500
    ),
    affectedResources: affectedResourcesFromInput(request.input),
    riskLevel: metadata.riskLevel,
    requestedAt: nowIso(),
    sourceRefs: [`tool:${request.callId}`],
  };
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "approval_required",
    error: `Tool ${request.toolName} requires user confirmation before ${metadata.operationType} execution.`,
    durationMs: Date.now() - startedAt,
    projection: projectToolApprovalRequired({
      request,
      toolName: request.toolName,
      operationType: metadata.operationType,
    }),
    confirmationRequest,
  };
}

function cancelledToolResult(request: ToolCallRequest, startedAt: number): ToolCallResult {
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "cancelled",
    error: "Tool execution cancelled.",
    durationMs: Date.now() - startedAt,
    projection: {
      uiSummary: "工具执行已取消。",
      diagnosticRef: `tool:${request.callId}:cancelled`,
      truncated: false,
      redacted: true,
    },
  };
}

function cloneToolDefinition(definition: ToolDefinition): ToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: {
      type: definition.inputSchema.type,
      properties: { ...definition.inputSchema.properties },
      required:
        definition.inputSchema.required === undefined ? undefined : [...definition.inputSchema.required],
    },
    metadata: normalizeToolMetadata(definition),
  };
}

function normalizeToolMetadata(definition: ToolDefinition): ToolDefinitionMetadata {
  if (definition.metadata !== undefined) {
    return {
      ...definition.metadata,
      visibleResultPolicy: { ...definition.metadata.visibleResultPolicy },
    };
  }
  return {
    category: "other",
    riskLevel: "low",
    operationType: "read-only",
    requiresConfirmation: false,
    visibleResultPolicy: {
      userVisible: "summary-only",
      maxPreviewChars: 800,
      omitRawOutput: true,
    },
  };
}

function requiresConfirmation(
  request: ToolCallRequest,
  metadata: ToolDefinitionMetadata,
  platform: NodeJS.Platform,
  approvedConfirmationIds: readonly string[] | undefined
): boolean {
  if (approvedConfirmationIds?.includes(confirmationIdForToolCall(request.callId)) === true) {
    return false;
  }
  if (metadata.requiresConfirmation) {
    return true;
  }
  return platform === "win32" && metadata.operationType !== "read-only";
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function confirmationIdForToolCall(callId: string): string {
  return `confirmation-${callId}`;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Tool execution failed.";
  return redactOrdinaryText(message, 500);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function affectedResourcesFromInput(input: unknown): readonly string[] {
  const record = asRecord(input);
  const values = [
    stringOrUndefined(record.path),
    stringOrUndefined(record.command),
    stringOrUndefined(record.url),
    stringOrUndefined(record.ref),
  ];
  return values.filter((value): value is string => value !== undefined).map((value) => redactOrdinaryText(value, 240)).slice(0, 8);
}
