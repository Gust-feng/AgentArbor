import {
  editableWorkbenchAssetText,
  type WorkbenchAsset,
} from "../workbench-assets/index.js";
import {
  parseContentVaultPayload,
  type ContentVaultResource,
} from "../content-vault/index.js";
import type { ContentVaultLocalResource, ContentVaultSyncContributor } from "./contracts.js";

export type WorkbenchAssetSyncPort = {
  list(): Promise<readonly WorkbenchAsset[]>;
  read(id: string): Promise<WorkbenchAsset | undefined>;
  replace(asset: WorkbenchAsset): Promise<void>;
  subscribe(listener: () => void): () => void;
};

export function createWorkbenchAssetContentVaultContributor(
  port: WorkbenchAssetSyncPort,
): ContentVaultSyncContributor {
  return {
    kind: "workbench_asset",
    async list() { return (await port.list()).flatMap((asset) => project(asset) ?? []); },
    async read(resourceId) {
      const asset = await port.read(resourceId);
      return asset === undefined ? undefined : project(asset);
    },
    async apply(resource) {
      const current = await port.read(resource.resourceId);
      if (resource.deleted) {
        if (current !== undefined) throw new Error("Workbench Asset deletion is not available in Content Vault V1");
        return;
      }
      const payload = parseContentVaultPayload("workbench_asset", requiredPayload(resource));
      const common = {
        id: resource.resourceId,
        title: String(payload.title),
        origin: current?.origin ?? "space" as const,
        ...(current?.meta === undefined ? {} : { meta: current.meta }),
        ...(current?.thumbnail === undefined ? {} : { thumbnail: current.thumbnail }),
      };
      const asset: WorkbenchAsset = payload.kind === "markdown"
        ? { ...common, kind: "markdown", markdown: String(payload.text) }
        : {
            ...common,
            kind: "code",
            code: {
              language: String(payload.language),
              filename: current?.kind === "code" ? current.code?.filename ?? common.title : common.title,
              source: String(payload.text),
            },
          };
      if (sameAssetText(current, asset)) return;
      await port.replace(asset);
    },
    subscribe: port.subscribe,
  };
}

function project(asset: WorkbenchAsset): ContentVaultLocalResource | undefined {
  const editable = editableWorkbenchAssetText(asset);
  if (editable === undefined || asset.kind !== "markdown" && asset.kind !== "code") return undefined;
  return {
    kind: "workbench_asset",
    resourceId: asset.id,
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("workbench_asset", {
      title: asset.title,
      kind: asset.kind,
      text: editable.text,
      language: editable.language,
    }),
  };
}

function sameAssetText(current: WorkbenchAsset | undefined, next: WorkbenchAsset): boolean {
  if (current === undefined || current.kind !== next.kind || current.title !== next.title) return false;
  const left = editableWorkbenchAssetText(current);
  const right = editableWorkbenchAssetText(next);
  return left !== undefined
    && right !== undefined
    && left.text === right.text
    && left.language === right.language;
}

function requiredPayload(resource: ContentVaultResource): Readonly<Record<string, unknown>> {
  if (resource.deleted || resource.payload === undefined) {
    throw new Error(`Content Vault ${resource.kind}/${resource.resourceId} has no active payload`);
  }
  return resource.payload;
}
