import type { ConfirmationRequest } from "../basic-agent/confirmation-contracts.js";

export type ToolInputSchema = {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
};

export type ToolUsageExample = {
  readonly title?: string;
  readonly input: Readonly<Record<string, unknown>>;
};

export type ToolModelRuntimeHint = {
  readonly label: string;
  readonly value: string;
};

export type ToolModelContract = {
  readonly purpose?: string;
  readonly whenToUse?: readonly string[];
  readonly whenNotToUse?: readonly string[];
  readonly inputNotes?: readonly string[];
  readonly usageNotes?: readonly string[];
  readonly outputNotes?: readonly string[];
  readonly examples?: readonly ToolUsageExample[];
  readonly runtimeHints?: readonly ToolModelRuntimeHint[];
};

export type ToolCategory = "research" | "workspace" | "filesystem" | "terminal" | "web" | "mcp" | "other";

export type ToolRiskLevel = "low" | "medium" | "high";

export type ToolOperationType =
  | "read-only"
  | "read-write"
  | "execute"
  | "external-submit";

export type ToolFileDisplayOperation =
  | "create"
  | "write"
  | "append"
  | "edit"
  | "delete";

export type ToolVisibleResultPolicy = {
  readonly userVisible: "summary-only" | "safe-preview" | "hidden";
  readonly maxPreviewChars: number;
  readonly omitRawOutput: boolean;
};

export type ToolErrorDomain =
  | "tool_error"
  | "runtime_error"
  | "model_error"
  | "ui_submit_error"
  | "process_error";

export type ToolErrorFactValue =
  | string
  | number
  | boolean
  | null
  | readonly ToolErrorFactValue[]
  | { readonly [key: string]: ToolErrorFactValue };

export type ToolErrorFacts = Readonly<Record<string, ToolErrorFactValue>>;

export type ToolRuntimeHint =
  | {
      readonly kind: "command_shell";
      readonly shellId: string;
      readonly label: string;
      readonly executable: string;
      readonly syntax: "cmd" | "powershell" | "posix";
      readonly platform: NodeJS.Platform;
      readonly invocation: readonly string[];
      readonly commandLineParameter: string;
      readonly notes: readonly string[];
    };

export type ToolDefinitionMetadata = {
  readonly category: ToolCategory;
  readonly riskLevel: ToolRiskLevel;
  readonly operationType: ToolOperationType;
  readonly requiresConfirmation: boolean;
  readonly visibleResultPolicy: ToolVisibleResultPolicy;
  readonly runtimeHints?: readonly ToolRuntimeHint[];
  /**
   * 文件系统操作工具显式声明的文件操作子类型（create/write/append/edit/delete）。
   *
   * 这是工具自身声明的显式能力契约，用于工作区能力判定（例如是否具备删除能力），
   * 取代按工具名正则猜测。只有真正执行文件操作的 builtin 工具才声明该字段；
   * 非文件工具（搜索、命令、HTTP、MCP 等）不声明，判定时按 undefined 处理。
   *
   * 注意：`operationType` 是粗粒度读写执行分类，无法区分“删除”这类子能力；
   * 删除工具的 `operationType` 仍是 "read-write"（删除属于写操作），删除子能力由本字段表达。
   */
  readonly fileOperation?: ToolFileDisplayOperation;
};

export type ToolSafeProjection = {
  readonly agentContent?: unknown;
  readonly uiSummary?: string;
  readonly diagnosticRef?: string;
  readonly display?: ToolDisplayProjection;
  readonly envelope?: ToolResultEnvelope;
  readonly truncated?: boolean;
  readonly redacted?: boolean;
};

export type ToolResultEnvelope = {
  readonly agentSummary: string;
  readonly evidenceRefs: readonly string[];
  readonly uiDisplay?: ToolDisplayProjection;
  readonly tokenEstimate: number;
  readonly truncated: boolean;
  readonly redacted: boolean;
  readonly diagnosticRef?: string;
  readonly rawRetention: "none" | "diagnostic_ref_only";
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
};

export type ToolDisplayProjection =
  | {
      readonly kind: "search_results";
      readonly query?: string;
      readonly status?: string;
      readonly message?: string;
      readonly results: readonly {
        readonly title: string;
        readonly url?: string;
        readonly refId?: string;
        readonly source?: string;
        readonly snippet?: string;
      }[];
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "read_result";
      readonly ref?: string;
      readonly source?: string;
      readonly status?: string;
      readonly title?: string;
      readonly url?: string;
      readonly uri?: string;
      readonly sourceSearchRef?: string;
      readonly contentPreview?: string;
      readonly summary?: string;
      readonly preview?: string;
      readonly error?: string;
      readonly errorFacts?: ToolErrorFacts;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "browser_snapshot";
      readonly title?: string;
      readonly url?: string;
      readonly text?: string;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "http_response";
      readonly method?: string;
      readonly url?: string;
      readonly statusCode?: number;
      readonly statusText?: string;
      readonly durationMs?: number;
      readonly bodyPreview?: string;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "file_change_summary";
      readonly path?: string;
      readonly operation?: ToolFileDisplayOperation;
      readonly bytes?: number;
      readonly append?: boolean;
      readonly replacements?: number;
      readonly previousLength?: number;
      readonly nextLength?: number;
      readonly preview?: string;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "file_diff_preview";
      readonly path?: string;
      readonly operation?: ToolFileDisplayOperation;
      readonly replacements?: number;
      readonly previousLength?: number;
      readonly nextLength?: number;
      readonly preview?: string;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "command_summary";
      readonly command?: string;
      readonly args?: readonly string[];
      readonly commandLine?: string;
      readonly cwd?: string;
      readonly shell?: string;
      readonly exitCode?: number;
      readonly timedOut?: boolean;
      readonly background?: boolean;
      readonly pid?: number;
      readonly logRef?: string;
      readonly logPath?: string;
      readonly stopCommand?: string;
      readonly durationMs?: number;
      readonly waitForPort?: number;
      readonly portReady?: boolean;
      readonly stdoutTruncated?: boolean;
      readonly stderrTruncated?: boolean;
      readonly stdoutChars?: number;
      readonly stderrChars?: number;
      readonly stdoutOmittedChars?: number;
      readonly stderrOmittedChars?: number;
      readonly outputSummary?: string;
      readonly errorSummary?: string;
    }
  | {
      readonly kind: "generic_tool_summary";
      readonly action?: string;
      readonly summary?: string;
      readonly items?: readonly string[];
    };

export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly modelContract?: ToolModelContract;
  readonly metadata?: ToolDefinitionMetadata;
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
  readonly status: "completed" | "failed" | "approval_required" | "cancelled";
  readonly error?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
  readonly durationMs: number;
  readonly projection?: ToolSafeProjection;
  readonly confirmationRequest?: ConfirmationRequest;
};

export type ToolSecurityDecision =
  | {
      readonly decision: "allow";
      readonly reason: string;
    }
  | {
      readonly decision: "approval_required";
      readonly reason: string;
      readonly title: string;
      readonly actionSummary: string;
      readonly affectedResources: readonly string[];
      readonly riskLevel: ToolRiskLevel;
      readonly sourceRefs: readonly string[];
    }
  | {
      readonly decision: "blocked";
      readonly reason: string;
      readonly code: string;
      readonly affectedResources: readonly string[];
      readonly sourceRefs: readonly string[];
    };

export type ToolSecurityEvaluationContext = {
  readonly platform: NodeJS.Platform;
  readonly approvedConfirmationIds?: readonly string[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly workspaceRoot?: string;
};

export interface ToolSecurityPolicy {
  evaluateToolCall(request: ToolCallRequest, definition: ToolDefinition, context: ToolSecurityEvaluationContext): ToolSecurityDecision;
}

export type ToolExecutionContext = {
  readonly callerAgentId: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly abortSignal?: AbortSignal;
};

export type ToolPermissionCheck = {
  readonly callerAgentId: string;
  readonly allowedTools: readonly string[];
  readonly approvedConfirmationIds?: readonly string[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
};

export type ToolConfirmationPolicy = "prompt" | "full_access";

export type SandboxOperation =
  | "read"
  | "list"
  | "search"
  | "write"
  | "edit"
  | "delete"
  | "execute";

export type SandboxPolicyRequest = {
  readonly operation: SandboxOperation;
  readonly workspaceRoot: string;
  readonly relativePath?: string;
  readonly bytes?: number;
  readonly command?: string;
  readonly commandLine?: string;
  readonly args?: readonly string[];
};

export type SandboxPolicyDecision =
  | {
      readonly allowed: true;
    }
  | {
      readonly allowed: false;
      readonly code: string;
      readonly reason: string;
    };

export interface SandboxPolicy {
  check(request: SandboxPolicyRequest): SandboxPolicyDecision;
}

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
    permission: ToolPermissionCheck
  ): Promise<ToolCallResult>;
  resetCallCount(): void;
  getCallCount(): number;
}
