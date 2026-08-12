import { createHash } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

import { isFileNotFound, isTransientRenameError } from "../../kernel/values/index.js";
import { AgentNotesError, type AgentNoteRepository, type AgentNoteScope, type AgentNotebook } from "./contracts.js";
import { agentNoteContentVersion } from "./note-version.js";
import { agentNoteWorkspaceIdentity } from "./scope-identity.js";

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
export function createFileSystemAgentNoteRepository(
  rootDir: string,
  options: {
    readonly rename?: (source: string, target: string) => Promise<void>;
    readonly waitBeforeRenameRetry?: (attempt: number) => Promise<void>;
  } = {},
): AgentNoteRepository {
  const rename = options.rename ?? fs.rename;
  const waitBeforeRenameRetry = options.waitBeforeRenameRetry ??
    ((attempt: number) => new Promise<void>((resolve) => setTimeout(resolve, 25 * attempt)));
  const read = async (scope: AgentNoteScope): Promise<AgentNotebook> => {
    return readNotebook(notePath(rootDir, scope), scope);
  };

  return {
    read,

    async list(): Promise<readonly AgentNotebook[]> {
      const notebooks: AgentNotebook[] = [await read({ kind: "global" })];
      const workspacesRoot = path.join(rootDir, "workspaces");
      let entries: Dirent[];
      try {
        entries = await fs.readdir(workspacesRoot, { withFileTypes: true });
      } catch (error) {
        if (isFileNotFound(error)) return notebooks;
        throw new AgentNotesError("note_io_failure", "Agent note list failed", { cause: error });
      }
      try {
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const markerPath = path.join(workspacesRoot, entry.name, "workspace.json");
          const marker = JSON.parse(await fs.readFile(markerPath, "utf8")) as { readonly workspaceRoot?: unknown };
          if (typeof marker.workspaceRoot !== "string" || marker.workspaceRoot.length === 0) {
            throw new Error(`Agent note workspace marker is invalid: ${markerPath}`);
          }
          notebooks.push(await read({ kind: "workspace", workspaceRoot: marker.workspaceRoot }));
        }
      } catch (error) {
        throw new AgentNotesError("note_io_failure", "Agent note list failed", { cause: error });
      }
      return notebooks;
    },

    async write(input) {
      const { scope, content, expectedVersion, updatedAt } = input;
      const file = notePath(rootDir, scope);
      const directory = path.dirname(file);
      const tempDirectory = path.join(directory, ".tmp");
      const tempPath = path.join(
        tempDirectory,
        `NOTES.md.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      let tempExists = false;
      try {
        await fs.mkdir(tempDirectory, { recursive: true });
        if (scope.kind === "workspace") {
          await writeWorkspaceMarker(directory, scope.workspaceRoot);
        }
        await fs.writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
        tempExists = true;
        const conflict = await replaceNoteIfCurrent({
          source: tempPath,
          target: file,
          scope,
          expectedVersion,
          rename,
          waitBeforeRenameRetry,
        });
        if (conflict !== undefined) {
          await fs.rm(tempPath, { force: true }).catch(() => undefined);
          tempExists = false;
          return { status: "conflict", current: conflict };
        }
        tempExists = false;
      } catch (error) {
        if (tempExists) await fs.rm(tempPath, { force: true }).catch(() => undefined);
        if (error instanceof AgentNotesError) throw error;
        throw new AgentNotesError("note_io_failure", `Agent note write failed: ${file}`, { cause: error });
      }
      return {
        status: "saved",
        notebook: { scope, content, version: agentNoteContentVersion(content), updatedAt },
      };
    },
  };
}

async function replaceNoteIfCurrent(input: {
  readonly source: string;
  readonly target: string;
  readonly scope: AgentNoteScope;
  readonly expectedVersion: AgentNotebook["version"];
  readonly rename: (source: string, target: string) => Promise<void>;
  readonly waitBeforeRenameRetry: (attempt: number) => Promise<void>;
}): Promise<AgentNotebook | undefined> {
  // Panel's runtime-directory lease excludes another AgentArbor writer. Direct
  // editors do not share that lease, so every Windows rename retry revalidates
  // the Markdown body and leaves only the irreducible compare-to-syscall window.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const current = await readNotebook(input.target, input.scope);
    if (current.version !== input.expectedVersion) return current;
    try {
      await input.rename(input.source, input.target);
      return undefined;
    } catch (error) {
      if (attempt >= 6 || !isTransientRenameError(error)) throw error;
      await input.waitBeforeRenameRetry(attempt);
    }
  }
  throw new Error("Agent note rename retry exhausted without an outcome.");
}

async function readNotebook(file: string, scope: AgentNoteScope): Promise<AgentNotebook> {
  try {
    const [content, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    return {
      scope,
      content,
      version: agentNoteContentVersion(content),
      updatedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    if (isFileNotFound(error)) {
      return {
        scope,
        content: "",
        version: agentNoteContentVersion(""),
        updatedAt: undefined,
      };
    }
    throw new AgentNotesError("note_io_failure", `Agent note read failed: ${file}`, { cause: error });
  }
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
  return createHash("sha256")
    .update(agentNoteWorkspaceIdentity(workspaceRoot), "utf8")
    .digest("hex")
    .slice(0, 16);
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
