import type { BasicAgentRun, DesktopWorkViewReadModel, RunEvent, TranscriptNode } from "../../domain/basic-agent/index.js";
import type { RunAgentDefinitionRef, RunCapabilityResolution } from "../../domain/config/index.js";
import type { ModelUsage } from "../../domain/intelligence/index.js";
import type { ToolCallResult } from "../../domain/tools/index.js";

export type OrdinaryPanelBasicRun = Omit<BasicAgentRun, "runMode" | "requiresUserAction"> & {
  readonly runMode: "agent";
  readonly requiresUserAction: boolean;
};
export type OrdinaryPanelCapabilityResolution = Omit<RunCapabilityResolution, "runMode"> & {
  readonly runMode: "agent";
};
export type OrdinaryPanelWorkView = Omit<DesktopWorkViewReadModel, "run"> & {
  readonly run: OrdinaryPanelBasicRun;
};

export type OrdinaryPanelReplayCursor = {
  readonly token: string;
  readonly lastSequence: number;
};

export type OrdinaryPanelReplay = {
  readonly reset: boolean;
  readonly events: readonly RunEvent[];
  readonly cursor: OrdinaryPanelReplayCursor;
};

export type OrdinaryPanelRunDetail = {
  readonly runId: string;
  readonly status: OrdinaryPanelBasicRun["status"];
  readonly error?: { readonly code: string; readonly message: string };
  readonly transcript?: { readonly transcriptNodes?: readonly TranscriptNode[] };
  readonly stopReason?: string;
  readonly continuationAvailability?: "none" | "live" | "lost_after_restart" | "new_turn";
  readonly toolResults: readonly ToolCallResult[];
  readonly usage: ModelUsage;
};

export type OrdinaryPanelRunView = {
  readonly run: OrdinaryPanelBasicRun;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly capabilityResolution?: OrdinaryPanelCapabilityResolution;
  readonly workView: OrdinaryPanelWorkView;
  readonly detail: OrdinaryPanelRunDetail;
  readonly replay: OrdinaryPanelReplay;
};
