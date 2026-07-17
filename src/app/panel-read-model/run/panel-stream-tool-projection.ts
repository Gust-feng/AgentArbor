import type { ToolDisplayProjection } from "../../../domain/observation/index.js";
import type { ToolErrorDomain, ToolErrorFacts, ToolFactValue } from "../../../domain/tools/index.js";
import { isToolErrorDomain, toolDisplayName } from "../../../domain/tools/index.js";
import { projectToolDisplay } from "../../tool-projection/tool-display-projection.js";

export type PanelRunStreamEventDetail = {
  readonly kind: "tool";
  readonly display?: ToolDisplayProjection;
  readonly error?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
};

export function toolSummary(
  type: "tool.requested" | "tool.completed" | "tool.failed" | "tool.cancelled",
  payload: Readonly<Record<string, unknown>>
): string {
  const toolName = stringOrUndefined(payload.toolName) ?? "unknown";
  const displayName = stringOrUndefined(payload.toolDisplayName) ?? localToolLabel(toolName);
  if (type === "tool.requested") {
    return displayName;
  }
  if (type === "tool.completed") {
    return `${displayName}完成。`;
  }
  return type === "tool.cancelled"
    ? `${displayName}已取消。`
    : `${displayName}失败。`;
}

export function toolStreamDetail(
  type: "tool.requested" | "tool.completed" | "tool.failed" | "tool.cancelled",
  payload: Readonly<Record<string, unknown>>
): PanelRunStreamEventDetail {
  const toolName = stringOrUndefined(payload.toolName) ?? "tool";
  const input = asRecord(payload.input);
  const output = asRecord(payload.output);
  const display = projectToolDisplay({
    callId: stringOrUndefined(payload.callId) ?? "panel-tool",
    toolName,
    input: cloneToolFactValue(input),
  }, output);
  const errorDomain = errorDomainFromToolFacts(payload, output);
  const errorFacts = errorFactsFromToolFacts(payload, output);
  return {
    kind: "tool",
    display,
    error: type === "tool.failed"
      ? stringOrUndefined(payload.error)
      : type === "tool.cancelled"
        ? stringOrUndefined(payload.reason)
        : undefined,
    errorDomain,
    errorFacts,
  };
}

function toolErrorDomainOrUndefined(value: unknown): ToolErrorDomain | undefined {
  return isToolErrorDomain(value) ? value : undefined;
}

function cloneToolFactValue(value: unknown): ToolFactValue | undefined {
  return value === undefined ? undefined : globalThis.structuredClone(value as ToolFactValue);
}

function toolErrorFactsOrUndefined(value: unknown): ToolErrorFacts | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? globalThis.structuredClone(value as ToolErrorFacts)
    : undefined;
}

function errorDomainFromToolFacts(
  payload: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
): ToolErrorDomain | undefined {
  return toolErrorDomainOrUndefined(output.errorDomain) ?? toolErrorDomainOrUndefined(payload.errorDomain);
}

function errorFactsFromToolFacts(
  payload: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
): ToolErrorFacts | undefined {
  return toolErrorFactsOrUndefined(output.errorFacts) ?? toolErrorFactsOrUndefined(payload.errorFacts);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function localToolLabel(toolName: string): string {
  return toolDisplayName(toolName);
}
