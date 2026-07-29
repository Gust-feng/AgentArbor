import { readFileSync } from "node:fs";
import path from "node:path";

import type { SqliteRuntimeDatabase } from "../../../adapters/runtime-storage/index.js";
import { importLegacySpaceSnapshot } from "../../spaces/index.js";

/**
 * One-release compatibility boundary for the JSON-backed SpaceTree.
 * Delete this module and its call site after the next published release.
 */
export function importNextReleaseWorkbenchFiles(input: {
  readonly database: SqliteRuntimeDatabase;
  readonly runtimeHome: string;
}): void {
  const filePath = path.join(input.runtimeHome, "spaces", "space-tree.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
  importLegacySpaceSnapshot(input.database, parsed);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
