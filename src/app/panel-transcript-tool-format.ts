import { commandDisplayText, type CommandTextLike } from "../domain/tools/presentation.js";

export type CommandDisplayProjectionLike = CommandTextLike & {
  readonly kind: "command_summary";
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly cancelled?: boolean;
  readonly background?: boolean;
  readonly pid?: number;
  readonly logPath?: string;
  readonly stopCommand?: string;
  readonly durationMs?: number;
  readonly waitForPort?: number;
  readonly portReady?: boolean;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
  readonly stdoutChars?: number;
  readonly stderrChars?: number;
  readonly stdoutOmittedChars?: number;
  readonly stderrOmittedChars?: number;
  readonly outputSummary?: string;
  readonly errorSummary?: string;
};

export function commandText(display: CommandDisplayProjectionLike): string | undefined {
  return commandDisplayText(display);
}

export function commandFactParts(display: CommandDisplayProjectionLike): readonly string[] {
  return [
    display.exitCode === undefined ? undefined : `exit ${display.exitCode}`,
    display.timedOut === true ? "超时" : undefined,
    display.cancelled === true ? "已取消" : undefined,
    durationLabel(display.durationMs),
    display.background === true ? backgroundLabel(display) : undefined,
    display.logPath === undefined ? undefined : `log ${display.logPath}`,
    display.stopCommand === undefined ? undefined : `stop ${display.stopCommand}`,
    portReadyLabel(display),
    streamTruncationLabel("stdout", display.stdoutTruncated, display.stdoutChars, display.stdoutOmittedChars),
    streamTruncationLabel("stderr", display.stderrTruncated, display.stderrChars, display.stderrOmittedChars),
  ].filter((value): value is string => value !== undefined && value.length > 0);
}

export function commandSummaryParts(input: {
  readonly display: CommandDisplayProjectionLike;
  readonly failed?: boolean;
  readonly includeOutput?: boolean;
}): readonly string[] {
  const command = commandText(input.display);
  const output = input.includeOutput === false ? undefined : input.display.outputSummary;
  const error = input.failed === true ? input.display.errorSummary : undefined;
  return [
    command,
    ...commandFactParts(input.display),
    output,
    error,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0);
}

export function genericItemLabel(value: string): string {
  return value.replace(/^(?:file|dir|directory|item)\s+/i, "").trim() || value;
}

function durationLabel(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 1_000) {
    return `${Math.max(0, Math.round(value))}ms`;
  }
  const seconds = value / 1_000;
  const rounded = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
  return `${rounded.replace(/\.0$/, "")}s`;
}

function backgroundLabel(display: CommandDisplayProjectionLike): string {
  return display.pid === undefined ? "后台运行" : `后台 pid ${display.pid}`;
}

function portReadyLabel(display: CommandDisplayProjectionLike): string | undefined {
  if (display.waitForPort === undefined) {
    return undefined;
  }
  if (display.portReady === true) {
    return `port ${display.waitForPort} ready`;
  }
  if (display.portReady === false) {
    return `port ${display.waitForPort} not ready`;
  }
  return `waitForPort ${display.waitForPort}`;
}

function streamTruncationLabel(
  name: "stdout" | "stderr",
  truncated: boolean | undefined,
  chars: number | undefined,
  omittedChars: number | undefined
): string | undefined {
  if (truncated === undefined && chars === undefined && omittedChars === undefined) {
    return undefined;
  }
  const size = chars === undefined ? undefined : `${chars} chars`;
  const omitted = omittedChars === undefined || omittedChars <= 0 ? undefined : `${omittedChars} omitted`;
  const status = truncated === true ? "truncated" : truncated === false ? "not truncated" : undefined;
  return [name, status, size, omitted].filter((value): value is string => value !== undefined).join(" ");
}
