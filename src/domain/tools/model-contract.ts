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
    sections.push(`Purpose: ${purpose}`);
  }
  appendList(sections, "When to use", contract.whenToUse);
  appendList(sections, "When not to use", contract.whenNotToUse);
  appendList(sections, "Inputs", contract.inputNotes);
  if (contract.runtimeHints !== undefined && contract.runtimeHints.length > 0) {
    sections.push(`Runtime hints:\n${contract.runtimeHints.map((hint) => `- ${hint.label}: ${hint.value}`).join("\n")}`);
  }
  appendList(sections, "Usage", contract.usageNotes);
  appendList(sections, "Output", contract.outputNotes);
  if (contract.examples !== undefined && contract.examples.length > 0) {
    sections.push(`Examples:\n${contract.examples.map((example) => {
      const title = example.title === undefined ? "input" : example.title;
      return `- ${title}: ${JSON.stringify(example.input)}`;
    }).join("\n")}`);
  }
  return sections.join("\n\n");
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

function appendList(sections: string[], title: string, items: readonly string[] | undefined): void {
  const lines = nonEmptyItems(items);
  if (lines.length > 0) {
    sections.push(`${title}:\n${lines.map((item) => `- ${item}`).join("\n")}`);
  }
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

function hasRuntimeHints(
  value: readonly { readonly label: string; readonly value: string }[] | undefined
): boolean {
  return (value ?? []).some((hint) => hasText(hint.label) && hasText(hint.value));
}
