import type { ToolDefinition } from "./contracts.js";

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

export function validateModelVisibleToolContract(
  definition: ToolDefinition
): ModelVisibleToolContractValidation {
  const missing: string[] = [];
  if (definition.description.trim().length === 0) {
    missing.push("description");
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
