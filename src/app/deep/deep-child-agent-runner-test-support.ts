import type {
  BasicAgentCapabilitySnapshot,
  CapabilityToolCatalogItem,
} from "../../domain/config/index.js";
import type {
  IntelligenceChannel,
  ModelOutputValidationResult,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolExecutor,
  ToolFactValue,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import { createChildAgentRun, type ChildAgentRun } from "../../domain/underground/agent-fabric.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import type { DeepChildSpec } from "./contracts.js";
import { createDeepChildAgentSpec, DEEP_MANAGER_AGENT_ID } from "./child-delegation.js";
export function sampleChildSpec(input: {
  readonly allowedTools: readonly string[];
  readonly objective: string;
}): DeepChildSpec {
  return {
    specId: "child-spec-risk",
    displayName: "风险视角",
    role: "risk",
    objective: input.objective,
    allowedTools: input.allowedTools,
    inputRefs: ["goal:goal-test"],
  };
}

export function makeChildRun(childSpec: DeepChildSpec) {
  const spec = createDeepChildAgentSpec({
    childSpec,
    index: 0,
    goalId: "goal-test",
    traceId: "trace-test",
    createdAt: "2026-05-01T00:00:00.000Z",
  });
  return createChildAgentRun({
    childRunId: "deep-child-run-test",
    parentAgentId: DEEP_MANAGER_AGENT_ID,
    spec,
    inputRefs: spec.inputRefs,
    startedAt: "2026-05-01T00:00:00.000Z",
  });
}

export type ResponseStep = (request: ModelRequest) => ModelResponse;

export class SequenceChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly steps: readonly ResponseStep[]) {}

  async request(request: ModelRequest, _options?: ModelRequestOptions): Promise<ModelResponse> {
    this.requests.push(request);
    const step = this.steps[this.index];
    this.index += 1;
    if (step === undefined) {
      throw new Error(`Missing test model response at index ${this.index - 1}`);
    }
    return step(request);
  }

  validateResponse(_request: ModelRequest, _response: ModelResponse): ModelOutputValidationResult {
    return pendingModelOutputValidation();
  }
}

export class RecordingToolBroker implements ToolExecutionBroker {
  private readonly definitions: readonly ToolDefinition[];
  private readonly executed: ToolCallRequest[] = [];

  constructor(
    toolNames: readonly string[],
    private readonly approvalRequiredToolNames: readonly string[] = [],
  ) {
    this.definitions = toolNames.map((name) => ({
      name,
      description: `${name} test tool`,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    }));
  }

  list(): ToolDefinition[] {
    return this.definitions.map((definition) => ({ ...definition }));
  }

  has(name: string): boolean {
    return this.definitions.some((definition) => definition.name === name);
  }

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ): Promise<ToolCallResult> {
    const confirmationId = `confirm-${request.callId}`;
    if (
      this.approvalRequiredToolNames.includes(request.toolName) &&
      permission.approvedConfirmationIds?.includes(confirmationId) !== true
    ) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: undefined,
        status: "approval_required",
        durationMs: 1,
        confirmationRequest: {
          confirmationId,
          runId: "deep-child-run-test",
          title: "需要确认工具调用",
          actionSummary: `运行 ${request.toolName}`,
          affectedResources: [request.toolName],
          riskLevel: "medium",
          requestedAt: "2026-05-01T00:00:00.000Z",
          sourceRefs: [request.callId],
        },
      };
    }
    this.executed.push(request);
    const query = typeof request.input === "object" && request.input !== null && "query" in request.input
      ? String((request.input as { readonly query?: unknown }).query ?? request.toolName)
      : request.toolName;
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {
        query,
        results: [{
          title: `${request.toolName} evidence`,
          refId: `tool:${request.toolName}:oauth-risk`,
          snippet: "测试工具结果摘要",
        }],
      },
      status: "completed",
      durationMs: 1,
    };
  }

  executedToolNames(): readonly string[] {
    return this.executed.map((request) => request.toolName);
  }
}

export function toolCallResponse(callId: string, toolName: string, input: unknown, textOutput?: string): ResponseStep {
  return (request) => ({
    ...baseResponse(request),
    responseId: `response-${callId}`,
    textOutput,
    toolCalls: [{ callId, toolName, input: input as ToolFactValue | undefined }],
    finishReason: "tool_call",
  });
}

export function completedJsonResponse(output: unknown): ResponseStep {
  return (request) => ({
    ...baseResponse(request),
    responseId: "response-final",
    structuredOutput: output,
    finishReason: "stop",
  });
}

export function testTool(name: string, execute: ToolExecutor["execute"]): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      metadata: {
        category: "other",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    execute,
  };
}

export function capabilitySnapshotWithTools(toolNames: readonly string[]): BasicAgentCapabilitySnapshot {
  const tools = toolNames.map(capabilityTool);
  return {
    snapshotId: "snapshot-deep-child-tool-output",
    createdAt: "2026-05-01T00:00:00.000Z",
    activeModel: {
      profileId: "fake",
      providerKind: "local",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "http://localhost",
      defaultAiMode: "fake",
      secretRef: "secret:test",
      secretConfigured: true,
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    modelCapabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 4_096,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "stable",
    },
    toolCatalog: {
      scope: "desktop-basic",
      tools,
      allowedTools: toolNames,
    },
    skillCatalog: [],
    subAgentCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:\\AgentArbor",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    securitySummary: "test",
    warnings: [],
  };
}

function capabilityTool(name: string): CapabilityToolCatalogItem {
  return {
    name,
    displayName: name,
    displayDescription: `${name} tool`,
    description: `${name} tool`,
    category: "other",
    categoryLabel: "Other",
    riskLevel: "low",
    riskLabel: "Low",
    operationType: "read-only",
    operationLabel: "Read only",
    requiresConfirmation: false,
    confirmationLabel: "No confirmation required",
    scopes: ["desktop-basic"],
    enabled: true,
    availability: "available",
  };
}

export function failedModelResponse(
  message: string,
  kind: NonNullable<ModelResponse["failure"]>["kind"] = "provider_response",
): ResponseStep {
  return (request) => ({
    ...baseResponse(request),
    responseId: "response-failed",
    status: "failed",
    finishReason: "error",
    failure: {
      kind,
      retryable: true,
      message,
      sanitizedErrorRef: `model-error:${kind}`,
    },
  });
}

function baseResponse(request: ModelRequest): ModelResponse {
  return {
    responseId: "response-test",
    requestId: request.requestId,
    providerId: "test-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "test-model",
    status: "completed",
    outputKind: request.outputContract.outputKind,
    validation: pendingModelOutputValidation(),
    completedAt: "2026-05-01T00:00:01.000Z",
  };
}
