import type { ConfirmationRequest } from "../confirmation/contracts.js";
import type { ModelInputAttachment } from "../intelligence/model-input-attachments.js";
import type { ToolFactValue } from "./fact-value.js";

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
 * 模型可见工具的可选描述增强。它可以补充适用边界、参数约束、结果事实和运行环境，
 * 但不是工具进入模型可见集合的准入证明。
 *
 * 可见性由冻结权限、真实 executor/runtime 可用性、provider 协议能力和客观资源决定。
 * 这里的推荐用法、运行提示和示例不得成为隐藏路由，也不得通过关键词规则替模型选工具。
 */
export type ToolModelContract = {
  /** 可选补充目标说明；客观 `ToolDefinition.description` 始终是 provider 描述的主体。 */
  readonly purpose?: string;
  /** 可选适用性说明；只作信息补充，工具选择仍属于模型判断。 */
  readonly whenToUse?: readonly string[];
  /** 可选非能力/不适用边界。 */
  readonly whenNotToUse?: readonly string[];
  /** 可选参数补充；正式输入边界仍由 `inputSchema` 定义。 */
  readonly inputNotes?: readonly string[];
  /** 可选跨参数约束、平台差异或副作用说明。 */
  readonly usageNotes?: readonly string[];
  /** 可选输出说明；真实结果/截断/continuation 边界由 `ToolCallResult` 与 executor 行为承担。 */
  readonly outputNotes?: readonly string[];
  /** 可选参数示例。 */
  readonly examples?: readonly ToolUsageExample[];
  /** 可选冻结运行环境提示（如 current shell、平台）。 */
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
 * 对模型可见的工具，`validateModelVisibleToolContract` 只把 `category` / `riskLevel` /
 * `operationType` / `requiresConfirmation` 以及可选的 `fileOperation` 作为执行/副作用事实校验。
 * 预览长度、折叠和用户可见文案属于 Panel/read-model，不进入工具执行契约。
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

export type ToolContinuation = {
  readonly ref?: string;
  readonly nextInput?: ToolFactValue;
  readonly note?: string;
};

export type ToolResultError = {
  readonly message: string;
  readonly domain?: ToolErrorDomain;
  readonly facts?: ToolErrorFacts;
  readonly retryable?: boolean;
};

export type ToolResult = {
  readonly body:
    | { readonly format: "none" }
    | { readonly format: "text"; readonly text: string }
    | { readonly format: "json"; readonly value: ToolFactValue };
  readonly error?: ToolResultError;
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
  readonly input: ToolFactValue | undefined;
};

export type ToolCallResult = {
  readonly callId: string;
  readonly toolName: string;
  readonly input: ToolFactValue | undefined;
  readonly output: ToolFactValue | undefined;
  readonly status: "completed" | "failed" | "approval_required" | "cancelled";
  readonly error?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
  readonly durationMs: number;
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
      readonly consequence?: string;
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
  readonly toolCallId?: string;
  readonly approvedConfirmationIds?: readonly string[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
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
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown | ToolExecutorResult>;
}

export type ToolExecutorResult = {
  readonly kind: "tool_call_result";
  readonly result: ToolCallResult;
};

export interface ToolExecutionBroker {
  list(): ToolDefinition[];
  has(name: string): boolean;
  execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck
  ): Promise<ToolCallResult>;
  register?(executor: ToolExecutor): void;
}

/**
 * A side-effect-free decision about whether one exact tool call may enter its executor.
 * `ready.request` is the detached, JSON-safe fact that a later execution will use.
 */
export type ToolExecutionPreflight =
  | {
      readonly status: "ready";
      readonly request: ToolCallRequest;
    }
  | {
      readonly status: "approval_required";
      readonly result: ToolCallResult & { readonly status: "approval_required" };
    }
  | {
      readonly status: "blocked";
      readonly result: ToolCallResult & { readonly status: "failed" | "cancelled" };
    };

/**
 * Production tool gateways expose the same authorization boundary independently from
 * execution so an outer runtime can pause before invoking a side-effecting executor.
 */
export interface ToolExecutionGateway extends ToolExecutionBroker {
  preflight(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck
  ): ToolExecutionPreflight;
}
