import { createHash } from "node:crypto";

export type WorkspaceFileVersion = {
  readonly size: number;
  readonly contentHash: string;
};

/** Run-scoped file versions observed through Read or produced by a write tool. */
export class LocalWorkspaceFileState {
  private readonly versions = new Map<string, WorkspaceFileVersion>();

  rememberContent(path: string, content: Uint8Array): WorkspaceFileVersion {
    const version = versionFromContent(content);
    this.versions.set(path, version);
    return version;
  }

  assertContentCurrent(path: string, displayPath: string, content: Uint8Array): void {
    const expected = this.versions.get(path);
    if (expected === undefined) {
      throw new Error(`File has not been read in this run: ${displayPath}. Use Read before modifying an existing file.`);
    }
    const actual = versionFromContent(content);
    if (actual.size !== expected.size || actual.contentHash !== expected.contentHash) {
      throw new Error(`File changed after it was read: ${displayPath}. Read it again before modifying it.`);
    }
  }
}

function versionFromContent(content: Uint8Array): WorkspaceFileVersion {
  return {
    size: content.byteLength,
    contentHash: createHash("sha256").update(content).digest("hex"),
  };
}
