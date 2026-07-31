import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { SpaceReferenceItem } from "../spaces/index.js";
import { PanelHttpError } from "./http-utils.js";
import { isWithinRoot } from "../local-filesystem/index.js";

export type StagedSpaceReferenceDeletion = {
  readonly commit: () => Promise<void>;
  readonly rollback: () => Promise<void>;
};

/** Moves owned content aside before metadata commit so a failed SQLite write can restore it. */
export async function stageOwnedSpaceReferenceDeletion(
  item: SpaceReferenceItem,
  managedFolderRoot: string,
): Promise<StagedSpaceReferenceDeletion | undefined> {
  if (item.reference.kind !== "local_file" && item.reference.kind !== "managed_folder") return undefined;
  const source = path.resolve(item.reference.path);
  if (item.reference.kind === "managed_folder") {
    const resolvedRoot = path.resolve(managedFolderRoot);
    if (path.relative(resolvedRoot, source).length === 0 || !isWithinRoot(resolvedRoot, source)) {
      throw new PanelHttpError(409, "space_managed_folder_not_found", "软件文件夹不属于当前维护空间。");
    }
  }
  const stat = await fs.lstat(source).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new PanelHttpError(404, "space_reference_source_missing", "来源文件已不存在。");
    throw error;
  });
  if (item.reference.kind === "local_file" && !stat.isFile() && !stat.isSymbolicLink()) {
    throw new PanelHttpError(409, "space_reference_file_delete_unavailable", "这个引用不再是可删除的单个文件。");
  }
  if (item.reference.kind === "managed_folder" && !stat.isDirectory()) {
    throw new PanelHttpError(409, "space_managed_folder_not_found", "软件维护的文件夹已不存在。");
  }
  const staged = path.join(path.dirname(source), `.${path.basename(source)}.agentarbor-delete-${randomUUID()}`);
  await fs.rename(source, staged);
  return {
    commit: async () => await fs.rm(staged, { recursive: true, force: false }),
    rollback: async () => await fs.rename(staged, source),
  };
}
