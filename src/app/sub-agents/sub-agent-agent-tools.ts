import type {
  AgentLoopAgentTool,
  AgentLoopAgentToolInvocation,
} from "../model-runtime/agent-loop.js";
import type { ToolFactValue } from "../../domain/tools/index.js";
import { loadSubAgentBody, type SubAgentDefinition } from "./sub-agent-loader.js";
import type { SubAgentRegistry } from "./sub-agent-registry.js";

export const CALL_SUB_AGENT_TOOL_NAME = "call_sub_agent";
export const SPAWN_SUB_AGENT_TOOL_NAME = "spawn_sub_agent";

const LEGACY_SUB_AGENT_TOOL_NAMES = new Set([
  CALL_SUB_AGENT_TOOL_NAME,
  "call_sub_agents",
  SPAWN_SUB_AGENT_TOOL_NAME,
  "read_sub_agent_output",
]);

export type CreateSubAgentAgentToolsInput = {
  readonly registry: SubAgentRegistry;
  readonly parentAllowedTools: readonly string[];
  readonly executableTools: readonly string[];
};

/**
 * Creates the two Sub-Agent contributions for one frozen Ordinary run. These are
 * model-loop contributions, not ToolCenter executors; nested mechanical actions still
 * execute through the parent's ToolExecutionGateway.
 */
export async function createSubAgentAgentTools(
  input: CreateSubAgentAgentToolsInput,
): Promise<readonly AgentLoopAgentTool[]> {
  const enabled = (await input.registry.list()).filter((definition) => definition.enabled);
  const parentTools = effectiveParentTools(input.parentAllowedTools, input.executableTools);
  const tools: AgentLoopAgentTool[] = [];
  if (enabled.length > 0) {
    tools.push(callSubAgentTool(input.registry, enabled, parentTools));
  }
  tools.push(spawnSubAgentTool(parentTools));
  return tools;
}

function callSubAgentTool(
  registry: SubAgentRegistry,
  enabled: readonly SubAgentDefinition[],
  parentTools: readonly string[],
): AgentLoopAgentTool {
  const names = enabled.map((definition) => definition.name);
  const catalogDescription = enabled
    .map((definition) => `${definition.name}: ${definition.description}`)
    .join("; ");
  return {
    toolName: CALL_SUB_AGENT_TOOL_NAME,
    toolDescription: `Call one registered specialist for a bounded task. Available specialists: ${catalogDescription}`,
    inputSchema: {
      type: "object",
      properties: {
        sub_agent_name: {
          type: "string",
          enum: names,
          description: "The registered specialist name.",
        },
        task: {
          type: "string",
          description: "The bounded task delegated to the specialist.",
        },
        context: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Optional supporting context. Use null when none is needed.",
        },
      },
      required: ["sub_agent_name", "task", "context"],
      additionalProperties: false,
    },
    resolve: async (value) => {
      const record = objectInput(value, CALL_SUB_AGENT_TOOL_NAME);
      const name = requiredString(record.sub_agent_name, "sub_agent_name");
      const task = requiredString(record.task, "task");
      const context = nullableString(record.context, "context");
      const definition = await registry.getByName(name);
      if (definition === undefined || !definition.enabled) {
        throw new Error(`Sub-agent is unavailable in this frozen run: ${name}`);
      }
      const body = await loadSubAgentBody(definition);
      return {
        agentName: definition.name,
        instructions: specialistInstructions(definition.name, definition.description, body),
        input: specialistInput(task, context),
        callerAgentId: `sub-agent:${definition.id}`,
        allowedTools: declaredToolNarrowing(parentTools, definition.allowedTools),
      };
    },
  };
}

function spawnSubAgentTool(parentTools: readonly string[]): AgentLoopAgentTool {
  const itemSchema: Record<string, unknown> = { type: "string" };
  if (parentTools.length > 0) {
    itemSchema.enum = [...parentTools];
  }
  return {
    toolName: SPAWN_SUB_AGENT_TOOL_NAME,
    toolDescription: "Create one temporary specialist for this call. It is not saved and cannot delegate to another agent.",
    inputSchema: {
      type: "object",
      properties: {
        role: { type: "string", description: "A concise specialist role name." },
        instructions: { type: "string", description: "The specialist's working instructions." },
        task: { type: "string", description: "The bounded task delegated to the specialist." },
        context: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Optional supporting context. Use null when none is needed.",
        },
        allowed_tools: {
          anyOf: [{ type: "array", items: itemSchema, uniqueItems: true }, { type: "null" }],
          description: "Use null to inherit parent tools, or an array to narrow them. An empty array grants no tools.",
        },
      },
      required: ["role", "instructions", "task", "context", "allowed_tools"],
      additionalProperties: false,
    },
    resolve: async (value) => {
      const record = objectInput(value, SPAWN_SUB_AGENT_TOOL_NAME);
      const role = requiredString(record.role, "role");
      const instructions = requiredString(record.instructions, "instructions");
      const task = requiredString(record.task, "task");
      const context = nullableString(record.context, "context");
      const allowedTools = dynamicToolNarrowing(parentTools, record.allowed_tools);
      return {
        agentName: role,
        instructions: specialistInstructions(role, role, instructions),
        input: specialistInput(task, context),
        callerAgentId: "sub-agent:dynamic",
        allowedTools,
      } satisfies AgentLoopAgentToolInvocation;
    },
  };
}

function effectiveParentTools(
  parentAllowedTools: readonly string[],
  executableTools: readonly string[],
): readonly string[] {
  const executable = new Set(uniqueToolNames(executableTools));
  return uniqueToolNames(parentAllowedTools)
    .filter((name) => executable.has(name) && !LEGACY_SUB_AGENT_TOOL_NAMES.has(name));
}

function declaredToolNarrowing(
  parentTools: readonly string[],
  declaredTools: readonly string[],
): readonly string[] {
  const declared = uniqueToolNames(declaredTools).filter((name) => !LEGACY_SUB_AGENT_TOOL_NAMES.has(name));
  if (declared.length === 0) {
    return parentTools;
  }
  const declaredSet = new Set(declared);
  return parentTools.filter((name) => declaredSet.has(name));
}

function dynamicToolNarrowing(
  parentTools: readonly string[],
  requested: ToolFactValue | undefined,
): readonly string[] {
  if (requested === null) {
    return parentTools;
  }
  if (!Array.isArray(requested)) {
    throw new Error("allowed_tools must be an array or null.");
  }
  const names = requested.map((value, index) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`allowed_tools[${index}] must be a non-empty string.`);
    }
    return value.trim();
  });
  const requestedNames = uniqueToolNames(names);
  const parentSet = new Set(parentTools);
  const unavailable = requestedNames.filter((name) => !parentSet.has(name));
  if (unavailable.length > 0) {
    throw new Error(`spawn_sub_agent requested unavailable tools: ${unavailable.join(", ")}`);
  }
  return requestedNames;
}

function specialistInstructions(name: string, description: string, body: string): string {
  return [
    body.trim(),
    "",
    `You are the ${name} specialist. ${description}`,
    "Complete only the delegated task. Use only the tools provided to you and return the complete result to the parent agent.",
  ].join("\n").trim();
}

function specialistInput(task: string, context: string | undefined): string {
  return context === undefined
    ? `Task:\n${task}`
    : `Task:\n${task}\n\nContext:\n${context}`;
}

function objectInput(value: ToolFactValue, toolName: string): Readonly<Record<string, ToolFactValue | undefined>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${toolName} input must be an object.`);
  }
  return value as Readonly<Record<string, ToolFactValue | undefined>>;
}

function requiredString(value: ToolFactValue | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function nullableString(value: ToolFactValue | undefined, field: string): string | undefined {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string or null.`);
  }
  return value.trim().length === 0 ? undefined : value.trim();
}

function uniqueToolNames(values: readonly string[]): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const name = value.trim();
    if (name.length === 0 || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}
