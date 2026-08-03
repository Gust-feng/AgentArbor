import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { isWithinRoot } from "../local-filesystem/index.js";

/** Host-owned storage for directories created from a Space, separate from user-linked workspaces. */
export async function createManagedSpaceFolder(root: string, stableId?: string): Promise<string> {
  await fs.mkdir(root, { recursive: true });
  const directoryName = stableId === undefined
    ? randomUUID()
    : `remote-${createHash("sha256").update(stableId, "utf8").digest("hex").slice(0, 24)}`;
  const folder = path.join(root, directoryName);
  await fs.mkdir(folder, stableId === undefined ? undefined : { recursive: true });
  return folder;
}

export async function deleteManagedSpaceFolder(root: string, folder: string): Promise<void> {
  const rootPath = path.resolve(root);
  const folderPath = path.resolve(folder);
  if (path.relative(rootPath, folderPath).length === 0 || !isWithinRoot(rootPath, folderPath)) {
    throw new Error("Managed Space folder is outside its storage root.");
  }
  await fs.rm(folderPath, { recursive: true, force: false });
}
