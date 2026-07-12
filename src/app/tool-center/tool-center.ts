import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolDefinitionMetadata,
  ToolErrorDomain,
  ToolErrorFacts,
  ToolExecutionContext,
  ToolExecutor,
  ToolExecutorResult,
  ToolPermissionCheck,
  ToolSecurityDecision,
} from "../../domain/tools/index.js";
import {
  isToolErrorDomain,
  InvalidToolFactError,
  normalizeToolErrorFacts,
  normalizeToolErrorFactValue,
  normalizeToolFactValue,
  toolDisplayName,
} from "../../domain/tools/index.js";
import type { ConfirmationRequest } from "../../domain/confirmation/contracts.js";
import {
  confirmationRequestFromSecurityDecision,
  evaluateToolCallSecurity,
} from "../../kernel/tools/index.js";

export type ToolCenterOptions = {
  readonly platform?: NodeJS.Platform;
};

export class ToolCenter {
  private readonly tools = new Map<string, ToolExecutor>();
  private readonly platform: NodeJS.Platform;

  constructor(options: ToolCenterOptions = {}) {
    this.platform = options.platform ?? process.platform;
  }

  register(executor: ToolExecutor): void {
    const metadata = normalizeToolMetadata(executor.definition);
    this.tools.set(executor.definition.name, {
      ...executor,
      definition: {
        ...executor.definition,
        metadata,
      },
    });
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
    let factRequest: ToolCallRequest;
    try {
      factRequest = { ...request, input: normalizeToolFactValue(request.input) };
    } catch (error) {
      if (!(error instanceof InvalidToolFactError)) {
        throw error;
      }
      return failedToolResult({ ...request, input: undefined }, startedAt, {
        message: `Tool input is not JSON-safe at ${error.path}: ${error.reason}.`,
        errorDomain: "runtime_error",
        facts: { ...error.facts, code: "invalid_tool_input_fact", phase: "input" },
      });
    }
    if (isAbortSignalAborted(context.abortSignal)) {
      return cancelledToolResult(factRequest, startedAt);
    }
    const executor = this.tools.get(factRequest.toolName);
    if (executor === undefined) {
      return failedToolResult(factRequest, startedAt, {
        message: `${toolDisplayName(factRequest.toolName)}未注册。`,
        errorDomain: "tool_error",
      });
    }

    if (permission.callerAgentId !== context.callerAgentId) {
      return failedToolResult(
        factRequest,
        startedAt,
        {
        message: `${toolDisplayName(factRequest.toolName)}调用者身份与本轮工具授权不一致。`,
          errorDomain: "tool_error",
        }
      );
    }

    if (!permission.allowedTools.includes(factRequest.toolName)) {
      return failedToolResult(
        factRequest,
        startedAt,
        {
          message: `${toolDisplayName(factRequest.toolName)}未授权给当前 Agent。`,
          errorDomain: "tool_error",
        }
      );
    }

    const metadata = normalizeToolMetadata(executor.definition);
    const securityDecision = evaluateToolCallSecurity({
      request: factRequest,
      definition: executor.definition,
      metadata,
      context: {
        platform: this.platform,
        approvedConfirmationIds: permission.approvedConfirmationIds,
        confirmationPolicy: permission.confirmationPolicy,
      },
    });
    if (securityDecision.decision === "blocked") {
      return failedToolResult(factRequest, startedAt, {
        message: securityDecision.reason,
        errorDomain: "tool_error",
        facts: {
          code: securityDecision.code,
          affectedResources: [...securityDecision.affectedResources],
        },
      });
    }
    if (securityDecision.decision === "approval_required") {
      return approvalRequiredToolResult(factRequest, startedAt, securityDecision);
    }

    try {
      const output = await executor.execute(factRequest.input, {
        ...context,
        toolCallId: factRequest.callId,
        approvedConfirmationIds: permission.approvedConfirmationIds,
        confirmationPolicy: permission.confirmationPolicy,
      });
      if (isAbortSignalAborted(context.abortSignal)) {
        return cancelledToolResult(factRequest, startedAt);
      }
      if (isToolExecutorResult(output)) {
        return normalizeExecutorResult(output.result, factRequest, startedAt);
      }
      return {
        callId: factRequest.callId,
        toolName: factRequest.toolName,
        input: factRequest.input,
        output: normalizeToolFactValue(output),
        status: "completed",
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (isAbortSignalAborted(context.abortSignal)) {
        return cancelledToolResult(factRequest, startedAt);
      }
      return failedToolResult(factRequest, startedAt, sanitizeError(error, factRequest.toolName));
    }
  }

}

function isToolExecutorResult(value: unknown): value is ToolExecutorResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly kind?: unknown }).kind === "tool_call_result" &&
    typeof (value as { readonly result?: unknown }).result === "object" &&
    (value as { readonly result?: unknown }).result !== null
  );
}

function normalizeExecutorResult(
  result: ToolCallResult,
  request: ToolCallRequest,
  startedAt: number
): ToolCallResult {
  const raw = result as ToolCallResult & Readonly<Record<string, unknown>>;
  const output = normalizeToolFactValue(raw.output);
  const durationMs = finiteDuration(raw.durationMs, startedAt);
  const status = toolCallStatus(raw.status);
  if (status === undefined) {
    return invalidExecutorResult({
      request,
      output,
      durationMs,
      code: "invalid_tool_result_status",
      message: "Tool executor returned an invalid completion status.",
    });
  }

  if (status === "approval_required") {
    const confirmationRequest = normalizeConfirmationRequest(raw.confirmationRequest);
    if (confirmationRequest === undefined) {
      return invalidExecutorResult({
        request,
        output,
        durationMs,
        code: "invalid_tool_confirmation_request",
        message: "Tool executor requested approval without a valid confirmation request.",
      });
    }
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: undefined,
      status,
      durationMs,
      confirmationRequest,
    };
  }

  if (status === "completed") {
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output,
      status,
      durationMs,
    };
  }

  const compactString = (text: string) => compactToolErrorText(text, 500);
  const errorFacts = normalizeToolErrorFacts(raw.errorFacts, { compactString });
  const errorDomain = isToolErrorDomain(raw.errorDomain)
    ? raw.errorDomain
    : status === "failed"
      ? defaultToolErrorDomain(request.toolName, errorFacts)
      : undefined;
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output,
    status,
    error: typeof raw.error === "string" && raw.error.trim().length > 0
      ? compactToolErrorText(raw.error, 500)
      : status === "cancelled"
        ? "Tool execution cancelled."
        : "Tool execution failed.",
    errorDomain,
    errorFacts,
    durationMs,
  };
}

function invalidExecutorResult(input: {
  readonly request: ToolCallRequest;
  readonly output: ToolCallResult["output"];
  readonly durationMs: number;
  readonly code: string;
  readonly message: string;
}): ToolCallResult {
  return {
    callId: input.request.callId,
    toolName: input.request.toolName,
    input: input.request.input,
    output: input.output,
    status: "failed",
    error: input.message,
    errorDomain: "runtime_error",
    errorFacts: {
      code: input.code,
      phase: "executor_result",
    },
    durationMs: input.durationMs,
  };
}

function finiteDuration(value: unknown, startedAt: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : Date.now() - startedAt;
}

function toolCallStatus(value: unknown): ToolCallResult["status"] | undefined {
  return value === "completed" || value === "failed" || value === "approval_required" || value === "cancelled"
    ? value
    : undefined;
}

function normalizeConfirmationRequest(value: unknown): ConfirmationRequest | undefined {
  const record = asPlainRecord(value);
  const confirmationId = nonEmptyString(record.confirmationId);
  const runId = nonEmptyString(record.runId);
  const title = nonEmptyString(record.title);
  const actionSummary = nonEmptyString(record.actionSummary);
  const requestedAt = nonEmptyString(record.requestedAt);
  const affectedResources = stringArray(record.affectedResources);
  const sourceRefs = stringArray(record.sourceRefs);
  const riskLevel = confirmationRiskLevel(record.riskLevel);
  const conversationId = optionalNonEmptyString(record.conversationId);
  const consequence = optionalNonEmptyString(record.consequence);
  const expiresAt = optionalNonEmptyString(record.expiresAt);
  const resumeAvailability = confirmationResumeAvailability(record.resumeAvailability);
  if (
    confirmationId === undefined ||
    runId === undefined ||
    title === undefined ||
    actionSummary === undefined ||
    requestedAt === undefined ||
    affectedResources === undefined ||
    sourceRefs === undefined ||
    riskLevel === undefined ||
    (record.conversationId !== undefined && conversationId === undefined) ||
    (record.consequence !== undefined && consequence === undefined) ||
    (record.expiresAt !== undefined && expiresAt === undefined) ||
    (record.resumeAvailability !== undefined && resumeAvailability === undefined)
  ) {
    return undefined;
  }
  return {
    confirmationId,
    runId,
    conversationId,
    title,
    actionSummary,
    consequence,
    affectedResources,
    riskLevel,
    resumeAvailability,
    requestedAt,
    expiresAt,
    sourceRefs,
  };
}

function asPlainRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value);
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => nonEmptyString(item) !== undefined)
    ? value.map((item) => nonEmptyString(item)!)
    : undefined;
}

function confirmationRiskLevel(value: unknown): ConfirmationRequest["riskLevel"] | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function confirmationResumeAvailability(
  value: unknown
): ConfirmationRequest["resumeAvailability"] | undefined {
  return value === undefined || value === "live" || value === "lost_after_restart"
    ? value
    : undefined;
}

function failedToolResult(
  request: ToolCallRequest,
  startedAt: number,
  error: SanitizedToolError
): ToolCallResult {
  const durationMs = Date.now() - startedAt;
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
    durationMs: Date.now() - startedAt,
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
  if (definition.metadata === undefined) {
    throw new Error(`Tool ${definition.name} cannot enter ToolCenter without metadata.`);
  }
  return {
    ...definition.metadata,
    runtimeHints: cloneRuntimeHints(definition.metadata.runtimeHints),
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
};

function sanitizeError(error: unknown, toolName: string): SanitizedToolError {
  if (error instanceof InvalidToolFactError) {
    return {
      message: compactToolErrorText(error.message, 500),
      errorDomain: error.errorDomain,
      facts: { ...error.facts, code: "invalid_tool_output_fact", phase: "output" },
    };
  }
  const message = error instanceof Error ? error.message : "Tool execution failed.";
  const facts = toolErrorFactsFromUnknown(error);
  return {
    message: compactToolErrorText(message, 500),
    errorDomain: toolErrorDomainFromUnknown(error) ?? defaultToolErrorDomain(toolName, facts),
    facts,
  };
}

function defaultToolErrorDomain(toolName: string, facts: ToolErrorFacts | undefined): ToolErrorDomain {
  if (toolName === "shell_command") {
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
  const compactString = (text: string) => compactToolErrorText(text, 500);
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

function compactToolErrorText(value: string, maxLength: number): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
