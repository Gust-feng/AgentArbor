
export type SubAgentSourceKind = "builtin" | "project" | "user" | "plugin" | "custom";

export type SubAgentDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly sourceKind: SubAgentSourceKind;
  readonly sourceRootId: string;
  readonly sourcePrecedence: number;
  readonly enabled: boolean;
  readonly allowedTools?: readonly string[];
  readonly model?: string;
  readonly maxSteps?: number;
  readonly sourcePath?: string;
  readonly version?: string;
  readonly category?: string;
  readonly whenToUse?: readonly string[];
  readonly whenNotToUse?: readonly string[];
  readonly contentHash?: string;
  readonly bodyHash?: string;
};

export type SubAgentCallResult = {
  readonly status: "completed" | "failed" | "cancelled";
  readonly subAgentId: string;
  readonly subAgentName: string;
  readonly summary: string;
  readonly fullOutput?: string;
  readonly toolCalls?: number;
  readonly modelRounds?: number;
  readonly durationMs?: number;
  readonly error?: string;
  readonly errorDomain?: string;
  readonly runId?: string;
};

export type SubAgentBatchCallResult = {
  readonly results: readonly SubAgentCallResult[];
  readonly allCompleted: boolean;
  readonly successCount: number;
  readonly failedCount: number;
  readonly totalDurationMs?: number;
};

export type SubAgentRootDescriptor = {
  readonly rootPath: string;
  readonly sourceKind: SubAgentSourceKind;
  readonly sourceRootId: string;
  readonly precedence: number;
};

export type SubAgentRootInput = string | SubAgentRootDescriptor;

export type SubAgentDiscoveryOptions = {
  readonly roots: readonly SubAgentRootInput[];
};
