import {
  Agent,
  type AgentOutputType,
  type FunctionTool,
  type ModelSettings,
  RunContext,
  type Tool,
  tool,
} from "@openai/agents";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolFactValue,
  ToolInputSchema,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import { modelVisibleToolDescription, normalizeToolFactValue } from "../../domain/tools/index.js";
import type {
  AgentLoopAgentTool,
  AgentLoopAgentToolInvocation,
  AgentLoopInput,
  AgentLoopToolBoundary,
} from "../../app/model-runtime/agent-loop.js";
import type { OpenAIAgentsInputMapper } from "./openai-agents-input.js";

type SdkNonStrictObjectSchema = {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required: string[];
  readonly additionalProperties: true;
};

type SdkStrictObjectSchema = {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required: string[];
  readonly additionalProperties: false;
};

type FrozenToolBoundary = {
  readonly gateway: AgentLoopToolBoundary["gateway"];
  readonly context: Omit<ToolExecutionContext, "abortSignal" | "toolCallId">;
  readonly permission: ToolPermissionCheck;
};

export type OpenAIAgentsPreflightFact = {
  readonly request: ToolCallRequest;
  readonly result?: ToolCallResult;
  readonly needsApproval: boolean;
  readonly boundary: FrozenToolBoundary;
};

export type OpenAIAgentsExecutionState = {
  abortSignal: AbortSignal;
  readonly input: AgentLoopInput;
  readonly baseMessages: readonly ModelMessage[];
  readonly toolResults: ToolCallResult[];
  readonly preflightByCallId: Map<string, OpenAIAgentsPreflightFact>;
  readonly modelInput: OpenAIAgentsInputMapper;
};

export type OpenAIAgentsSdkExecutionContext = {
  readonly execution: OpenAIAgentsExecutionState;
};

export type OpenAIAgentsToolAssembly = {
  readonly tools: readonly Tool<OpenAIAgentsSdkExecutionContext>[];
  readonly definitions: readonly ToolDefinition[];
};

export function createOpenAIAgentsToolAssembly(input: {
  readonly execution: OpenAIAgentsExecutionState;
  readonly model: string;
  readonly nestedModelSettings: ModelSettings;
}): OpenAIAgentsToolAssembly {
  const definitions = frozenToolDefinitions(input.execution.input);
  const agentTools = [...(input.execution.input.agentTools ?? [])];
  assertUniqueToolNames(definitions, agentTools);
  return {
    definitions,
    tools: [
      ...definitions.map((definition) => createSdkTool({
        definition,
        execution: input.execution,
        boundary: async () => input.execution.input.tools,
      })),
      ...agentTools.map((agentTool) => createSdkAgentTool({
        agentTool,
        mechanicalTools: definitions,
        execution: input.execution,
        model: input.model,
        modelSettings: input.nestedModelSettings,
      })),
    ],
  };
}

function createSdkTool(input: {
  readonly definition: ToolDefinition;
  readonly execution: OpenAIAgentsExecutionState;
  readonly boundary: (
    runContext: RunContext<OpenAIAgentsSdkExecutionContext> | undefined,
  ) => Promise<AgentLoopToolBoundary>;
  readonly isEnabled?: (
    runContext: RunContext<OpenAIAgentsSdkExecutionContext>,
  ) => Promise<boolean>;
}): FunctionTool<OpenAIAgentsSdkExecutionContext, SdkNonStrictObjectSchema> {
  const parameters = sdkToolInputSchema(input.definition);
  return tool<SdkNonStrictObjectSchema, OpenAIAgentsSdkExecutionContext>({
    name: input.definition.name,
    description: modelVisibleToolDescription(input.definition),
    parameters,
    strict: false,
    isEnabled: input.isEnabled === undefined
      ? true
      : ({ runContext }) => input.isEnabled!(requireSdkRunContext(runContext)),
    needsApproval: async (runContext, toolInput, callId) => {
      const exactCallId = requiredCallId(callId);
      const existing = input.execution.preflightByCallId.get(exactCallId);
      if (existing !== undefined) {
        return existing.needsApproval;
      }
      const boundary = freezeBoundary(await input.boundary(requireSdkRunContext(runContext)));
      const request = toolCallRequest(exactCallId, input.definition.name, toolInput);
      const preflight = boundary.gateway.preflight(
        request,
        executionContext(input.execution, boundary, exactCallId),
        boundary.permission,
      );
      if (preflight.status === "ready") {
        input.execution.preflightByCallId.set(exactCallId, {
          request: preflight.request,
          needsApproval: false,
          boundary,
        });
        return false;
      }
      const fact: OpenAIAgentsPreflightFact = {
        request,
        result: preflight.result,
        needsApproval: preflight.status === "approval_required",
        boundary,
      };
      input.execution.preflightByCallId.set(exactCallId, fact);
      input.execution.toolResults.push(preflight.result);
      return fact.needsApproval;
    },
    execute: async (toolInput, runContext, details) => {
      const callId = requiredCallId(details?.toolCall?.callId);
      const cached = input.execution.preflightByCallId.get(callId);
      if (cached?.result !== undefined && cached.result.status !== "approval_required") {
        return input.execution.modelInput.toolResult(cached.result);
      }
      const boundary = cached?.boundary ?? freezeBoundary(await input.boundary(requireSdkRunContext(runContext)));
      const request = cached?.request ?? toolCallRequest(callId, input.definition.name, toolInput);
      const approvedConfirmationId = cached?.result?.confirmationRequest?.confirmationId;
      const approvedConfirmationIds = cached?.needsApproval === true
        ? uniqueStrings([
            ...(boundary.permission.approvedConfirmationIds ?? []),
            ...(approvedConfirmationId === undefined ? [] : [approvedConfirmationId]),
          ])
        : boundary.permission.approvedConfirmationIds;
      const result = await boundary.gateway.execute(
        request,
        executionContext(input.execution, boundary, callId),
        { ...boundary.permission, approvedConfirmationIds },
      );
      input.execution.toolResults.push(result);
      return input.execution.modelInput.toolResult(result);
    },
  });
}

function createSdkAgentTool(input: {
  readonly agentTool: AgentLoopAgentTool;
  readonly mechanicalTools: readonly ToolDefinition[];
  readonly execution: OpenAIAgentsExecutionState;
  readonly model: string;
  readonly modelSettings: ModelSettings;
}): Tool<OpenAIAgentsSdkExecutionContext> {
  const resolveContribution = invocationResolver(input.agentTool);
  const resolveInvocation = async (value: unknown): Promise<AgentLoopAgentToolInvocation> =>
    validateInvocationBoundary(
      input.execution.input.tools,
      await resolveContribution(value),
    );
  const childTools = input.mechanicalTools.map((definition) => createSdkTool({
    definition,
    execution: input.execution,
    boundary: async (runContext) => childBoundary(
      input.execution.input.tools,
      await resolveInvocation(requireSdkRunContext(runContext).toolInput),
    ),
    isEnabled: async (runContext) => {
      const invocation = await resolveInvocation(runContext.toolInput);
      return invocation.allowedTools.includes(definition.name);
    },
  }));
  const child = new Agent<OpenAIAgentsSdkExecutionContext, AgentOutputType>({
    name: `AgentArborSubAgent:${input.agentTool.toolName}`,
    instructions: async (runContext) => (await resolveInvocation(runContext.toolInput)).instructions,
    model: input.model,
    modelSettings: input.modelSettings,
    tools: childTools,
  });
  const started = new Map<string, { readonly input: ToolFactValue; readonly at: number }>();
  const completed = new Set<string>();
  const runOptions = {
    maxTurns: null,
    get signal(): AbortSignal {
      return input.execution.abortSignal;
    },
  };
  return child.asTool({
    toolName: input.agentTool.toolName,
    toolDescription: input.agentTool.toolDescription,
    parameters: strictAgentToolInputSchema(input.agentTool),
    inputBuilder: async ({ params }) => (await resolveInvocation(params)).input,
    needsApproval: async (_runContext, params, callId) => {
      const exactCallId = requiredCallId(callId);
      if (!started.has(exactCallId)) {
        started.set(exactCallId, { input: requiredToolFact(params), at: Date.now() });
      }
      return false;
    },
    customOutputExtractor: (result) => {
      if (result.interruptions.length > 0) {
        return "";
      }
      const invocation = result.agentToolInvocation;
      const callId = requiredCallId(invocation.toolCallId);
      const finalOutput = typeof result.finalOutput === "string" ? result.finalOutput : String(result.finalOutput ?? "");
      if (!completed.has(callId)) {
        const start = started.get(callId);
        input.execution.toolResults.push({
          callId,
          toolName: input.agentTool.toolName,
          input: start?.input ?? parseToolInput(invocation.toolArguments),
          output: finalOutput,
          status: "completed",
          durationMs: start === undefined ? 0 : Math.max(0, Date.now() - start.at),
        });
        completed.add(callId);
      }
      return finalOutput;
    },
    runOptions,
    resumeState: { contextStrategy: "merge" },
  });
}

function invocationResolver(agentTool: AgentLoopAgentTool): (
  input: unknown,
) => Promise<AgentLoopAgentToolInvocation> {
  const cache = new WeakMap<object, Promise<AgentLoopAgentToolInvocation>>();
  return (input) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return Promise.reject(new Error(`${agentTool.toolName} input must be a JSON object.`));
    }
    const existing = cache.get(input);
    if (existing !== undefined) {
      return existing;
    }
    const resolved = agentTool.resolve(input as ToolFactValue);
    cache.set(input, resolved);
    return resolved;
  };
}

function childBoundary(
  parent: AgentLoopToolBoundary,
  invocation: AgentLoopAgentToolInvocation,
): AgentLoopToolBoundary {
  validateInvocationBoundary(parent, invocation);
  return {
    gateway: parent.gateway,
    context: {
      ...parent.context,
      callerAgentId: invocation.callerAgentId,
    },
    permission: {
      ...parent.permission,
      callerAgentId: invocation.callerAgentId,
      allowedTools: uniqueStrings(invocation.allowedTools),
    },
  };
}

function validateInvocationBoundary(
  parent: AgentLoopToolBoundary,
  invocation: AgentLoopAgentToolInvocation,
): AgentLoopAgentToolInvocation {
  const parentAllowed = new Set(parent.permission.allowedTools);
  const unavailable = uniqueStrings(invocation.allowedTools)
    .filter((name) => !parentAllowed.has(name) || !parent.gateway.has(name));
  if (unavailable.length > 0) {
    throw new Error(`Sub-agent requested tools outside the parent boundary: ${unavailable.join(", ")}`);
  }
  return invocation;
}

function freezeBoundary(boundary: AgentLoopToolBoundary): FrozenToolBoundary {
  return {
    gateway: boundary.gateway,
    context: {
      callerAgentId: boundary.context.callerAgentId,
      traceId: boundary.context.traceId,
      goalId: boundary.context.goalId,
      approvedConfirmationIds: boundary.context.approvedConfirmationIds === undefined
        ? undefined
        : [...boundary.context.approvedConfirmationIds],
      confirmationPolicy: boundary.context.confirmationPolicy,
    },
    permission: {
      ...boundary.permission,
      allowedTools: [...boundary.permission.allowedTools],
      approvedConfirmationIds: boundary.permission.approvedConfirmationIds === undefined
        ? undefined
        : [...boundary.permission.approvedConfirmationIds],
    },
  };
}

function executionContext(
  execution: OpenAIAgentsExecutionState,
  boundary: FrozenToolBoundary,
  callId: string,
): ToolExecutionContext {
  return {
    ...boundary.context,
    toolCallId: callId,
    abortSignal: execution.abortSignal,
  };
}

function frozenToolDefinitions(input: AgentLoopInput): readonly ToolDefinition[] {
  const allowed = new Set(input.tools.permission.allowedTools);
  return input.tools.gateway.list()
    .filter((definition) => allowed.has(definition.name))
    .map((definition) => globalThis.structuredClone(definition));
}

function sdkToolInputSchema(definition: ToolDefinition): SdkNonStrictObjectSchema {
  return {
    type: "object",
    properties: globalThis.structuredClone(definition.inputSchema.properties),
    required: definition.inputSchema.required === undefined ? [] : [...definition.inputSchema.required],
    additionalProperties: true,
  };
}

function strictAgentToolInputSchema(agentTool: AgentLoopAgentTool): SdkStrictObjectSchema {
  const schema = agentTool.inputSchema;
  const propertyNames = Object.keys(schema.properties);
  const required = new Set(schema.required ?? []);
  if (schema.additionalProperties !== false || propertyNames.some((name) => !required.has(name))) {
    throw new Error(`${agentTool.toolName} must provide a strict object schema with every property required.`);
  }
  return {
    type: "object",
    properties: globalThis.structuredClone(schema.properties),
    required: propertyNames,
    additionalProperties: false,
  };
}

function assertUniqueToolNames(
  definitions: readonly ToolDefinition[],
  agentTools: readonly AgentLoopAgentTool[],
): void {
  const seen = new Set<string>();
  for (const name of [
    ...definitions.map((definition) => definition.name),
    ...agentTools.map((agentTool) => agentTool.toolName),
  ]) {
    if (seen.has(name)) {
      throw new Error(`OpenAI Agents loop tool name is duplicated: ${name}`);
    }
    seen.add(name);
  }
}

function toolCallRequest(callId: string, toolName: string, input: unknown): ToolCallRequest {
  return { callId, toolName, input: input as ToolFactValue };
}

function parseToolInput(value: string | undefined): ToolFactValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(value) as ToolFactValue;
  } catch {
    return undefined;
  }
}

function requiredCallId(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error("OpenAI Agents SDK did not provide a function tool call id.");
  }
  return value;
}

function requiredToolFact(value: unknown): ToolFactValue {
  const fact = normalizeToolFactValue(value);
  if (fact === undefined) {
    throw new Error("OpenAI Agents SDK produced an undefined agent-tool input.");
  }
  return fact;
}

function requireSdkRunContext(
  value: RunContext<unknown> | undefined,
): RunContext<OpenAIAgentsSdkExecutionContext> {
  if (!(value instanceof RunContext)) {
    throw new Error("OpenAI Agents SDK did not provide a RunContext for tool execution.");
  }
  return value as RunContext<OpenAIAgentsSdkExecutionContext>;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export function openAIAgentsAgentToolCacheIdentity(agentTool: AgentLoopAgentTool): Readonly<Record<string, unknown>> {
  return {
    name: agentTool.toolName,
    description: agentTool.toolDescription,
    inputSchema: strictAgentToolInputSchema(agentTool),
  };
}
