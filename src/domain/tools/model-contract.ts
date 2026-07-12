import type {
  ToolCategory,
  ToolDefinition,
  ToolFileDisplayOperation,
  ToolInputSchema,
  ToolOperationType,
  ToolRiskLevel,
} from "./contracts.js";

export type ModelVisibleToolContractValidation = {
  readonly ok: boolean;
  readonly missing: readonly string[];
};

export const MODEL_VISIBLE_TOOL_DESCRIPTION_MAX_CHARS = 4_096;

const DESCRIPTION_SECTION_BUDGET = {
  objective: { ratio: 0.2, maxChars: 512 },
  outputs: { ratio: 0.38, maxChars: 1_536 },
  runtime: { ratio: 0.1, maxChars: 400 },
  limits: { ratio: 0.1, maxChars: 400 },
  notes: { ratio: 0.17, maxChars: 700 },
} as const;

export type ModelVisibleToolDescriptionOptions = {
  readonly maxChars?: number;
};

/**
 * 生成 provider function/tool 的描述正文。
 *
 * `description` 是客观能力说明，也是唯一必需正文。`modelContract` 只提供可选增强；增强项
 * 按固定字段顺序进入显式字符预算，不按关键词、内容位置或推测的任务意图挑选。客观 description
 * 有独立上限，不能吞掉结果/continuation、运行环境和副作用/限制事实。输入 schema
 * 作为独立 provider 字段发送，因此参数提示、推荐用法和示例在上述事实之后再使用剩余预算。
 */
export function modelVisibleToolDescription(
  definition: ToolDefinition,
  options: ModelVisibleToolDescriptionOptions = {}
): string {
  const maxChars = normalizedDescriptionBudget(options.maxChars);
  const sections: string[] = [];
  const contract = definition.modelContract;
  const purpose = firstNonEmpty(definition.description, contract?.purpose);
  if (purpose !== undefined) {
    sections.push(fitSectionBudget(
      purpose,
      sectionBudget(maxChars, DESCRIPTION_SECTION_BUDGET.objective)
    ));
  }
  if (contract !== undefined) {
    const seen = new Set(purpose === undefined ? [] : [normalizeComparableText(purpose)]);
    appendDescriptionSection(
      sections,
      seen,
      "Outputs",
      contract.outputNotes,
      sectionBudget(maxChars, DESCRIPTION_SECTION_BUDGET.outputs)
    );
    appendRuntimeHints(
      sections,
      seen,
      contract.runtimeHints,
      sectionBudget(maxChars, DESCRIPTION_SECTION_BUDGET.runtime)
    );
    appendDescriptionSection(
      sections,
      seen,
      "Avoid for",
      contract.whenNotToUse,
      sectionBudget(maxChars, DESCRIPTION_SECTION_BUDGET.limits)
    );
    appendDescriptionSection(
      sections,
      seen,
      "Notes",
      contract.usageNotes,
      sectionBudget(maxChars, DESCRIPTION_SECTION_BUDGET.notes)
    );
    appendDescriptionSection(sections, seen, "Inputs", contract.inputNotes);
    appendDescriptionSection(sections, seen, "Use for", contract.whenToUse);
    appendExamples(sections, seen, contract.examples);
  }
  return fitDescriptionBudget(sections.join("\n"), maxChars);
}

/**
 * 工具「进模型可见集合」的统一事实门槛（FR-TOOL-001 / FR-TOOL-002）。
 *
 * 模型可见工具只必须具备可执行 identity、客观 description、有效 input schema 以及
 * 执行/副作用元数据。`ToolRegistry.register` 只对真实 `ToolExecutor` 调用本校验；执行结果
 * 另由 ToolCenter 归一化为 `ToolCallResult`，截断时必须在输出顶层提供真实
 * `continuation / continuations`。这些运行时事实不能用一段 `outputNotes` 散文伪装成静态校验。
 *
 * `modelContract` 内的 whenToUse / usageNotes / inputNotes / outputNotes / runtimeHints / examples
 * 都是可选描述增强，缺失或无法序列化时不能隐藏一个本来可执行的工具。
 */
export function validateModelVisibleToolContract(
  definition: ToolDefinition
): ModelVisibleToolContractValidation {
  const missing: string[] = [];
  if (!hasText(definition.name)) {
    missing.push("name");
  }
  if (!hasText(definition.description)) {
    missing.push("description");
  }
  if (!isToolInputSchema(definition.inputSchema)) {
    missing.push("inputSchema");
  }
  const metadata = definition.metadata;
  if (metadata === undefined) {
    missing.push("metadata");
  } else {
    if (!isToolCategory(metadata.category)) {
      missing.push("metadata.category");
    }
    if (!isRiskLevel(metadata.riskLevel)) {
      missing.push("metadata.riskLevel");
    }
    if (!isOperationType(metadata.operationType)) {
      missing.push("metadata.operationType");
    }
    if (typeof metadata.requiresConfirmation !== "boolean") {
      missing.push("metadata.requiresConfirmation");
    }
    if (metadata.fileOperation !== undefined && !isFileOperation(metadata.fileOperation)) {
      missing.push("metadata.fileOperation");
    }
  }
  return {
    ok: missing.length === 0,
    missing,
  };
}

/**
 * 解析工具的有效确认要求，应用保守默认（FR-TOOL-002：「缺确认策略时默认按需确认」）。
 *
 * 显式契约字段 `requiresConfirmation` 是权威来源。当其缺失（例如经松散运行时数据
 * 绕过完备门槛的兼容/MCP 路径）时，对高影响动作（execute / external-submit / delete /
 * high risk）默认按需确认，确保不会因契约字段缺失而静默执行高影响动作。
 *
 * 参数为结构化类型，可同时接受 `ToolDefinitionMetadata` 与能力快照中的工具条目。
 */
export function resolveEffectiveConfirmationRequirement(
  metadata:
    | {
        readonly requiresConfirmation?: boolean;
        readonly operationType?: ToolOperationType;
        readonly fileOperation?: ToolFileDisplayOperation;
        readonly riskLevel?: ToolRiskLevel;
      }
    | undefined
): boolean {
  if (metadata?.requiresConfirmation !== undefined) {
    return metadata.requiresConfirmation;
  }
  if (metadata === undefined) {
    return true;
  }
  if (
    metadata.operationType === "execute" ||
    metadata.operationType === "external-submit"
  ) {
    return true;
  }
  if (metadata.fileOperation === "delete") {
    return true;
  }
  if (metadata.riskLevel === "high") {
    return true;
  }
  return false;
}

function isToolCategory(value: unknown): value is ToolCategory {
  return (
    value === "research" ||
    value === "workspace" ||
    value === "filesystem" ||
    value === "terminal" ||
    value === "web" ||
    value === "mcp" ||
    value === "other"
  );
}

function isRiskLevel(value: unknown): value is ToolRiskLevel {
  return value === "low" || value === "medium" || value === "high";
}

function isOperationType(value: unknown): value is ToolOperationType {
  return (
    value === "read-only" ||
    value === "read-write" ||
    value === "execute" ||
    value === "external-submit"
  );
}

function isFileOperation(value: unknown): value is ToolFileDisplayOperation {
  return (
    value === "create" ||
    value === "write" ||
    value === "append" ||
    value === "edit" ||
    value === "delete"
  );
}

function isToolInputSchema(value: unknown): value is ToolInputSchema {
  if (!isRecord(value) || value.type !== "object" || !isRecord(value.properties)) {
    return false;
  }
  const properties = value.properties;
  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) ||
      value.required.some(
        (item) => typeof item !== "string" || item.length === 0 || !(item in properties)
      ))
  ) {
    return false;
  }
  return (
    value.additionalProperties === undefined ||
    typeof value.additionalProperties === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (hasText(value)) {
      return value.trim();
    }
  }
  return undefined;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function appendDescriptionSection(
  sections: string[],
  seen: Set<string>,
  title: string,
  value: readonly string[] | undefined,
  maxChars?: number
): void {
  const items = uniqueTextItems(value, seen);
  if (items.length > 0) {
    const section = `${title}: ${items.join(" ")}`;
    sections.push(maxChars === undefined ? section : fitSectionBudget(section, maxChars));
  }
}

function appendRuntimeHints(
  sections: string[],
  seen: Set<string>,
  hints: readonly { readonly label: string; readonly value: string }[] | undefined,
  maxChars: number
): void {
  if (!Array.isArray(hints)) {
    return;
  }
  const items = uniqueTextItems(
    hints
      .filter((hint) => hasText(hint?.label) && hasText(hint?.value))
      .map((hint) => `${hint.label.trim()}=${hint.value.trim()}`),
    seen
  );
  if (items.length > 0) {
    sections.push(fitSectionBudget(`Runtime: ${items.join("; ")}`, maxChars));
  }
}

function appendExamples(
  sections: string[],
  seen: Set<string>,
  examples: readonly { readonly input: Readonly<Record<string, unknown>> }[] | undefined
): void {
  if (!Array.isArray(examples)) {
    return;
  }
  const serialized = examples
    .map((example) => serializeExample(example?.input))
    .filter((value): value is string => value !== undefined);
  const items = uniqueTextItems(serialized, seen);
  if (items.length > 0) {
    sections.push(`Examples: ${items.join(" ")}`);
  }
}

function serializeExample(value: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function uniqueTextItems(
  value: readonly string[] | undefined,
  seen: Set<string>
): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (!hasText(item)) {
      continue;
    }
    const text = item.trim();
    const comparable = normalizeComparableText(text);
    if (seen.has(comparable)) {
      continue;
    }
    seen.add(comparable);
    result.push(text);
  }
  return result;
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizedDescriptionBudget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return MODEL_VISIBLE_TOOL_DESCRIPTION_MAX_CHARS;
  }
  return Math.max(1, Math.floor(value));
}

function sectionBudget(
  total: number,
  policy: { readonly ratio: number; readonly maxChars: number }
): number {
  return Math.max(1, Math.min(policy.maxChars, Math.floor(total * policy.ratio)));
}

function fitSectionBudget(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const marker = " …[truncated]";
  if (marker.length >= maxChars) {
    return value.slice(0, maxChars);
  }
  const bodyLimit = maxChars - marker.length;
  const candidate = value.slice(0, bodyLimit);
  const completeBoundary = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf(".") + 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  const cutoff = completeBoundary >= Math.floor(bodyLimit / 2)
    ? completeBoundary
    : wordBoundary > 0
      ? wordBoundary
      : bodyLimit;
  return `${candidate.slice(0, cutoff).trimEnd()}${marker}`;
}

function fitDescriptionBudget(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const marker = "\n[Additional tool guidance omitted by description budget.]";
  if (marker.length >= maxChars) {
    return value.slice(0, maxChars);
  }
  const bodyLimit = maxChars - marker.length;
  const candidate = value.slice(0, bodyLimit);
  const completeBoundary = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf(".") + 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  const cutoff = completeBoundary >= Math.floor(bodyLimit / 2)
    ? completeBoundary
    : wordBoundary > 0
      ? wordBoundary
      : bodyLimit;
  return `${candidate.slice(0, cutoff).trimEnd()}${marker}`;
}
