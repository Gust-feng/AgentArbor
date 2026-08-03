import { nowIso } from "../../kernel/id.js";
import {
  AGENT_NOTE_MAX_CHARS,
  AgentNotesError,
  type AgentNoteRepository,
  type AgentNoteScope,
  type AgentNotesFeature,
} from "./contracts.js";
import { agentNoteWorkspaceIdentity } from "./scope-identity.js";

export type CreateAgentNotesFeatureInput = {
  readonly repository: AgentNoteRepository;
  readonly now?: () => string;
};

/**
 * Agent 笔记 feature（ADR-0033）。
 *
 * 职责刻意保持最小：读、写、组装启动注入。什么值得记、笔记怎么组织是模型的
 * 判断；用户的治理权是直接查看和编辑文件。这里不做自动总结、不做关键词过滤、
 * 不做审批状态机。
 */
export function createAgentNotesFeature(input: CreateAgentNotesFeatureInput): AgentNotesFeature {
  const now = input.now ?? nowIso;
  const writeTails = new Map<string, Promise<void>>();

  const enqueueWrite = <T>(scope: AgentNoteScope, operation: () => Promise<T>): Promise<T> => {
    const key = scope.kind === "global"
      ? "global"
      : `workspace:${agentNoteWorkspaceIdentity(scope.workspaceRoot)}`;
    const previous = writeTails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    writeTails.set(key, tail);
    void tail.finally(() => {
      if (writeTails.get(key) === tail) writeTails.delete(key);
    });
    return result;
  };

  return {
    queries: {
      async get(scope: AgentNoteScope) {
        return input.repository.read(scope);
      },

      async startupSnapshot(workspaceRoot: string) {
        const [global, workspace] = await Promise.all([
          input.repository.read({ kind: "global" }),
          input.repository.read({ kind: "workspace", workspaceRoot }),
        ]);
        const sections: string[] = [];
        if (global.content.trim().length > 0) {
          sections.push(`## 全局笔记\n\n${global.content.trim()}`);
        }
        if (workspace.content.trim().length > 0) {
          sections.push(`## 当前工作区笔记\n\n${workspace.content.trim()}`);
        }
        return {
          injection: sections.length === 0 ? undefined : sections.join("\n\n"),
          versions: {
            global: global.version,
            workspace: workspace.version,
          },
        };
      },
    },

    commands: {
      async write(command) {
        if (command.content.length > AGENT_NOTE_MAX_CHARS) {
          // 显式失败而不是静默截断：让模型自己收到边界并整理笔记（ADR-0033 §3）。
          throw new AgentNotesError(
            "note_too_large",
            `Note is ${command.content.length} chars; the limit is ${AGENT_NOTE_MAX_CHARS}. ` +
              "Condense the note (merge duplicates, drop stale entries) and write the full revised note again.",
          );
        }
        return enqueueWrite(command.scope, () => input.repository.write({
          ...command,
          updatedAt: now(),
        }));
      },
    },
  };
}
