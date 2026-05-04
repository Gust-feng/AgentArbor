import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutor,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";

export type ToolCenterOptions = {
  readonly maxCallsPerRun?: number;
};

const DEFAULT_MAX_CALLS_PER_RUN = 20;

export class ToolCenter {
  private readonly tools = new Map<string, ToolExecutor>();
  private callCount = 0;
  private readonly maxCallsPerRun: number;

  constructor(options: ToolCenterOptions = {}) {
    this.maxCallsPerRun = Math.max(0, Math.floor(options.maxCallsPerRun ?? DEFAULT_MAX_CALLS_PER_RUN));
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

    this.callCount += 1;
    try {
      const output = await executor.execute(request.input, context);
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output,
        status: "completed",
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
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
  error: string
): ToolCallResult {
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "failed",
    error,
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
    },
  };
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Tool execution failed.";
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]").slice(0, 500);
}
