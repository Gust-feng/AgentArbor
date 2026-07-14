import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolDefinitionMetadata,
  ToolErrorDomain,
  ToolErrorFacts,
  ToolExecutionContext,
  ToolExecutionGateway,
  ToolExecutionPreflight,
  ToolExecutor,
  ToolExecutorResult,
  ToolPermissionCheck,
  ToolSecurityDecision,
} from "../../domain/tools/index.js";
import {
  copyToolModelAttachments,
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
import {
  ToolOutputStoreError,
  type ToolOutputMediaType,
  type ToolOutputStore,
} from "./tool-output-store.js";
import {
  DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS,
  MAX_TOOL_OUTPUT_READ_CHARS,
} from "./tool-output-limits.js";
import { utf16SafePrefixLength } from "./text-window.js";

export type ToolCenterOptions = {
  readonly platform?: NodeJS.Platform;
  readonly outputStore?: ToolOutputStore;
  readonly maxInlineOutputChars?: number;
};

const RETAINED_TOOL_OUTPUT_PREVIEW_CHARS = 4_000;
const RETAINED_TOOL_OUTPUT_READ_CHARS = MAX_TOOL_OUTPUT_READ_CHARS;
const MAX_INLINE_APPROVAL_PARTIAL_OUTPUT_CHARS = 24_000;
const TOOL_OUTPUT_READER_NAME = "read_tool_output";

type ToolExecutionPreflightInternal =
  | (Extract<ToolExecutionPreflight, { readonly status: "ready" }> & {
      readonly executor: ToolExecutor;
    })
  | Exclude<ToolExecutionPreflight, { readonly status: "ready" }>;

export class ToolCenter implements ToolExecutionGateway {
  private readonly tools = new Map<string, ToolExecutor>();
  private readonly platform: NodeJS.Platform;
  private readonly outputStore: ToolOutputStore | undefined;
  private readonly maxInlineOutputChars: number;

  constructor(options: ToolCenterOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.outputStore = options.outputStore;
    this.maxInlineOutputChars = positiveInlineOutputLimit(options.maxInlineOutputChars);
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

  preflight(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ): ToolExecutionPreflight {
    const outcome = this.preflightInternal(request, context, permission, Date.now());
    if (outcome.status === "ready") {
      return { status: "ready", request: outcome.request };
    }
    return outcome;
  }

  async execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    const startedAt = Date.now();
    const preflight = this.preflightInternal(request, context, permission, startedAt);
    if (preflight.status !== "ready") {
      return preflight.result;
    }
    const factRequest = preflight.request;
    const executor = preflight.executor;

    let output: unknown;
    try {
      output = await executor.execute(factRequest.input, {
        ...context,
        toolCallId: factRequest.callId,
        approvedConfirmationIds: permission.approvedConfirmationIds,
        confirmationPolicy: permission.confirmationPolicy,
      });
    } catch (error) {
      if (isAbortSignalAborted(context.abortSignal) && isAbortError(error)) {
        return cancelledToolResult(factRequest, startedAt, {
          abortRequested: true,
          sourceExecutionStatus: "unknown",
          doNotBlindlyRetry: true,
        });
      }
      const sanitized = sanitizeError(error, factRequest.toolName);
      const abortRequestedFacts: ToolErrorFacts = {
        abortRequested: true,
        sourceExecutionStatus: "unknown",
        doNotBlindlyRetry: true,
      };
      const failure = !isAbortSignalAborted(context.abortSignal)
        ? sanitized
        : {
            ...sanitized,
            facts: mergeToolErrorFacts(sanitized.facts, abortRequestedFacts),
            fullFacts: mergeToolErrorFacts(sanitized.fullFacts, abortRequestedFacts),
          };
      return this.prepareThrownErrorForDelivery(
        failedToolResult(factRequest, startedAt, failure),
        permission,
        failure,
        context.traceId,
      );
    }

    // Once the executor resolves, its returned value is the execution fact. A late abort
    // belongs to the owning loop; replacing this fact with `cancelled` could replay a side effect.
    try {
      if (isToolExecutorResult(output)) {
        return this.prepareResultForDelivery(
          normalizeExecutorResult(output.result, factRequest, startedAt),
          permission,
          context.traceId,
        );
      }
      return this.prepareResultForDelivery({
        callId: factRequest.callId,
        toolName: factRequest.toolName,
        input: factRequest.input,
        output: normalizeToolFactValue(output),
        status: "completed",
        durationMs: Date.now() - startedAt,
      }, permission, context.traceId);
    } catch (error) {
      const sanitized = sanitizeError(error, factRequest.toolName);
      const sourceExecutionStatus = isToolExecutorResult(output)
        ? toolCallStatus(output.result.status) ?? "unknown"
        : "completed";
      const failed = failedToolResult(factRequest, startedAt, sanitized);
      return this.prepareResultForDelivery(
        {
          ...failed,
          errorFacts: mergeToolErrorFacts(sanitized.facts, {
            sourceExecutionStatus,
            doNotBlindlyRetry: true,
            outputDeliveryPhase: "executor_result_normalization",
          }),
        },
        permission,
        context.traceId,
      );
    }
  }

  private preflightInternal(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
    startedAt: number,
  ): ToolExecutionPreflightInternal {
    let factRequest: ToolCallRequest;
    try {
      factRequest = { ...request, input: normalizeToolFactValue(request.input) };
    } catch (error) {
      if (!(error instanceof InvalidToolFactError)) {
        throw error;
      }
      return blockedPreflight(failedToolResult({ ...request, input: undefined }, startedAt, {
        message: `Tool input is not JSON-safe at ${error.path}: ${error.reason}.`,
        errorDomain: "runtime_error",
        facts: { ...error.facts, code: "invalid_tool_input_fact", phase: "input" },
      }));
    }
    if (isAbortSignalAborted(context.abortSignal)) {
      return blockedPreflight(cancelledToolResult(factRequest, startedAt));
    }
    const executor = this.tools.get(factRequest.toolName);
    if (executor === undefined) {
      return blockedPreflight(failedToolResult(factRequest, startedAt, {
        message: `${toolDisplayName(factRequest.toolName)}未注册。`,
        errorDomain: "tool_error",
      }));
    }

    if (permission.callerAgentId !== context.callerAgentId) {
      return blockedPreflight(failedToolResult(
        factRequest,
        startedAt,
        {
          message: `${toolDisplayName(factRequest.toolName)}调用者身份与本轮工具授权不一致。`,
          errorDomain: "tool_error",
        }
      ));
    }

    if (!permission.allowedTools.includes(factRequest.toolName)) {
      return blockedPreflight(failedToolResult(
        factRequest,
        startedAt,
        {
          message: `${toolDisplayName(factRequest.toolName)}未授权给当前 Agent。`,
          errorDomain: "tool_error",
        }
      ));
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
      return blockedPreflight(failedToolResult(factRequest, startedAt, {
        message: securityDecision.reason,
        errorDomain: "tool_error",
        facts: {
          code: securityDecision.code,
          affectedResources: [...securityDecision.affectedResources],
        },
      }));
    }
    if (securityDecision.decision === "approval_required") {
      return {
        status: "approval_required",
        result: approvalRequiredToolResult(factRequest, startedAt, securityDecision),
      };
    }
    return { status: "ready", request: factRequest, executor };
  }

  private async prepareResultForDelivery(
    result: ToolCallResult,
    permission: ToolPermissionCheck,
    ownerId: string,
  ): Promise<ToolCallResult> {
    if (result.toolName === TOOL_OUTPUT_READER_NAME) {
      return result;
    }
    const failureCandidate = oversizedExplicitFailureCandidate(
      result,
      this.maxInlineOutputChars,
    );
    if (failureCandidate !== undefined) {
      return this.prepareExplicitFailureForDelivery(
        result,
        permission,
        failureCandidate,
        ownerId,
      );
    }
    const inlineOutputLimit = result.status === "approval_required"
      ? Math.min(this.maxInlineOutputChars, MAX_INLINE_APPROVAL_PARTIAL_OUTPUT_CHARS)
      : this.maxInlineOutputChars;
    const candidate = oversizedOutputCandidate(result.output, inlineOutputLimit);
    if (candidate === undefined) {
      return result;
    }

    const preview = retainedOutputPreview(candidate.content);
    if (
      this.outputStore === undefined ||
      !this.tools.has(TOOL_OUTPUT_READER_NAME) ||
      !permission.allowedTools.includes(TOOL_OUTPUT_READER_NAME)
    ) {
      return outputRetentionFailure(result, candidate, preview, {
        code: "tool_output_reader_unavailable",
        message: "Tool output exceeded the model transport budget, but read_tool_output is not available in this run.",
      });
    }

    try {
      const retained = await this.outputStore.retain({
        mediaType: candidate.mediaType,
        content: candidate.content,
        sourceToolName: result.toolName,
        sourceCallId: result.callId,
        ownerId,
      });
      const deliveryOutput = copyToolModelAttachments(result.output, {
        contentRef: retained.ref,
        mediaType: retained.mediaType,
        contentChars: retained.totalChars,
        contentPreview: preview,
        hasMoreAfter: true,
        truncated: true,
        expiresAt: retained.expiresAt,
        continuationAvailability: "live_only",
        continuation: {
          ref: retained.ref,
          nextInput: {
            ref: retained.ref,
            startChar: 0,
            maxChars: RETAINED_TOOL_OUTPUT_READ_CHARS,
          },
          note: "Call read_tool_output with nextInput to read the retained result without executing the original tool again.",
        },
      });
      return { ...result, output: deliveryOutput };
    } catch (error) {
      const storeError = error instanceof ToolOutputStoreError ? error : undefined;
      return outputRetentionFailure(result, candidate, preview, {
        code: storeError?.code ?? "tool_output_retention_failed",
        message: storeError?.message ?? "Tool output could not be retained for model continuation.",
        facts: storeError?.facts,
      });
    }
  }

  private async prepareExplicitFailureForDelivery(
    result: ToolCallResult,
    permission: ToolPermissionCheck,
    candidate: OversizedOutputCandidate,
    ownerId: string,
  ): Promise<ToolCallResult> {
    const preview = retainedOutputPreview(candidate.content);
    if (
      this.outputStore === undefined ||
      !this.tools.has(TOOL_OUTPUT_READER_NAME) ||
      !permission.allowedTools.includes(TOOL_OUTPUT_READER_NAME)
    ) {
      return explicitFailureRetentionFailure(result, candidate, preview, {
        code: "tool_error_reader_unavailable",
        message: "Tool failure evidence exceeded the model transport budget, but read_tool_output is not available in this run.",
      });
    }

    try {
      const retained = await this.outputStore.retain({
        mediaType: candidate.mediaType,
        content: candidate.content,
        sourceToolName: result.toolName,
        sourceCallId: result.callId,
        ownerId,
      });
      return {
        ...result,
        output: copyToolModelAttachments(
          result.output,
          retainedContentDelivery(preview, retained),
        ),
        error: retainedErrorMessage(result.error),
        errorFacts: retainedExplicitFailureFacts(result.errorFacts, retained),
      };
    } catch (storeFailure) {
      const storeError = storeFailure instanceof ToolOutputStoreError ? storeFailure : undefined;
      return explicitFailureRetentionFailure(result, candidate, preview, {
        code: storeError?.code ?? "tool_error_retention_failed",
        message: storeError?.message ?? "Tool failure evidence could not be retained for model continuation.",
        facts: storeError?.facts,
      });
    }
  }

  private async prepareThrownErrorForDelivery(
    result: ToolCallResult,
    permission: ToolPermissionCheck,
    error: SanitizedToolError,
    ownerId: string,
  ): Promise<ToolCallResult> {
    const candidate = oversizedThrownErrorCandidate(error, this.maxInlineOutputChars);
    if (candidate === undefined) {
      return { ...result, errorFacts: error.fullFacts };
    }

    const preview = retainedOutputPreview(candidate.content);
    const deliveryResult = {
      ...result,
      error: retainedErrorMessage(result.error),
    };
    if (
      this.outputStore === undefined ||
      !this.tools.has(TOOL_OUTPUT_READER_NAME) ||
      !permission.allowedTools.includes(TOOL_OUTPUT_READER_NAME)
    ) {
      return errorRetentionFailure(deliveryResult, candidate, preview, {
        code: "tool_error_reader_unavailable",
        message: "Tool error evidence exceeded the model transport budget, but read_tool_output is not available in this run.",
      });
    }

    try {
      const retained = await this.outputStore.retain({
        mediaType: candidate.mediaType,
        content: candidate.content,
        sourceToolName: result.toolName,
        sourceCallId: result.callId,
        ownerId,
      });
      return {
        ...deliveryResult,
        output: retainedContentDelivery(preview, retained),
      };
    } catch (storeFailure) {
      const storeError = storeFailure instanceof ToolOutputStoreError ? storeFailure : undefined;
      return errorRetentionFailure(deliveryResult, candidate, preview, {
        code: storeError?.code ?? "tool_error_retention_failed",
        message: storeError?.message ?? "Tool error evidence could not be retained for model continuation.",
        facts: storeError?.facts,
      });
    }
  }

}

type OversizedOutputCandidate = {
  readonly mediaType: ToolOutputMediaType;
  readonly content: string;
};

type RetainedToolOutput = Awaited<ReturnType<ToolOutputStore["retain"]>>;

type RetainedContentDelivery = {
  readonly contentRef: string;
  readonly mediaType: ToolOutputMediaType;
  readonly contentChars: number;
  readonly contentPreview: string;
  readonly hasMoreAfter: true;
  readonly truncated: true;
  readonly expiresAt: string;
  readonly continuationAvailability: "live_only";
  readonly continuation: {
    readonly ref: string;
    readonly nextInput: {
      readonly ref: string;
      readonly startChar: number;
      readonly maxChars: number;
    };
    readonly note: string;
  };
};

function oversizedOutputCandidate(
  output: ToolCallResult["output"],
  maxInlineChars: number,
): OversizedOutputCandidate | undefined {
  if (output === undefined) {
    return undefined;
  }
  if (typeof output === "string") {
    return JSON.stringify(output).length > maxInlineChars
      ? { mediaType: "text/plain", content: output }
      : undefined;
  }
  const content = JSON.stringify(output);
  return content.length > maxInlineChars
    ? { mediaType: "application/json", content }
    : undefined;
}

function oversizedExplicitFailureCandidate(
  result: ToolCallResult,
  maxInlineChars: number,
): OversizedOutputCandidate | undefined {
  if (result.status !== "failed" && result.status !== "cancelled") {
    return undefined;
  }
  const content = JSON.stringify({
    status: result.status,
    ...(result.output === undefined ? {} : { output: result.output }),
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.errorDomain === undefined ? {} : { errorDomain: result.errorDomain }),
    ...(result.errorFacts === undefined ? {} : { errorFacts: result.errorFacts }),
  });
  return content.length > maxInlineChars
    ? { mediaType: "application/json", content }
    : undefined;
}

function retainedOutputPreview(content: string): string {
  if (content.length <= RETAINED_TOOL_OUTPUT_PREVIEW_CHARS) {
    return content;
  }
  const end = utf16SafePrefixLength(content, RETAINED_TOOL_OUTPUT_PREVIEW_CHARS - 1);
  return `${content.slice(0, end)}…`;
}

function retainedContentDelivery(
  preview: string,
  retained: RetainedToolOutput,
): RetainedContentDelivery {
  return {
    contentRef: retained.ref,
    mediaType: retained.mediaType,
    contentChars: retained.totalChars,
    contentPreview: preview,
    hasMoreAfter: true,
    truncated: true,
    expiresAt: retained.expiresAt,
    continuationAvailability: "live_only",
    continuation: {
      ref: retained.ref,
      nextInput: {
        ref: retained.ref,
        startChar: 0,
        maxChars: RETAINED_TOOL_OUTPUT_READ_CHARS,
      },
      note: "Call read_tool_output with nextInput to read the retained result without executing the original tool again.",
    },
  };
}

function oversizedThrownErrorCandidate(
  error: SanitizedToolError,
  maxInlineChars: number,
): OversizedOutputCandidate | undefined {
  const content = JSON.stringify({
    message: error.message,
    errorDomain: error.errorDomain,
    ...(error.fullFacts === undefined ? {} : { facts: error.fullFacts }),
  });
  return content.length > maxInlineChars
    ? { mediaType: "application/json", content }
    : undefined;
}

function retainedErrorMessage(value: string | undefined): string | undefined {
  return value === undefined ? undefined : retainedOutputPreview(value);
}

function retainedExplicitFailureFacts(
  facts: ToolErrorFacts | undefined,
  retained: RetainedToolOutput,
): ToolErrorFacts {
  return mergeToolErrorFacts(compactErrorFactsForDelivery(facts), {
    errorEvidenceCode: "tool_error_evidence_retained",
    errorEvidencePhase: "explicit_failure_retention",
    errorEvidenceRef: retained.ref,
    errorEvidenceChars: retained.totalChars,
  });
}

function explicitFailureRetentionFailure(
  result: ToolCallResult,
  candidate: OversizedOutputCandidate,
  preview: string,
  failure: {
    readonly code: string;
    readonly message: string;
    readonly facts?: Readonly<Record<string, string | number>>;
  },
): ToolCallResult {
  return {
    ...result,
    output: copyToolModelAttachments(result.output, {
      mediaType: candidate.mediaType,
      contentChars: candidate.content.length,
      contentPreview: preview,
      hasMoreAfter: true,
      contentIncomplete: true,
      retentionFailed: true,
    }),
    error: retainedErrorMessage(result.error) ?? failure.message,
    errorFacts: mergeToolErrorFacts(compactErrorFactsForDelivery(result.errorFacts), {
      ...(failure.facts ?? {}),
      errorEvidenceCode: failure.code,
      errorEvidencePhase: "explicit_failure_retention",
      errorEvidenceMessage: failure.message,
    }),
  };
}

function errorRetentionFailure(
  result: ToolCallResult,
  candidate: OversizedOutputCandidate,
  preview: string,
  failure: {
    readonly code: string;
    readonly message: string;
    readonly facts?: Readonly<Record<string, string | number>>;
  },
): ToolCallResult {
  return {
    ...result,
    output: {
      mediaType: candidate.mediaType,
      contentChars: candidate.content.length,
      contentPreview: preview,
      hasMoreAfter: true,
      contentIncomplete: true,
      retentionFailed: true,
    },
    errorFacts: mergeToolErrorFacts(result.errorFacts, {
      ...(failure.facts ?? {}),
      errorEvidenceCode: failure.code,
      errorEvidencePhase: "error_retention",
      errorEvidenceMessage: failure.message,
    }),
  };
}

function outputRetentionFailure(
  result: ToolCallResult,
  candidate: OversizedOutputCandidate,
  preview: string,
  failure: {
    readonly code: string;
    readonly message: string;
    readonly facts?: Readonly<Record<string, string | number>>;
  },
): ToolCallResult {
  const output = copyToolModelAttachments(result.output, {
    mediaType: candidate.mediaType,
    contentChars: candidate.content.length,
    contentPreview: preview,
    retentionFailed: true,
    contentIncomplete: true,
    deliveryStatus: "failed",
    deliveryCode: failure.code,
    deliveryMessage: failure.message,
    sourceExecutionStatus: result.status,
    doNotBlindlyRetry: result.status === "completed",
  });
  if (result.status !== "completed") {
    return {
      ...result,
      output,
      error: result.error ?? failure.message,
      errorDomain: result.errorDomain ?? "runtime_error",
      errorFacts: mergeToolErrorFacts(compactErrorFactsForDelivery(result.errorFacts), {
        ...(failure.facts ?? {}),
        outputDeliveryCode: failure.code,
        outputDeliveryPhase: "output_retention",
        outputDeliveryMessage: failure.message,
        originalStatus: result.status,
      }),
    };
  }
  return {
    ...result,
    output,
    status: "failed",
    error: failure.message,
    errorDomain: "runtime_error",
    errorFacts: {
      code: failure.code,
      phase: "output_retention",
      originalStatus: result.status,
      outputDeliveryCode: failure.code,
      ...(failure.facts ?? {}),
    },
    confirmationRequest: undefined,
  };
}

function compactErrorFactsForDelivery(facts: ToolErrorFacts | undefined): ToolErrorFacts | undefined {
  return normalizeToolErrorFacts(facts, {
    compactString: (value) => compactToolErrorText(value, 500),
  });
}

function positiveInlineOutputLimit(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error("ToolCenter maxInlineOutputChars must be a positive safe integer.");
  }
  return resolved;
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
      output,
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

  const errorFacts = normalizeToolErrorFacts(raw.errorFacts);
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
      ? raw.error
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
      sourceExecutionStatus: "unknown",
      doNotBlindlyRetry: true,
      outputDeliveryPhase: "executor_result_normalization",
      outputDeliveryCode: input.code,
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
): ToolCallResult & { readonly status: "failed" } {
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

function blockedPreflight(
  result: ToolCallResult & { readonly status: "failed" | "cancelled" },
): Extract<ToolExecutionPreflight, { readonly status: "blocked" }> {
  return { status: "blocked", result };
}

function approvalRequiredToolResult(
  request: ToolCallRequest,
  startedAt: number,
  decision: Extract<ToolSecurityDecision, { readonly decision: "approval_required" }>
): ToolCallResult & { readonly status: "approval_required" } {
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

function cancelledToolResult(
  request: ToolCallRequest,
  startedAt: number,
  errorFacts?: ToolErrorFacts,
): ToolCallResult & { readonly status: "cancelled" } {
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "cancelled",
    error: "Tool execution cancelled.",
    errorFacts,
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

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as { readonly name?: unknown; readonly code?: unknown };
  return record.name === "AbortError" || record.code === "ABORT_ERR";
}

type SanitizedToolError = {
  readonly message: string;
  readonly errorDomain: ToolErrorDomain;
  readonly facts?: ToolErrorFacts;
  readonly fullFacts?: ToolErrorFacts;
};

function sanitizeError(error: unknown, toolName: string): SanitizedToolError {
  if (error instanceof InvalidToolFactError) {
    const facts = { ...error.facts, code: "invalid_tool_output_fact", phase: "output" };
    return {
      message: normalizeToolErrorText(error.message),
      errorDomain: error.errorDomain,
      facts,
      fullFacts: facts,
    };
  }
  const message = normalizeToolErrorText(
    error instanceof Error ? error.message : "Tool execution failed.",
  );
  const fullFacts = toolErrorFactsFromUnknown(error, false);
  const facts = toolErrorFactsFromUnknown(error, true);
  return {
    message,
    errorDomain: toolErrorDomainFromUnknown(error) ?? defaultToolErrorDomain(toolName, facts),
    facts,
    fullFacts,
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

function toolErrorFactsFromUnknown(value: unknown, compact: boolean): ToolErrorFacts | undefined {
  const record = asRecord(value);
  const compactString = compact
    ? (text: string) => compactToolErrorText(text, 500)
    : normalizeToolErrorText;
  const facts = normalizeToolErrorFacts(record.facts, { compactString });
  const code = normalizeToolErrorFactValue(record.code, { compactString });
  const name = typeof record.name === "string" && record.name.length > 0 ? record.name : undefined;
  const merged: Record<string, ToolErrorFacts[string]> = {};
  if (facts !== undefined) {
    for (const [key, fact] of Object.entries(facts)) {
      defineOwnFact(merged, key, fact);
    }
  }
  if (code !== undefined && merged.code === undefined) {
    merged.code = code;
  }
  if (name !== undefined && merged.name === undefined) {
    merged.name = name;
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

function defineOwnFact(
  target: Record<string, ToolErrorFacts[string]>,
  key: string,
  value: ToolErrorFacts[string]
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function mergeToolErrorFacts(
  original: ToolErrorFacts | undefined,
  additions: Readonly<Record<string, ToolErrorFacts[string]>>,
): ToolErrorFacts {
  const merged: Record<string, ToolErrorFacts[string]> = {};
  for (const [key, value] of Object.entries(original ?? {})) {
    defineOwnFact(merged, key, value);
  }
  for (const [key, value] of Object.entries(additions)) {
    defineOwnFact(merged, key, value);
  }
  return merged;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? value as Readonly<Record<string, unknown>> : {};
}

function compactToolErrorText(value: string, maxLength: number): string {
  const normalized = normalizeToolErrorText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const suffix = maxLength >= 3 ? "..." : ".".repeat(Math.max(0, maxLength));
  const end = utf16SafePrefixLength(normalized, Math.max(0, maxLength - suffix.length));
  return `${normalized.slice(0, end).trimEnd()}${suffix}`;
}

function normalizeToolErrorText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}
