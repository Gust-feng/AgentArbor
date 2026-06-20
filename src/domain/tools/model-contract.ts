import type {
  ToolCategory,
  ToolDefinition,
  ToolFileDisplayOperation,
  ToolOperationType,
  ToolRiskLevel,
  ToolVisibleResultPolicy,
} from "./contracts.js";

export type ModelVisibleToolContractValidation = {
  readonly ok: boolean;
  readonly missing: readonly string[];
};

export function modelVisibleToolDescription(definition: ToolDefinition): string {
  const sections: string[] = [];
  const contract = definition.modelContract;
  if (contract === undefined) {
    return definition.description.trim();
  }
  const purpose = firstNonEmpty(definition.modelContract?.purpose, definition.description);
  if (purpose !== undefined) {
    sections.push(purpose);
  }
  appendCompactSentence(sections, "Use for", firstItems(contract.whenToUse, 2));
  appendCompactSentence(sections, "Avoid for", firstItems(contract.whenNotToUse, 1));
  appendCompactSentence(sections, "Inputs", firstItems(contract.inputNotes, 3));
  appendCompactSentence(sections, "Outputs", firstItems(contract.outputNotes, 3));
  appendCompactRuntimeHints(sections, contract.runtimeHints, 2);
  appendCompactSentence(sections, "Notes", importantUsageNotes(contract.usageNotes));
  appendCompactExample(sections, contract.examples);
  return sections.join("\n");
}

/**
 * 工具「进模型可见集合」的统一完备门槛（FR-TOOL-001 / FR-TOOL-002）。
 *
 * 这是能力判定的单一事实来源：模型可见的工具必须同时满足
 *   - 模型可见功能性契约（`modelContract` + `description`）：用途 / 参数说明 / 输出说明 /
 *     runtimeHints / examples，使模型可依据契约本身区分相近工具并正确组装参数；
 *   - 能力契约元数据（`metadata`）：category / riskLevel / operationType /
 *     requiresConfirmation / visibleResultPolicy，使「是否只读 / 是否需要确认 / 可否并行 /
 *     是否具备删除子能力」等能力判定只依赖显式契约字段，而非工具名或硬编码白名单。
 *
 * 缺任一必备字段的工具不得进入模型可见集合。确认策略缺失时，调用方应通过
 * {@link resolveEffectiveConfirmationRequirement} 取保守默认（按需确认），而非自行猜测。
 */
export function validateModelVisibleToolContract(
  definition: ToolDefinition
): ModelVisibleToolContractValidation {
  const missing: string[] = [];
  if (definition.description.trim().length === 0) {
    missing.push("description");
  }
  // 能力契约元数据完备性（FR-TOOL-002）：判定只依赖契约字段。
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
    if (!isVisibleResultPolicy(metadata.visibleResultPolicy)) {
      missing.push("metadata.visibleResultPolicy");
    }
  }
  const contract = definition.modelContract;
  if (contract === undefined) {
    missing.push("modelContract");
    return { ok: false, missing };
  }
  if (!hasTextList(contract.whenToUse) && !hasTextList(contract.usageNotes)) {
    missing.push("modelContract.whenToUse or usageNotes");
  }
  if (!hasTextList(contract.inputNotes) && !hasTextList(contract.usageNotes)) {
    missing.push("modelContract.inputNotes or usageNotes");
  }
  if (!hasTextList(contract.outputNotes)) {
    missing.push("modelContract.outputNotes");
  }
  if (!hasRuntimeHints(contract.runtimeHints)) {
    missing.push("modelContract.runtimeHints");
  }
  if (contract.examples === undefined || contract.examples.length === 0) {
    missing.push("modelContract.examples");
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

function isVisibleResultPolicy(value: unknown): value is ToolVisibleResultPolicy {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const policy = value as { userVisible?: unknown; maxPreviewChars?: unknown; omitRawOutput?: unknown };
  return (
    (policy.userVisible === "summary-only" ||
      policy.userVisible === "safe-preview" ||
      policy.userVisible === "hidden") &&
    typeof policy.maxPreviewChars === "number" &&
    typeof policy.omitRawOutput === "boolean"
  );
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (hasText(value)) {
      return value.trim();
    }
  }
  return undefined;
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function hasTextList(value: readonly string[] | undefined): boolean {
  return nonEmptyItems(value).length > 0;
}

function nonEmptyItems(value: readonly string[] | undefined): readonly string[] {
  return (value ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
}

function firstItems(value: readonly string[] | undefined, limit: number): readonly string[] {
  return nonEmptyItems(value).slice(0, limit);
}

function importantUsageNotes(value: readonly string[] | undefined): readonly string[] {
  const notes = nonEmptyItems(value);
  const selected = notes.filter((item) => IMPORTANT_USAGE_NOTE_PATTERN.test(item));
  return (selected.length > 0 ? selected : notes).slice(0, 2);
}

function appendCompactSentence(sections: string[], title: string, items: readonly string[]): void {
  if (items.length > 0) {
    sections.push(`${title}: ${items.join(" ")}`);
  }
}

function appendCompactRuntimeHints(
  sections: string[],
  hints: readonly { readonly label: string; readonly value: string }[] | undefined,
  limit: number
): void {
  const lines = (hints ?? [])
    .filter((hint) => hasText(hint.label) && hasText(hint.value))
    .slice(0, limit)
    .map((hint) => `${hint.label}=${hint.value}`);
  if (lines.length > 0) {
    sections.push(`Runtime: ${lines.join("; ")}`);
  }
}

function appendCompactExample(sections: string[], examples: readonly { readonly input: Readonly<Record<string, unknown>> }[] | undefined): void {
  const example = examples?.[0];
  if (example !== undefined) {
    sections.push(`Example: ${JSON.stringify(example.input)}`);
  }
}

function hasRuntimeHints(
  value: readonly { readonly label: string; readonly value: string }[] | undefined
): boolean {
  return (value ?? []).some((hint) => hasText(hint.label) && hasText(hint.value));
}

const IMPORTANT_USAGE_NOTE_PATTERN = /\b(background=true|dev servers?|non-2xx|status|read|search|truncated|maxLength|dryRun|commandLine|command and args|batch)\b/iu;
