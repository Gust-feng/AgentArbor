import type { ToolDisplayProjection } from "../contracts/tools";

export function commandText(display: Extract<ToolDisplayProjection, { readonly kind: "command_summary" }>): string | undefined {
  const parts = [display.command, ...(display.args ?? [])].filter((value): value is string => value !== undefined && value.trim().length > 0);
  return parts.length === 0 ? undefined : parts.join(" ");
}

export function genericItemLabel(value: string): string {
  return value.replace(/^(?:file|dir|directory|item)\s+/i, "").trim() || value;
}
