import type { RuntimeConversationRecord } from "../domain/runtime-database/index.js";
import type { DesktopTaskSoilInput } from "./task-soil-workspace.js";

export type PanelConversationTurnRole = "user" | "assistant";
export type PanelConversationTurnStatus = "pending" | "running" | "completed" | "failed";

export type PanelConversationTurnModel = {
  readonly profileId: string;
  readonly label?: string;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly baseUrl?: string;
  readonly model?: string;
};

export type PanelConversationTurn = {
  readonly turnId: string;
  readonly role: PanelConversationTurnRole;
  readonly createdAt: string;
  title: string;
  content: string;
  status: PanelConversationTurnStatus;
  updatedAt: string;
  runId?: string;
  responseModel?: PanelConversationTurnModel;
  taskSoilInput?: DesktopTaskSoilInput;
};

export type PanelConversation = {
  readonly conversationId: string;
  readonly createdAt: string;
  title: string;
  updatedAt: string;
  currentRunId?: string;
  latestRunId?: string;
  queuedRunIds: string[];
  turns: PanelConversationTurn[];
};

export type PanelConversationTurnReadModel = {
  readonly turnId: string;
  readonly role: PanelConversationTurnRole;
  readonly title: string;
  readonly content: string;
  readonly status: PanelConversationTurnStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runId?: string;
  readonly responseModel?: PanelConversationTurnModel;
};

export type PanelConversationReadModel = {
  readonly conversationId: string;
  readonly title: string;
  readonly preview: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "idle" | "running" | "completed" | "failed";
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly requiresUserAction: boolean;
  readonly queuedRunIds: readonly string[];
  readonly queuedRunCount: number;
  readonly turns: readonly PanelConversationTurnReadModel[];
};

export type PanelConversationSummaryReadModel = Omit<PanelConversationReadModel, "turns">;

export type TrimRuntimeConversationResult = {
  readonly record: RuntimeConversationRecord;
  readonly trimmed: boolean;
};
