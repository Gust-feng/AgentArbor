import type { ToolCallResult, ToolResult } from "../../domain/tools/index.js";

/** Converts one execution fact into an exclusive model body plus error facts. */
export function toolCallResultToModelToolResult(result: ToolCallResult): ToolResult {
  if (result.status === "failed" || result.status === "cancelled") {
    return {
      body: modelBody(result.output),
      error: {
        message: result.error ?? (result.status === "cancelled"
          ? "Tool execution was cancelled."
          : "Tool execution failed."),
        domain: result.errorDomain,
        facts: result.errorFacts,
      },
    };
  }
  if (result.status === "approval_required") {
    return {
      body: {
        format: "json",
        value: {
          confirmation: result.confirmationRequest,
        },
      },
    };
  }
  return { body: modelBody(result.output) };
}

function modelBody(output: ToolCallResult["output"]): ToolResult["body"] {
  if (output === undefined) {
    return { format: "none" };
  }
  if (typeof output === "string") {
    return { format: "text", text: output };
  }
  return { format: "json", value: output };
}
