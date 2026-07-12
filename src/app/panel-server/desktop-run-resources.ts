import { createModelRuntimeDisabledConfigurationError, type ModelRuntimeMode } from "../model-runtime/index.js";
import {
  prepareAgentRunResources,
  type AgentRunResourceHost,
  type AgentRunResources,
} from "./agent-run-resources.js";
import { effectiveDesktopCapabilitySnapshotForRun } from "./desktop-run-model-settings.js";
import { PanelHttpError } from "./http-utils.js";
import type { PanelRunExecutionOptions } from "./run-execution-contracts.js";

export async function prepareOrdinaryAgentRunResources(
  runtime: AgentRunResourceHost,
  aiMode: ModelRuntimeMode,
  options: PanelRunExecutionOptions,
): Promise<AgentRunResources> {
  if (aiMode === "none") {
    throw createModelRuntimeDisabledConfigurationError();
  }
  if (options.capabilitySnapshot === undefined) {
    throw new PanelHttpError(
      500,
      "desktop_capability_snapshot_required",
      "Desktop Agent run requires a capability snapshot frozen when the run was created.",
    );
  }
  if (options.informationAccess === undefined) {
    throw new PanelHttpError(
      500,
      "desktop_information_access_required",
      "Desktop Agent run requires information access settings frozen when the run was created.",
    );
  }
  return prepareAgentRunResources(runtime, aiMode, {
    capabilitySnapshot: effectiveDesktopCapabilitySnapshotForRun(
      options.capabilitySnapshot,
      options.reasoningEffort,
    ),
    informationAccess: options.informationAccess,
    onModelOutputDelta: options.onModelOutputDelta,
  });
}
