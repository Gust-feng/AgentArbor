import type { ArtifactRef } from "../../domain/common.js";
import { createId, nowIso } from "../id.js";

export type ArtifactRecord = {
  ref: ArtifactRef;
  content: string;
  summary: string;
};

export type SaveArtifactInput = {
  taskId?: string;
  producedBy: string;
  type: ArtifactRef["type"];
  path?: string;
  uri?: string;
  content: string;
  summary: string;
};

export class ArtifactStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactStoreError";
  }
}

export class InMemoryArtifactStore {
  private readonly artifacts = new Map<string, ArtifactRecord>();

  save(input: SaveArtifactInput): ArtifactRecord {
    const ref: ArtifactRef = {
      id: createId("artifact"),
      taskId: input.taskId,
      producedBy: input.producedBy,
      type: input.type,
      path: input.path,
      uri: input.uri,
      version: "1.0.0",
      createdAt: nowIso(),
    };
    const record: ArtifactRecord = {
      ref,
      content: input.content,
      summary: input.summary,
    };
    this.artifacts.set(ref.id, record);
    return record;
  }

  get(artifactId: string): ArtifactRecord {
    const artifact = this.artifacts.get(artifactId);
    if (artifact === undefined) {
      throw new ArtifactStoreError(`Artifact not found: ${artifactId}`);
    }
    return artifact;
  }

  list(): ArtifactRecord[] {
    return [...this.artifacts.values()];
  }
}
