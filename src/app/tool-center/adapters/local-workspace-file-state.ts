import { promises as fs } from "node:fs";

export type WorkspaceFileVersion = {
  readonly size: number;
  readonly modifiedAtMs: number;
};

/** Run-scoped file versions observed through Read or produced by a write tool. */
export class LocalWorkspaceFileState {
  private readonly versions = new Map<string, WorkspaceFileVersion>();

  async remember(path: string): Promise<WorkspaceFileVersion> {
    const version = await currentVersion(path);
    this.versions.set(path, version);
    return version;
  }

  async assertCurrent(path: string, displayPath: string): Promise<void> {
    const expected = this.versions.get(path);
    if (expected === undefined) {
      throw new Error(`File has not been read in this run: ${displayPath}. Use Read before modifying an existing file.`);
    }
    const actual = await currentVersion(path);
    if (actual.size !== expected.size || actual.modifiedAtMs !== expected.modifiedAtMs) {
      throw new Error(`File changed after it was read: ${displayPath}. Read it again before modifying it.`);
    }
  }
}

async function currentVersion(path: string): Promise<WorkspaceFileVersion> {
  const stat = await fs.stat(path);
  return { size: stat.size, modifiedAtMs: stat.mtimeMs };
}
