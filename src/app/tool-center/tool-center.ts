import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolDefinitionMetadata,
  ToolExecutionContext,
  ToolExecutor,
  ToolPermissionCheck,
  ToolSafeProjection,
  ToolSecurityDecision,
} from "../../domain/tools/index.js";
import type { ConfirmationRequest } from "../../domain/basic-agent/index.js";
import {
  confirmationRequestFromSecurityDecision,
  evaluateToolCallSecurity,
  projectToolStatusEnvelope,
} from "../../kernel/tools/index.js";
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
    const securityDecision = evaluateToolCallSecurity({
      request,
      definition: executor.definition,
      metadata,
      context: {
        platform: this.platform,
        approvedConfirmationIds: permission?.approvedConfirmationIds,
      },
    });
    if (securityDecision.decision === "blocked") {
      return failedToolResult(request, startedAt, securityDecision.reason, projectToolFailure({
        request,
        error: securityDecision.reason,
        diagnosticRef: `tool:${request.callId}:${securityDecision.code}`,
      }));
    }
    if (securityDecision.decision === "approval_required") {
      return approvalRequiredToolResult(request, startedAt, securityDecision);
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
  decision: Extract<ToolSecurityDecision, { readonly decision: "approval_required" }>
): ToolCallResult {
  const confirmationRequest: ConfirmationRequest = confirmationRequestFromSecurityDecision({ request, decision });
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "approval_required",
    error: decision.reason,
    durationMs: Date.now() - startedAt,
    projection: projectToolApprovalRequired({
      request,
      toolName: request.toolName,
      operationType: "confirmation_required",
    }),
    confirmationRequest,
  };
}

function cancelledToolResult(request: ToolCallRequest, startedAt: number): ToolCallResult {
  const diagnosticRef = `tool:${request.callId}:cancelled`;
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
      diagnosticRef,
      envelope: projectToolStatusEnvelope({
        request,
        status: "cancelled",
        summary: "Tool execution cancelled.",
        diagnosticRef,
      }),
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
      additionalProperties: definition.inputSchema.additionalProperties,
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

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Tool execution failed.";
  return redactOrdinaryText(message, 500);
}
