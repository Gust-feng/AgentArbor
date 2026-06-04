export type CommandDisplayProjectionLike = {
  readonly kind: "command_summary";
  readonly command?: string;
  readonly args?: readonly string[];
};

export function commandText(display: CommandDisplayProjectionLike): string | undefined {
  const parts = [display.command, ...(display.args ?? [])].filter((value): value is string => value !== undefined && value.trim().length > 0);
  return parts.length === 0 ? undefined : parts.join(" ");
}

export function genericItemLabel(value: string): string {
  return value.replace(/^(?:file|dir|directory|item)\s+/i, "").trim() || value;
}
