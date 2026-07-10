import type {
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { RuntimeRunRecord } from "../../domain/runtime-database/index.js";
import type { PanelConversationReadModel } from "../panel-conversation/panel-conversations.js";
import type { PanelRunStatus } from "../panel-read-model/run/panel-run-status.js";
import type { PanelRunStreamCursor } from "../panel-read-model/run/panel-run-transcript-contracts.js";
import type { PanelRunKind, PanelRunMode } from "./run-jobs.js";
import { projectRunEnvelopeViewBase } from "../run-read-model/envelope.js";

export type PanelRunResponseError = RuntimeRunRecord["error"];

export type PanelRunResponseBase = {
  readonly ok: true;
  readonly runId: string;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelRunMode;
  readonly status: PanelRunStatus;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly streamCursor: PanelRunStreamCursor;
  readonly error?: PanelRunResponseError;
  readonly conversation?: PanelConversationReadModel;
};

export function projectPanelRunResponseBase(input: {
  readonly runId: string;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelRunMode;
  readonly status: PanelRunStatus;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly streamCursor: PanelRunStreamCursor;
  readonly error?: PanelRunResponseError;
  readonly conversation?: PanelConversationReadModel;
}): PanelRunResponseBase {
  return {
    ok: true,
    ...projectRunEnvelopeViewBase({
      runId: input.runId,
      runKind: input.runKind,
      runMode: input.runMode,
      status: input.status,
    }),
    agentDefinitionRef: input.agentDefinitionRef,
    capabilityResolution: input.capabilityResolution,
    config: input.config,
    informationAccess: input.informationAccess,
    streamCursor: input.streamCursor,
    error: input.error,
    conversation: input.conversation,
  };
}
