import type { ConfirmationRequest } from "../basic-agent/confirmation-contracts.js";
import type { ModelInputAttachment } from "../intelligence/model-input-attachments.js";

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

/**
 * 模型可见工具的「功能性契约」：用于让模型依据契约本身（而非记忆外部约定）区分相近工具、
 * 判断何时该用/不该用、正确组装参数与理解输出。
 *
 * 这些字段是工具在模型可见层具备「区分度」的来源（FR-TOOL-004 的功能性基础）。
 * 对模型可见的工具，`validateModelVisibleToolContract` 会把其中的关键字段
 * （用途/参数说明/输出说明/runtimeHints/examples）作为「进模型可见集合」的完备门槛；
 * 缺这些字段的工具不得进入模型可见集合（FR-TOOL-002）。
 */
export type ToolModelContract = {
  /** 工具用途的一句话说明；缺省时回退到 `ToolDefinition.description`。 */
  readonly purpose?: string;
  /** 何时使用本工具，帮助模型在相近工具之间正向选择。 */
  readonly whenToUse?: readonly string[];
  /** 何时不应使用本工具，帮助模型在相近工具之间反向排除（区分度的关键）。 */
  readonly whenNotToUse?: readonly string[];
  /** 参数说明：每个关键参数的语义、单位、约束。 */
  readonly inputNotes?: readonly string[];
  /** 使用注意：跨参数的通用约束、平台差异、副作用边界。 */
  readonly usageNotes?: readonly string[];
  /** 输出说明：返回结构、字段含义、截断/省略行为。 */
  readonly outputNotes?: readonly string[];
  /** 可被模型直接复用的最小化参数示例。 */
  readonly examples?: readonly ToolUsageExample[];
  /** 运行时提示键值（如 current shell、平台），让模型无需记忆外部约定即可正确组装参数。 */
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

/**
 * 工具的「能力契约元数据」（FR-TOOL-002）。
 *
 * 这是「工具是否需要确认 / 是否只读 / 可否并行 / 是否具备删除子能力」等能力判定的
 * **唯一依据**。能力判定必须基于这些显式契约字段，而非工具名正则、关键字或硬编码白名单。
 *
 * 对模型可见的工具，`validateModelVisibleToolContract` 把 `category` / `riskLevel` /
 * `operationType` / `requiresConfirmation` / `visibleResultPolicy` 作为「进模型可见集合」的
 * 完备门槛：缺任一字段的工具不得进入模型可见集合。
 *
 * 确认策略保守默认：当 `requiresConfirmation` 缺失（例如经松散运行时数据绕过完备门槛的
 * 兼容/MCP 路径）时，`resolveEffectiveConfirmationRequirement` 对高影响动作
 * （execute / external-submit / delete / high risk）默认按需确认，确保不会因契约字段缺失
 * 而静默执行高影响动作。
 */
export type ToolDefinitionMetadata = {
  /** 工具类别，用于归类与可见性 scope 派生。 */
  readonly category: ToolCategory;
  /** 风险等级，能力判定（如默认确认策略）的依据之一。 */
  readonly riskLevel: ToolRiskLevel;
  /** 粗粒度读写执行分类；并行许可以 `operationType === "read-only"` 全员只读为前提。 */
  readonly operationType: ToolOperationType;
  /** 显式确认策略：是否需要逐条确认。能力判定唯一依据，缺失时走保守默认。 */
  readonly requiresConfirmation: boolean;
  /** 用户可见结果策略：摘要/预览/隐藏与截断上限。 */
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
  /**
   * Ephemeral model-input attachments produced by a tool for the next model
   * round. These payloads must not be projected into events, panel read-models,
   * or runtime persistence; those surfaces should keep only metadata and refs.
   */
  readonly modelAttachments?: readonly ModelInputAttachment[];
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
      readonly resultsReturned?: number;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "directory_listing";
      readonly path?: string;
      readonly depth?: number;
      readonly entriesReturned?: number;
      readonly totalEntries?: number;
      readonly unreadableDirectories?: number;
      readonly unreadableSamples?: readonly {
        readonly path?: string;
        readonly errorCode?: string;
      }[];
      readonly entries: readonly {
        readonly path: string;
        readonly name?: string;
        readonly kind?: string;
        readonly bytes?: number;
        readonly depth?: number;
      }[];
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "file_search_results";
      readonly query?: string;
      readonly path?: string;
      readonly engine?: string;
      readonly searchedFiles?: number;
      readonly skippedFactsAvailable?: boolean;
      readonly skippedFiles?: number;
      readonly skippedBinaryFiles?: number;
      readonly skippedTooLargeFiles?: number;
      readonly skippedUnreadableFiles?: number;
      readonly skippedDirectories?: number;
      readonly skippedOtherEntries?: number;
      readonly skippedSamples?: readonly {
        readonly path?: string;
        readonly reason?: string;
        readonly bytes?: number;
        readonly errorCode?: string;
      }[];
      readonly matches: readonly {
        readonly path: string;
        readonly line?: number;
        readonly preview?: string;
      }[];
      readonly matchesReturned?: number;
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
