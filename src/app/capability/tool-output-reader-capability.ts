import type { BasicAgentCapabilitySnapshot } from "../../domain/config/contracts.js";

export const TOOL_OUTPUT_READER_TOOL_NAME = "ReadOutput";

export function inheritToolOutputReader(input: {
  readonly businessAllowedTools: readonly string[];
  readonly parentAllowedTools: readonly string[];
  readonly readerExecutable: boolean;
}): readonly string[] {
  // `read_output` is a transport companion, not a business permission.
  // A child definition must not be able to smuggle it into the effective
  // boundary when the frozen parent run did not authorize an executable reader.
  const businessAllowedTools = uniqueToolNames(input.businessAllowedTools)
    .filter((toolName) => toolName !== TOOL_OUTPUT_READER_TOOL_NAME);
  if (
    !input.readerExecutable ||
    !input.parentAllowedTools.includes(TOOL_OUTPUT_READER_TOOL_NAME)
  ) {
    return businessAllowedTools;
  }
  return [...businessAllowedTools, TOOL_OUTPUT_READER_TOOL_NAME];
}

export function frozenSnapshotHasToolOutputReader(
  snapshot: Pick<BasicAgentCapabilitySnapshot, "toolCatalog"> | undefined,
): boolean {
  if (snapshot?.toolCatalog.allowedTools.includes(TOOL_OUTPUT_READER_TOOL_NAME) !== true) {
    return false;
  }
  return snapshot.toolCatalog.tools.some((tool) =>
    tool.name === TOOL_OUTPUT_READER_TOOL_NAME &&
    tool.enabled &&
    tool.availability === "available"
  );
}

function uniqueToolNames(values: readonly string[]): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const toolName = value.trim();
    if (toolName.length === 0 || seen.has(toolName)) {
      continue;
    }
    seen.add(toolName);
    names.push(toolName);
  }
  return names;
}
