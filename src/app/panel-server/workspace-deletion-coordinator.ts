import type { ConversationOwner } from "../../domain/execution-scope/index.js";
import type { OrdinaryAgentFeature } from "../ordinary-agent/index.js";
import type { WorkspaceFeature } from "../workspaces/index.js";
import {
  processCleanupHasUnresolvedStops,
  type InMemoryProcessRegistry,
  type ProcessTerminator,
} from "../runtime-guard/process-registry.js";
import { PanelHttpError } from "./http-utils.js";

export type WorkspaceDeletionCoordinator = {
  ready(): Promise<void>;
  isDeleting(workspaceId: string): boolean;
  assertAvailable(workspaceId: string): void;
  deleteWorkspace(workspaceId: string): Promise<void>;
};

/**
 * Host-owned coordination for Workspace deletion（ADR-0035 §7.2）。
 *
 * 跨 Workspace/Ordinary 的级联顺序：拒绝新 Run -> 停止直属对话进程 -> 删除
 * Workspace owner 的 Conversation/Run -> 移除所有 Space links -> 标记 deleting。
 * 外部真实文件夹与知识库副本始终保留。
 */
export function createWorkspaceDeletionCoordinator(input: {
  readonly workspaces: {
    readonly commands: Pick<WorkspaceFeature["commands"], "deleteWorkspace" | "unlinkWorkspaceFromSpace">;
    readonly queries: Pick<WorkspaceFeature["queries"], "get">;
  };
  readonly ordinary: {
    readonly commands: Pick<OrdinaryAgentFeature["commands"], "deleteConversation">;
    readonly queries: Pick<OrdinaryAgentFeature["queries"], "listConversationsByOwner">;
  };
  readonly processes: Pick<InMemoryProcessRegistry, "cleanupByConversation">;
  readonly processTerminator: ProcessTerminator;
  readonly now?: () => string;
}): WorkspaceDeletionCoordinator {
  const deletingWorkspaceIds = new Set<string>();
  let tail = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    ready() {
      return serialize(async () => {
        // Workspace deletion is synchronous once admitted; nothing durable to
        // resume beyond the feature's own deleting state.
      });
    },
    isDeleting: (workspaceId) => deletingWorkspaceIds.has(workspaceId),
    assertAvailable(workspaceId) {
      if (deletingWorkspaceIds.has(workspaceId)) {
        throw new PanelHttpError(409, "workspace_deletion_in_progress", `工作区 ${workspaceId} 正在删除。`);
      }
    },
    deleteWorkspace(workspaceId) {
      deletingWorkspaceIds.add(workspaceId);
      return serialize(async () => {
        try {
          const workspace = await input.workspaces.queries.get(workspaceId);
          if (workspace === undefined) {
            throw new PanelHttpError(404, "workspace_not_found", "工作区不存在。");
          }
          const conversations = await input.ordinary.queries.listConversationsByOwner({ kind: "workspace", id: workspaceId });
          for (const conversation of conversations) {
            assertProcessCleanupComplete(
              await input.processes.cleanupByConversation(conversation.conversationId, input.processTerminator),
              `Workspace ${workspaceId}`,
            );
            await input.ordinary.commands.deleteConversation(conversation.conversationId);
          }
          const activeLinks = workspace.links.filter((link) => link.status === "active");
          for (const link of activeLinks) {
            await input.workspaces.commands.unlinkWorkspaceFromSpace(link.linkId);
          }
          await input.workspaces.commands.deleteWorkspace(workspaceId);
        } finally {
          deletingWorkspaceIds.delete(workspaceId);
        }
      });
    },
  };
}

function assertProcessCleanupComplete(
  cleanup: Awaited<ReturnType<InMemoryProcessRegistry["cleanupByConversation"]>>,
  owner: string,
): void {
  if (!processCleanupHasUnresolvedStops(cleanup)) return;
  const processIds = [
    ...cleanup.attempted
      .filter((attempt) => attempt.outcome === "unknown" || attempt.outcome === "error")
      .map((attempt) => attempt.processId),
    ...cleanup.skipped
      .filter((skip) => skip.reason !== "inactive_status")
      .map((skip) => skip.processId),
  ];
  throw new PanelHttpError(
    409,
    "background_process_stop_pending",
    `${owner} still has managed processes that could not be confirmed stopped: ${processIds.join(", ")}.`,
  );
}
