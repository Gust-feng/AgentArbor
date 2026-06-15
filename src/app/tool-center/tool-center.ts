import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolDefinitionMetadata,
  ToolErrorDomain,
  ToolErrorFacts,
  ToolExecutionContext,
  ToolExecutor,
  ToolPermissionCheck,
  ToolSecurityDecision,
} from "../../domain/tools/index.js";
import { isToolErrorDomain, normalizeToolErrorFacts, normalizeToolErrorFactValue, toolDisplayName } from "../../domain/tools/index.js";
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
} from "../safe-projection.js";

export type ToolCenterOptions = {
  readonly maxCallsPerRun?: number;
  readonly platform?: NodeJS.Platform;
};

const DEFAULT_MAX_CALLS_PER_RUN = Number.MAX_SAFE_INTEGER;

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
    permission: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    const startedAt = Date.now();
    if (isAbortSignalAborted(context.abortSignal)) {
      return cancelledToolResult(request, startedAt);
    }
    const executor = this.tools.get(request.toolName);
    if (executor === undefined) {
      return failedToolResult(request, startedAt, {
        message: `${toolDisplayName(request.toolName)}未注册。`,
        errorDomain: "tool_error",
      });
    }

    if (permission.callerAgentId !== context.callerAgentId) {
      return failedToolResult(
        request,
        startedAt,
        {
          message: `${toolDisplayName(request.toolName)}调用者身份与本轮工具授权不一致。`,
          errorDomain: "tool_error",
        }
      );
    }

    if (!permission.allowedTools.includes(request.toolName)) {
      return failedToolResult(
        request,
        startedAt,
        {
          message: `${toolDisplayName(request.toolName)}未授权给当前 Agent。`,
          errorDomain: "tool_error",
        }
      );
    }

    if (this.callCount >= this.maxCallsPerRun) {
      return failedToolResult(request, startedAt, {
        message: `工具调用保护上限已触发：maxCallsPerRun=${this.maxCallsPerRun}。`,
        errorDomain: "runtime_error",
        facts: { maxCallsPerRun: this.maxCallsPerRun },
      });
    }

    const metadata = normalizeToolMetadata(executor.definition);
    const securityDecision = evaluateToolCallSecurity({
      request,
      definition: executor.definition,
      metadata,
      context: {
        platform: this.platform,
        approvedConfirmationIds: permission.approvedConfirmationIds,
        confirmationPolicy: permission.confirmationPolicy,
      },
    });
    if (securityDecision.decision === "blocked") {
      return failedToolResult(request, startedAt, {
        message: securityDecision.reason,
        errorDomain: "tool_error",
        facts: {
          code: securityDecision.code,
          affectedResources: [...securityDecision.affectedResources],
        },
        diagnosticRef: `tool:${request.callId}:${securityDecision.code}`,
      });
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
      return failedToolResult(request, startedAt, sanitizeError(error, request.toolName));
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
  error: SanitizedToolError
): ToolCallResult {
  const durationMs = Date.now() - startedAt;
  const diagnosticRef = error.diagnosticRef ?? `tool:${request.callId}:failed`;
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "failed",
    error: error.message,
    errorDomain: error.errorDomain,
    errorFacts: error.facts,
    durationMs,
    projection: projectToolFailure({
      request,
      error: error.message,
      diagnosticRef,
      errorDomain: error.errorDomain,
      errorFacts: error.facts,
      durationMs,
    }),
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
      actionSummary: decision.actionSummary,
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
      redacted: false,
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
    modelContract: cloneToolModelContract(definition.modelContract),
    metadata: normalizeToolMetadata(definition),
  };
}

function cloneToolModelContract(definition: ToolDefinition["modelContract"]): ToolDefinition["modelContract"] {
  if (definition === undefined) {
    return undefined;
  }
  return {
    purpose: definition.purpose,
    whenToUse: definition.whenToUse === undefined ? undefined : [...definition.whenToUse],
    whenNotToUse: definition.whenNotToUse === undefined ? undefined : [...definition.whenNotToUse],
    inputNotes: definition.inputNotes === undefined ? undefined : [...definition.inputNotes],
    usageNotes: definition.usageNotes === undefined ? undefined : [...definition.usageNotes],
    outputNotes: definition.outputNotes === undefined ? undefined : [...definition.outputNotes],
    examples: definition.examples === undefined
      ? undefined
      : definition.examples.map((example) => ({
          title: example.title,
          input: globalThis.structuredClone(example.input),
        })),
    runtimeHints: definition.runtimeHints === undefined
      ? undefined
      : definition.runtimeHints.map((hint) => ({ ...hint })),
  };
}

function normalizeToolMetadata(definition: ToolDefinition): ToolDefinitionMetadata {
  if (definition.metadata !== undefined) {
    return {
      ...definition.metadata,
      visibleResultPolicy: { ...definition.metadata.visibleResultPolicy },
      runtimeHints: cloneRuntimeHints(definition.metadata.runtimeHints),
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

function cloneRuntimeHints(value: ToolDefinitionMetadata["runtimeHints"]): ToolDefinitionMetadata["runtimeHints"] {
  if (value === undefined) {
    return undefined;
  }
  return value.map((hint) => {
    if (hint.kind === "command_shell") {
      return {
        ...hint,
        invocation: [...hint.invocation],
        notes: [...hint.notes],
      };
    }
    return hint;
  });
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

type SanitizedToolError = {
  readonly message: string;
  readonly errorDomain: ToolErrorDomain;
  readonly facts?: ToolErrorFacts;
  readonly diagnosticRef?: string;
};

function sanitizeError(error: unknown, toolName: string): SanitizedToolError {
  const message = error instanceof Error ? error.message : "Tool execution failed.";
  const facts = toolErrorFactsFromUnknown(error);
  return {
    message: redactOrdinaryText(message, 500),
    errorDomain: toolErrorDomainFromUnknown(error) ?? defaultToolErrorDomain(toolName, facts),
    facts,
  };
}

function defaultToolErrorDomain(toolName: string, facts: ToolErrorFacts | undefined): ToolErrorDomain {
  if (toolName === "shell_command" || toolName === "run_command") {
    return "process_error";
  }
  const code = typeof facts?.code === "string" ? facts.code.toLowerCase() : undefined;
  if (
    code !== undefined &&
    (code.includes("enoent") ||
      code.includes("spawn") ||
      code.includes("exit") ||
      code.includes("signal") ||
      code.includes("process"))
  ) {
    return "process_error";
  }
  return "tool_error";
}

function toolErrorDomainFromUnknown(value: unknown): ToolErrorDomain | undefined {
  const record = asRecord(value);
  return isToolErrorDomain(record.errorDomain) ? record.errorDomain : undefined;
}

function toolErrorFactsFromUnknown(value: unknown): ToolErrorFacts | undefined {
  const record = asRecord(value);
  const compactString = (text: string) => redactOrdinaryText(text, 500);
  const facts = normalizeToolErrorFacts(record.facts, { compactString });
  const code = normalizeToolErrorFactValue(record.code, { compactString });
  const name = typeof record.name === "string" && record.name.length > 0 ? record.name : undefined;
  const merged: Record<string, ToolErrorFacts[string]> = {};
  if (facts !== undefined) {
    Object.assign(merged, facts);
  }
  if (code !== undefined && merged.code === undefined) {
    merged.code = code;
  }
  if (name !== undefined && merged.name === undefined) {
    merged.name = name;
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? value as Readonly<Record<string, unknown>> : {};
}
