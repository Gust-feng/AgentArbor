import type { PanelRunKind, PanelRunMode } from "./run-jobs.js";
import {
  resolveRunModeForKind,
  RunModePolicyError,
  type RunModePolicyErrorCode,
} from "../run-mode-policy.js";
import { PanelHttpError } from "./http-utils.js";

export function resolvePanelRouteRunMode(input: {
  readonly runKind: PanelRunKind;
  readonly requestedRunMode?: PanelRunMode;
  readonly mismatchCode?: RunModePolicyErrorCode | "conversation_run_mode_not_supported";
  readonly mismatchMessage?: string;
}): PanelRunMode {
  try {
    return resolveRunModeForKind(input.runKind, input.requestedRunMode);
  } catch (error) {
    if (error instanceof RunModePolicyError) {
      throw new PanelHttpError(
        400,
        input.mismatchCode ?? error.code,
        input.mismatchMessage ?? routeRunModeMessage(error)
      );
    }
    throw error;
  }
}

function routeRunModeMessage(error: RunModePolicyError): string {
  return error.code === "desktop_run_mode_not_supported"
    ? "Desktop 默认入口当前只支持普通 agent 运行。请使用显式 deep 入口。"
    : "Underground 入口固定运行 deep 模式，不支持普通 agent 运行。";
}
