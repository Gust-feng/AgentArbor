import type { ToolDefinition } from "./contracts.js";

export function modelVisibleToolDescription(definition: ToolDefinition): string {
  const sections = [definition.description.trim()].filter((section) => section.length > 0);
  const contract = definition.modelContract;
  if (contract === undefined) {
    return sections.join("\n\n");
  }
  if (contract.runtimeHints !== undefined && contract.runtimeHints.length > 0) {
    sections.push(`Runtime hints:\n${contract.runtimeHints.map((hint) => `- ${hint.label}: ${hint.value}`).join("\n")}`);
  }
  if (contract.usageNotes !== undefined && contract.usageNotes.length > 0) {
    sections.push(`Usage notes:\n${contract.usageNotes.map((note) => `- ${note}`).join("\n")}`);
  }
  if (contract.outputNotes !== undefined && contract.outputNotes.length > 0) {
    sections.push(`Output notes:\n${contract.outputNotes.map((note) => `- ${note}`).join("\n")}`);
  }
  if (contract.examples !== undefined && contract.examples.length > 0) {
    sections.push(`Examples:\n${contract.examples.map((example) => {
      const title = example.title === undefined ? "input" : example.title;
      return `- ${title}: ${JSON.stringify(example.input)}`;
    }).join("\n")}`);
  }
  return sections.join("\n\n");
}
