export type ToolInputSchema = {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
};

export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
};

export type ToolCallRequest = {
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
};

export type ToolCallResult = {
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly status: "completed" | "failed";
  readonly error?: string;
  readonly durationMs: number;
};

export type ToolExecutionContext = {
  readonly callerAgentId: string;
  readonly traceId: string;
  readonly goalId: string;
};

export type ToolPermissionCheck = {
  readonly callerAgentId: string;
  readonly allowedTools?: readonly string[];
};

export interface ToolExecutor {
  readonly definition: ToolDefinition;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

export interface ToolExecutionBroker {
  list(): ToolDefinition[];
  has(name: string): boolean;
  execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission?: ToolPermissionCheck
  ): Promise<ToolCallResult>;
  resetCallCount(): void;
  getCallCount(): number;
}
