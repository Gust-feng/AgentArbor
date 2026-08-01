import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { SpaceReferenceItem } from "../spaces/index.js";
import type { LocalWorkspaceMutationCoordinator } from "../tool-center/adapters/local-workspace-mutation-coordinator.js";
import { PanelHttpError } from "./http-utils.js";
import { isWithinRoot } from "../local-filesystem/index.js";

export type StagedSpaceReferenceDeletion = {
  readonly commit: () => Promise<void>;
  readonly rollback: () => Promise<void>;
};

export async function runSpaceReferenceRemoval(
  items: readonly SpaceReferenceItem[],
  managedFolderRoot: string,
  coordinator: LocalWorkspaceMutationCoordinator,
  removeMetadata: () => Promise<void>,
): Promise<void> {
  const targets = ownedDeletionTargets(items);
  await runWithMutationKeys(coordinator, targets.map((target) => target.mutationKey), async () => {
    const staged: StagedSpaceReferenceDeletion[] = [];
    try {
      for (const target of targets) {
        const deletion = await stageOwnedSpaceReferenceDeletion(target.item, managedFolderRoot);
        if (deletion !== undefined) staged.push(deletion);
      }
    } catch (error) {
      await rollbackStagedDeletions(staged, error);
    }
    try {
      await removeMetadata();
    } catch (error) {
      await rollbackStagedDeletions(staged, error);
    }
    for (const deletion of staged) {
      try {
        await deletion.commit();
      } catch (error) {
        // The source path and metadata are already gone. Cleanup failure is a
        // host diagnostic, not a reason to report the committed delete as failed.
        console.error("[panel-server] Committed Space reference cleanup failed", error);
      }
    }
  });
}

export function spaceReferenceMutationKey(item: SpaceReferenceItem): string {
  return item.reference.kind === "local_file" || item.reference.kind === "workspace_folder" || item.reference.kind === "managed_folder"
    ? item.reference.path
    : item.id;
}

type OwnedDeletionTarget = {
  readonly item: SpaceReferenceItem;
  readonly source: string;
  readonly mutationKey: string;
};

function ownedDeletionTargets(items: readonly SpaceReferenceItem[]): readonly OwnedDeletionTarget[] {
  const candidates = items.flatMap((item): OwnedDeletionTarget[] => {
    if (item.reference.kind !== "local_file" && item.reference.kind !== "managed_folder") return [];
    const source = path.resolve(item.reference.path);
    return [{ item, source, mutationKey: mutationPath(source) }];
  }).sort((left, right) => left.source.length - right.source.length || left.mutationKey.localeCompare(right.mutationKey));
  const roots: OwnedDeletionTarget[] = [];
  for (const candidate of candidates) {
    if (roots.some((root) => root.mutationKey === candidate.mutationKey
      || (root.item.reference.kind === "managed_folder" && isWithinRoot(root.source, candidate.source)))) continue;
    roots.push(candidate);
  }
  return roots.sort((left, right) => left.mutationKey.localeCompare(right.mutationKey));
}

async function runWithMutationKeys<T>(
  coordinator: LocalWorkspaceMutationCoordinator,
  keys: readonly string[],
  operation: () => Promise<T>,
  index = 0,
): Promise<T> {
  const key = keys[index];
  return key === undefined
    ? await operation()
    : await coordinator.run(key, async () => await runWithMutationKeys(coordinator, keys, operation, index + 1));
}

async function rollbackStagedDeletions(
  staged: readonly StagedSpaceReferenceDeletion[],
  cause: unknown,
): Promise<never> {
  try {
    for (const deletion of [...staged].reverse()) await deletion.rollback();
  } catch (rollbackError) {
    throw new AggregateError([cause, rollbackError], "Space reference removal and filesystem rollback both failed.");
  }
  throw cause;
}

function mutationPath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

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
    // User-confirmed file deletion is idempotent: if the source is already
    // gone, only the stale Space metadata still needs to be committed.
    if (error.code === "ENOENT" && item.reference.kind === "local_file") return undefined;
    if (error.code === "ENOENT") throw new PanelHttpError(404, "space_reference_source_missing", "来源文件已不存在。");
    throw error;
  });
  if (stat === undefined) return undefined;
  if (item.reference.kind === "local_file" && !stat.isFile() && !stat.isSymbolicLink()) {
    throw new PanelHttpError(409, "space_reference_file_delete_unavailable", "这个引用不再是可删除的单个文件。");
  }
  if (item.reference.kind === "managed_folder" && !stat.isDirectory()) {
    throw new PanelHttpError(409, "space_managed_folder_not_found", "软件维护的文件夹已不存在。");
  }
  const staged = path.join(path.dirname(source), `.${path.basename(source)}.agentarbor-delete-${randomUUID()}`);
  await fs.rename(source, staged);
  return {
    commit: async () => await fs.rm(staged, { recursive: true, force: true }),
    rollback: async () => await fs.rename(staged, source),
  };
}
