import type { ToolCallResult, ToolResult } from "../../domain/tools/index.js";

/** Converts one canonical execution fact into model-facing tool content. */
export function toolCallResultToModelToolResult(result: ToolCallResult): ToolResult {
  if (result.status === "failed" || result.status === "cancelled") {
    const error = result.error ?? "Tool execution failed.";
    return {
      content: [{ type: "text", text: error }],
      structuredContent: {
        status: result.status,
        output: result.output,
        error,
        errorDomain: result.errorDomain,
        errorFacts: result.errorFacts,
      },
      isError: true,
      error: { message: error, domain: result.errorDomain, facts: result.errorFacts },
    };
  }
  if (result.status === "approval_required") {
    const summary = result.confirmationRequest?.actionSummary ?? result.error ?? "Tool execution requires confirmation.";
    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { status: result.status, output: result.output, confirmation: result.confirmationRequest },
    };
  }
  return {
    content: [{ type: "text", text: factualToolOutputText(result.output) }],
    structuredContent: result.output,
    continuation: toolContinuationFromExecutionFact(result),
  };
}

export function toolContinuationFromExecutionFact(result: ToolCallResult) {
  const output = record(result.output);
  const facts = { ...output, ...record(output.result) };
  const explicit = record(facts.continuation);
  if (Object.keys(explicit).length > 0) return explicit;
  const input = record(result.input);
  const nextInput: Record<string, unknown> = { ...input };
  if (typeof facts.nextStartChar === "number") nextInput.startChar = facts.nextStartChar;
  else if (typeof facts.nextStartLine === "number") nextInput.startLine = facts.nextStartLine;
  else if (facts.hasMoreAfter === true && typeof facts.endLine === "number") {
    nextInput.startLine = facts.endLine + 1;
    delete nextInput.endLine;
  }
  else if (typeof facts.nextOffset === "number") nextInput.offset = facts.nextOffset;
  else if (typeof facts.nextStartRow === "number") nextInput.startRow = facts.nextStartRow;
  else return undefined;
  return { nextInput };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function factualToolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}
