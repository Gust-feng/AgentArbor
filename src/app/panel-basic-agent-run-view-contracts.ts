import type {
  BasicAgentRun,
  DesktopWorkViewReadModel,
  RunEvent,
  TranscriptNode,
} from "../domain/basic-agent/index.js";
import type { RunAgentDefinitionRef, RunCapabilityResolution } from "../domain/config/index.js";
import type { PanelRunCanvasReadModel } from "./panel-canvas-read-model.js";
import type { PanelRunStreamEvent } from "./panel-run-stream-contracts.js";

export type PanelBasicAgentReplayCursor = {
  readonly lastSequence: number;
};

export type PanelBasicAgentReplay<TEvent> = {
  readonly events: readonly TEvent[];
  readonly cursor: PanelBasicAgentReplayCursor;
};

export type PanelBasicAgentRunDetail<TStreamEvent, TTranscriptNode, TCanvas> = {
  readonly runId: string;
  readonly status: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly transcript?: {
    readonly events?: readonly TStreamEvent[];
    readonly transcriptNodes?: readonly TTranscriptNode[];
  };
  readonly canvas?: TCanvas;
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
};

export type PanelBasicAgentRunView<
  TRun,
  TWorkView,
  TEvent,
  TStreamEvent,
  TTranscriptNode,
  TCanvas,
  TCapabilityResolution = unknown,
> = {
  readonly run: TRun;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly capabilityResolution?: TCapabilityResolution;
  readonly workView: TWorkView;
  readonly detail: PanelBasicAgentRunDetail<TStreamEvent, TTranscriptNode, TCanvas>;
  readonly replay: PanelBasicAgentReplay<TEvent>;
};

export type PanelBasicAgentRunDetailReadModel = PanelBasicAgentRunDetail<
  PanelRunStreamEvent,
  TranscriptNode,
  PanelRunCanvasReadModel
>;

export type PanelBasicAgentRunViewReadModel = PanelBasicAgentRunView<
  BasicAgentRun,
  DesktopWorkViewReadModel,
  RunEvent,
  PanelRunStreamEvent,
  TranscriptNode,
  PanelRunCanvasReadModel,
  RunCapabilityResolution
>;
