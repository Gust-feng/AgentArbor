import { isCompleteRunAgentDefinitionRef } from "../agent-definitions/agent-definition-ref.js";

export type AgentArborRunKind = "desktop" | "underground";

export type AgentArborRunMode = "agent" | "deep";

export type RunModePolicyErrorCode =
  | "desktop_run_mode_not_supported"
  | "underground_run_mode_not_supported"
  | "desktop_agent_capability_snapshot_required"
  | "desktop_agent_definition_ref_required";

export class RunModePolicyError extends Error {
  constructor(
    readonly code: RunModePolicyErrorCode,
    message: string,
    readonly runKind: AgentArborRunKind,
    readonly runMode: AgentArborRunMode
  ) {
    super(message);
    this.name = "RunModePolicyError";
  }
}

export function resolveRunModeForKind(
  runKind: AgentArborRunKind,
  runMode: AgentArborRunMode | undefined
): AgentArborRunMode {
  const effectiveRunMode = runMode ?? defaultRunModeForKind(runKind);
  assertRunModeForKind(runKind, effectiveRunMode);
  return effectiveRunMode;
}

export function defaultRunModeForKind(runKind: AgentArborRunKind): AgentArborRunMode {
  return runKind === "underground" ? "deep" : "agent";
}

export function assertRunModeForKind(
  runKind: AgentArborRunKind,
  runMode: AgentArborRunMode
): void {
  if (runKind === "desktop" && runMode !== "agent") {
    throw new RunModePolicyError(
      "desktop_run_mode_not_supported",
      "Desktop run jobs must use ordinary agent mode.",
      runKind,
      runMode
    );
  }
  if (runKind === "underground" && runMode !== "deep") {
    throw new RunModePolicyError(
      "underground_run_mode_not_supported",
      "Underground run jobs must use deep mode.",
      runKind,
      runMode
    );
  }
}

export function assertRunBirthFactsForKind(input: {
  readonly runKind: AgentArborRunKind;
  readonly runMode: AgentArborRunMode;
  readonly capabilitySnapshot?: unknown;
  readonly agentDefinitionRef?: unknown;
}): void {
  if (input.runKind !== "desktop" || input.runMode !== "agent") {
    return;
  }
  if (input.capabilitySnapshot === undefined) {
    throw new RunModePolicyError(
      "desktop_agent_capability_snapshot_required",
      "Desktop ordinary agent runs require a capability snapshot frozen at run birth.",
      input.runKind,
      input.runMode
    );
  }
  if (!isCompleteRunAgentDefinitionRef(input.agentDefinitionRef)) {
    throw new RunModePolicyError(
      "desktop_agent_definition_ref_required",
      "Desktop ordinary agent runs require a complete AgentDefinition ref frozen at run birth.",
      input.runKind,
      input.runMode
    );
  }
}
