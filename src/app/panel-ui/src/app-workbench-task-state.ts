import { useEffect, useState } from "react";
import type { AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";

export type AppWorkbenchTaskState = {
  readonly goal: string;
  readonly setGoal: React.Dispatch<React.SetStateAction<string>>;
  readonly attachments: readonly ContextAttachment[];
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly selectedWorkspaceDirectory?: string;
  readonly setSelectedWorkspaceDirectory: React.Dispatch<React.SetStateAction<string | undefined>>;
};

export function useAppWorkbenchTaskState(app: Pick<AppState, "agentMode" | "conversation" | "deep">): AppWorkbenchTaskState {
  const [goal, setGoal] = useState("");
  const [attachments, setAttachments] = useState<readonly ContextAttachment[]>([]);
  const [selectedWorkspaceDirectory, setSelectedWorkspaceDirectory] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (app.agentMode !== "normal" || app.conversation === undefined) return;
    setSelectedWorkspaceDirectory(app.conversation.workspaceFolder?.path);
  }, [app.agentMode, app.conversation?.conversationId, app.conversation?.workspaceFolder?.path]);

  useEffect(() => {
    if (app.agentMode !== "deep" || app.deep === undefined) return;
    setSelectedWorkspaceDirectory(app.deep.run.workspaceFolder?.path);
  }, [app.agentMode, app.deep?.run.runId, app.deep?.run.workspaceFolder?.path]);

  return {
    goal,
    setGoal,
    attachments,
    setAttachments,
    selectedWorkspaceDirectory,
    setSelectedWorkspaceDirectory,
  };
}
