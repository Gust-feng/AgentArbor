import { AsyncLocalStorage } from "node:async_hooks";
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
  toolResultAcceptanceFailure?: unknown;
  readonly preflightByFactId: Map<string, OpenAIAgentsPreflightFact>;
  readonly interruptionFactIds: WeakMap<object, string>;
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
  readonly factScope?: () => string | undefined;
}): FunctionTool<OpenAIAgentsSdkExecutionContext, SdkNonStrictObjectSchema> {
  const parameters = sdkToolInputSchema(input.definition);
  return tool<SdkNonStrictObjectSchema, OpenAIAgentsSdkExecutionContext>({
    name: input.definition.name,
    description: modelVisibleToolDescription(input.definition),
    parameters,
    strict: false,
    // ToolCenter already normalizes expected failures. A durable acceptance failure
    // must escape the SDK instead of becoming a model-visible fallback string.
    errorFunction: null,
    isEnabled: input.isEnabled === undefined
      ? true
      : ({ runContext }) => input.isEnabled!(requireSdkRunContext(runContext)),
    needsApproval: async (runContext, toolInput, callId) => {
      const providerCallId = requiredCallId(callId);
      const factId = scopedToolFactId(input.factScope?.(), providerCallId);
      const existing = input.execution.preflightByFactId.get(factId);
      if (existing !== undefined) {
        return existing.needsApproval;
      }
      const boundary = freezeBoundary(await input.boundary(requireSdkRunContext(runContext)));
      const request = toolCallRequest(providerCallId, factId, input.definition.name, toolInput);
      const preflight = boundary.gateway.preflight(
        request,
        executionContext(input.execution, boundary, factId),
        boundary.permission,
      );
      if (preflight.status === "ready") {
        input.execution.preflightByFactId.set(factId, {
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
      input.execution.preflightByFactId.set(factId, fact);
      await recordOpenAIAgentsToolResult(input.execution, preflight.result);
      return fact.needsApproval;
    },
    execute: async (toolInput, runContext, details) => {
      const callId = requiredCallId(details?.toolCall?.callId);
      const factId = scopedToolFactId(input.factScope?.(), callId);
      const cached = input.execution.preflightByFactId.get(factId);
      if (cached?.result !== undefined && cached.result.status !== "approval_required") {
        return input.execution.modelInput.toolResult(cached.result);
      }
      const boundary = cached?.boundary ?? freezeBoundary(await input.boundary(requireSdkRunContext(runContext)));
      const request = cached?.request ?? toolCallRequest(callId, factId, input.definition.name, toolInput);
      const approvedConfirmationId = cached?.result?.confirmationRequest?.confirmationId;
      const approvedConfirmationIds = cached?.needsApproval === true
        ? uniqueStrings([
            ...(boundary.permission.approvedConfirmationIds ?? []),
            ...(approvedConfirmationId === undefined ? [] : [approvedConfirmationId]),
          ])
        : boundary.permission.approvedConfirmationIds;
      const result = await boundary.gateway.execute(
        request,
        executionContext(input.execution, boundary, factId),
        { ...boundary.permission, approvedConfirmationIds },
      );
      await recordOpenAIAgentsToolResult(input.execution, result);
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
  const childFactScope = new AsyncLocalStorage<string>();
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
    factScope: () => childFactScope.getStore(),
  }));
  const child = new Agent<OpenAIAgentsSdkExecutionContext, AgentOutputType>({
    name: `AgentArborSubAgent:${input.agentTool.toolName}`,
    instructions: async (runContext) => (await resolveInvocation(runContext.toolInput)).instructions,
    model: input.model,
    modelSettings: input.modelSettings,
    tools: childTools,
  });
  const started = new Map<string, { readonly input: ToolFactValue; readonly at: number }>();
  const settled = new Set<string>();
  const interrupted = new Set<string>();
  const runOptions = {
    maxTurns: null,
    get signal(): AbortSignal {
      return input.execution.abortSignal;
    },
  };
  const agentTool = child.asTool({
    toolName: input.agentTool.toolName,
    toolDescription: input.agentTool.toolDescription,
    parameters: strictAgentToolInputSchema(input.agentTool),
    inputBuilder: async ({ params }) => (await resolveInvocation(params)).input,
    needsApproval: async (_runContext, params, callId) => {
      const providerCallId = requiredCallId(callId);
      const factId = scopedToolFactId(childFactScope.getStore(), providerCallId);
      if (!started.has(factId)) {
        started.set(factId, { input: requiredToolFact(params), at: Date.now() });
      }
      return false;
    },
    customOutputExtractor: async (result) => {
      const invocation = result.agentToolInvocation;
      const callId = requiredCallId(invocation.toolCallId);
      const factId = childFactScope.getStore() ?? callId;
      if (result.interruptions.length > 0) {
        interrupted.add(factId);
        for (const interruption of result.interruptions) {
          const rawChildCallId = interruptionToolCallId(interruption.rawItem);
          if (rawChildCallId !== undefined) {
            input.execution.interruptionFactIds.set(
              interruption,
              scopedToolFactId(factId, rawChildCallId),
            );
          }
        }
        return "";
      }
      const finalOutput = typeof result.finalOutput === "string" ? result.finalOutput : String(result.finalOutput ?? "");
      if (!settled.has(factId)) {
        const start = started.get(factId);
        const toolResult: ToolCallResult = {
          callId,
          ...optionalFactId(callId, factId),
          toolName: input.agentTool.toolName,
          input: start?.input ?? parseToolInput(invocation.toolArguments),
          output: finalOutput,
          status: "completed",
          durationMs: start === undefined ? 0 : Math.max(0, Date.now() - start.at),
        };
        await recordOpenAIAgentsToolResult(input.execution, toolResult);
        settled.add(factId);
        return agentToolModelOutput(input.execution, toolResult);
      }
      const recorded = input.execution.toolResults.find((item) =>
        (item.factId ?? item.callId) === factId && item.status === "completed");
      return recorded === undefined ? finalOutput : agentToolModelOutput(input.execution, recorded);
    },
    runOptions,
    resumeState: { contextStrategy: "merge" },
  });
  const sdkInvoke = agentTool.invoke.bind(agentTool);
  agentTool.invoke = async (runContext, rawInput, details) => {
    const callId = requiredCallId(details?.toolCall?.callId);
    const factId = scopedToolFactId(childFactScope.getStore(), callId);
    interrupted.delete(factId);
    return childFactScope.run(factId, async () => {
      try {
        const output = await sdkInvoke(runContext, rawInput, details);
        if (input.execution.toolResultAcceptanceFailure !== undefined) {
          throw input.execution.toolResultAcceptanceFailure;
        }
        if (!settled.has(factId) && !interrupted.has(factId)) {
          const modelOutput = await recordAgentToolFailure({
            execution: input.execution,
            agentTool: input.agentTool,
            callId,
            factId,
            input: started.get(factId)?.input ?? parseToolInput(details?.toolCall?.arguments),
            startedAt: started.get(factId)?.at,
            output,
            aborted: details?.signal?.aborted === true || input.execution.abortSignal.aborted,
          });
          settled.add(factId);
          return modelOutput;
        }
        return output;
      } catch (error) {
        if (input.execution.toolResultAcceptanceFailure !== undefined) {
          if (!settled.has(factId)) {
            await recordAgentToolFailure({
              execution: input.execution,
              agentTool: input.agentTool,
              callId,
              factId,
              input: started.get(factId)?.input ?? parseToolInput(details?.toolCall?.arguments),
              startedAt: started.get(factId)?.at,
              error: input.execution.toolResultAcceptanceFailure,
              aborted: details?.signal?.aborted === true || input.execution.abortSignal.aborted,
            }).catch(() => undefined);
            settled.add(factId);
          }
          throw input.execution.toolResultAcceptanceFailure;
        }
        if (!settled.has(factId)) {
          await recordAgentToolFailure({
            execution: input.execution,
            agentTool: input.agentTool,
            callId,
            factId,
            input: started.get(factId)?.input ?? parseToolInput(details?.toolCall?.arguments),
            startedAt: started.get(factId)?.at,
            error,
            aborted: details?.signal?.aborted === true || input.execution.abortSignal.aborted,
          });
          settled.add(factId);
        }
        throw error;
      }
    });
  };
  return agentTool;
}

async function recordAgentToolFailure(input: {
  readonly execution: OpenAIAgentsExecutionState;
  readonly agentTool: AgentLoopAgentTool;
  readonly callId: string;
  readonly factId: string;
  readonly input: ToolFactValue | undefined;
  readonly startedAt: number | undefined;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly aborted: boolean;
}): Promise<string> {
  const output = normalizeToolFactValue(input.output);
  const message = input.error === undefined
    ? typeof input.output === "string" && input.output.length > 0
      ? input.output
      : "The sub-agent invocation failed."
    : errorMessage(input.error);
  const result: ToolCallResult = {
    callId: input.callId,
    ...optionalFactId(input.callId, input.factId),
    toolName: input.agentTool.toolName,
    input: input.input,
    output,
    status: input.aborted ? "cancelled" : "failed",
    error: input.aborted ? cancellationMessage(input.execution.abortSignal.reason) : message,
    errorDomain: input.aborted ? "runtime_error" : "model_error",
    errorFacts: { code: input.aborted ? "sub_agent_cancelled" : "sub_agent_execution_failed" },
    durationMs: input.startedAt === undefined ? 0 : Math.max(0, Date.now() - input.startedAt),
  };
  await recordOpenAIAgentsToolResult(input.execution, result);
  return agentToolModelOutput(input.execution, result);
}

function agentToolModelOutput(
  execution: OpenAIAgentsExecutionState,
  result: ToolCallResult,
): string {
  const output = execution.modelInput.toolResult(result);
  if (typeof output !== "string") {
    throw new Error("OpenAI Agent Tool results cannot carry model attachments.");
  }
  return output;
}

export async function recordOpenAIAgentsToolResult(
  execution: OpenAIAgentsExecutionState,
  result: ToolCallResult,
): Promise<void> {
  execution.toolResults.push(result);
  try {
    await execution.input.onToolResult?.(structuredClone(result));
  } catch (error) {
    execution.toolResultAcceptanceFailure ??= error;
    throw error;
  }
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

function toolCallRequest(callId: string, factId: string, toolName: string, input: unknown): ToolCallRequest {
  return {
    callId,
    ...optionalFactId(callId, factId),
    toolName,
    input: input as ToolFactValue,
  };
}

function scopedToolFactId(scope: string | undefined, providerCallId: string): string {
  return scope === undefined
    ? providerCallId
    : `agent-tool:${scope.length}:${scope}/tool:${providerCallId}`;
}

function optionalFactId(callId: string, factId: string): { readonly factId?: string } {
  return callId === factId ? {} : { factId };
}

function interruptionToolCallId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const callId = (value as Readonly<Record<string, unknown>>).callId;
  return typeof callId === "string" && callId.length > 0 ? callId : undefined;
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

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function cancellationMessage(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : "The sub-agent invocation was cancelled.";
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
