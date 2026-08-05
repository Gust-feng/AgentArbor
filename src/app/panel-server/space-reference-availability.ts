import { stat } from "node:fs/promises";
import type { SpaceFeature, SpaceReferenceItem } from "../spaces/index.js";

/**
 * Reconciles stored reference status with the filesystem so the Panel never shows a
 * missing local resource as usable. Records stay in place; only status is updated.
 */
export async function reconcileSpaceReferenceAvailability(
  feature: SpaceFeature,
  items: readonly SpaceReferenceItem[],
): Promise<void> {
  await Promise.all(items.map(async (item) => {
    const probe = probeTargetFor(item);
    if (probe === undefined) return;
    const status = (await isReachable(probe.path, probe.directory)) ? "available" : "unavailable";
    if (item.status === status) return;
    await feature.commands.markReferenceStatus({ itemId: item.id, status });
  }));
}

function probeTargetFor(item: SpaceReferenceItem): { path: string; directory: boolean } | undefined {
  const reference = item.reference;
  if (reference.kind === "local_file") return { path: reference.path, directory: false };
  if (reference.kind === "workspace_folder") return { path: reference.path, directory: true };
  if (reference.kind === "managed_folder") return { path: reference.path, directory: true };
  return undefined;
}

async function isReachable(target: string, directory: boolean): Promise<boolean> {
  try {
    const entry = await stat(target);
    return directory ? entry.isDirectory() : entry.isFile();
  } catch {
    return false;
  }
}
