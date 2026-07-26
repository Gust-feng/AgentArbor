import { nowIso } from "../../kernel/id.js";
import {
  AGENT_NOTE_MAX_CHARS,
  AgentNotesError,
  type AgentNoteRepository,
  type AgentNoteScope,
  type AgentNotesFeature,
} from "./contracts.js";

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

  return {
    queries: {
      async get(scope: AgentNoteScope) {
        return input.repository.read(scope);
      },

      async startupInjection(workspaceRoot: string): Promise<string | undefined> {
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
        if (sections.length === 0) return undefined;
        return sections.join("\n\n");
      },
    },

    commands: {
      async write(scope: AgentNoteScope, content: string) {
        if (content.length > AGENT_NOTE_MAX_CHARS) {
          // 显式失败而不是静默截断：让模型自己收到边界并整理笔记（ADR-0033 §3）。
          throw new AgentNotesError(
            "note_too_large",
            `Note is ${content.length} chars; the limit is ${AGENT_NOTE_MAX_CHARS}. ` +
              "Condense the note (merge duplicates, drop stale entries) and write the full revised note again.",
          );
        }
        return input.repository.write(scope, content, now());
      },
    },
  };
}
