import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { renameWithRetry } from "../../kernel/fs/atomic-write.js";
import { isFileNotFound } from "../../kernel/values/index.js";
import { AgentNotesError, type AgentNoteRepository, type AgentNoteScope, type AgentNotebook } from "./contracts.js";

/**
 * 笔记的文件系统存储。
 *
 * 布局（`<root>` 为 runtime 下的 agent-notes 目录）：
 *
 * ```text
 * <root>/global/NOTES.md
 * <root>/workspaces/<hash>/NOTES.md
 * <root>/workspaces/<hash>/workspace.json   # 记录原始 workspaceRoot，供人排查
 * ```
 *
 * 笔记正文就是用户可直接打开编辑的 Markdown；这是 ADR-0033 的治理手段
 * （透明可编辑），所以正文旁不放任何会让手工编辑失效的校验和或索引。
 */
export function createFileSystemAgentNoteRepository(rootDir: string): AgentNoteRepository {
  return {
    async read(scope: AgentNoteScope): Promise<AgentNotebook> {
      const file = notePath(rootDir, scope);
      try {
        const [content, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
        return { scope, content, updatedAt: stat.mtime.toISOString() };
      } catch (error) {
        if (isFileNotFound(error)) {
          return { scope, content: "", updatedAt: undefined };
        }
        throw new AgentNotesError("note_io_failure", `Agent note read failed: ${file}`, { cause: error });
      }
    },

    async write(scope: AgentNoteScope, content: string, updatedAt: string): Promise<AgentNotebook> {
      const file = notePath(rootDir, scope);
      const directory = path.dirname(file);
      const tempDirectory = path.join(directory, ".tmp");
      const tempPath = path.join(
        tempDirectory,
        `NOTES.md.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      try {
        await fs.mkdir(tempDirectory, { recursive: true });
        if (scope.kind === "workspace") {
          await writeWorkspaceMarker(directory, scope.workspaceRoot);
        }
        await fs.writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
        try {
          await renameWithRetry(tempPath, file);
        } catch (error) {
          await fs.rm(tempPath, { force: true }).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (error instanceof AgentNotesError) throw error;
        throw new AgentNotesError("note_io_failure", `Agent note write failed: ${file}`, { cause: error });
      }
      return { scope, content, updatedAt };
    },
  };
}

function notePath(rootDir: string, scope: AgentNoteScope): string {
  if (scope.kind === "global") {
    return path.join(rootDir, "global", "NOTES.md");
  }
  return path.join(rootDir, "workspaces", workspaceDirectoryName(scope.workspaceRoot), "NOTES.md");
}

/**
 * 工作区目录名：规范化路径的短哈希。
 * 哈希只用于目录命名（路径可能含不适合做目录名的字符），原始路径写进
 * workspace.json 供人对照，不参与任何运行时判定。
 */
function workspaceDirectoryName(workspaceRoot: string): string {
  const normalized = path.resolve(workspaceRoot).toLowerCase();
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

async function writeWorkspaceMarker(directory: string, workspaceRoot: string): Promise<void> {
  const marker = path.join(directory, "workspace.json");
  try {
    await fs.access(marker);
    return;
  } catch {
    // First write for this workspace: record the origin path for humans.
  }
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(marker, `${JSON.stringify({ workspaceRoot }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
