import type { ToolExecutionContext, ToolExecutor } from "../../domain/tools/index.js";
import { asRecord, stringOrUndefined } from "../../kernel/values/index.js";
import { AGENT_NOTE_MAX_CHARS, AgentNotesError, type AgentNotesFeature, type AgentNoteScope } from "./contracts.js";

export type NoteToolOptions = {
  readonly notes: Pick<AgentNotesFeature, "commands" | "queries">;
  /** 当前 run 的工作区根目录；工作区笔记以它为作用域。 */
  readonly workspaceRoot: string;
};

/**
 * NoteWrite：模型主动沉淀记忆的工具（ADR-0033）。
 *
 * 设计要点：
 * - 全量替换而不是追加：整理、合并、删旧对模型来说就是普通的编辑动作，
 *   不需要工程提供 merge 语义，也避免笔记只增不减地膨胀。
 * - 工具描述指导模型"先读当前笔记再写完整新版"；当前笔记在系统提示词中
 *   已全文注入，模型天然看得到最新内容。
 * - 低风险写入（只写 runtime 下的笔记文件，不触碰用户工作区），不需要确认。
 */
export function createNoteWriteTool(options: NoteToolOptions): ToolExecutor {
  return {
    definition: {
      name: "NoteWrite",
      description:
        "Save your long-term notes so future sessions remember what you learned. " +
        "Write the COMPLETE revised note content (this replaces the whole note, so keep everything still worth keeping). " +
        "Use scope \"workspace\" for project knowledge: structure, build/test commands, conventions, pitfalls you hit and how you solved them, decisions the user confirmed. " +
        "Use scope \"global\" for cross-project user preferences: language, reply style, recurring tooling choices. " +
        "Record insights and conclusions in your own words; do not transcribe conversation logs or tool output. " +
        `Max ${AGENT_NOTE_MAX_CHARS} characters per note; if the write is rejected as too large, condense and retry.`,
      metadata: {
        category: "workspace",
        riskLevel: "low",
        operationType: "read-write",
        requiresConfirmation: false,
      },
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["workspace", "global"],
            description: "workspace: notes for the current project. global: cross-project user preferences.",
          },
          content: {
            type: "string",
            description: "The complete new note content in Markdown. Replaces the existing note of this scope.",
          },
        },
        required: ["scope", "content"],
      },
    },
    execute: (input, context) => executeNoteWrite(input, context, options),
  };
}

async function executeNoteWrite(
  input: unknown,
  _context: ToolExecutionContext,
  options: NoteToolOptions,
): Promise<unknown> {
  const record = asRecord(input);
  const scopeKind = stringOrUndefined(record.scope);
  const content = typeof record.content === "string" ? record.content : undefined;

  if (scopeKind !== "workspace" && scopeKind !== "global") {
    return { status: "invalid_input", message: 'scope must be "workspace" or "global".' };
  }
  if (content === undefined) {
    return { status: "invalid_input", message: "content must be a string containing the complete note." };
  }

  const scope: AgentNoteScope = scopeKind === "global"
    ? { kind: "global" }
    : { kind: "workspace", workspaceRoot: options.workspaceRoot };

  try {
    const saved = await options.notes.commands.write(scope, content);
    return {
      status: "saved",
      scope: scopeKind,
      characters: saved.content.length,
      updatedAt: saved.updatedAt,
    };
  } catch (error) {
    if (error instanceof AgentNotesError && error.code === "note_too_large") {
      return { status: "note_too_large", message: error.message };
    }
    throw error;
  }
}
