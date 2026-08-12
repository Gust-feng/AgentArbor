import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import type { WorkbenchAsset, WorkbenchAssetRepository } from "./contracts.js";
import {
  MAX_WORKBENCH_ASSET_CAPTION_BYTES,
  replaceWorkbenchAssetCaption,
  workbenchAssetCaptionFingerprint,
} from "./asset-caption.js";
import {
  editableWorkbenchAssetText,
  MAX_WORKBENCH_ASSET_TEXT_BYTES,
  replaceWorkbenchAssetText,
  workbenchAssetTextFingerprint,
} from "./asset-text.js";

const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE workbench_assets (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    ) STRICT;
  `,
}] as const;

export function createSqliteWorkbenchAssetRepository(database: SqliteRuntimeDatabase): WorkbenchAssetRepository {
  database.migrate("workbench-assets", MIGRATIONS);
  const selectById = database.connection.prepare(
    "SELECT payload_json AS payloadJson FROM workbench_assets WHERE id = ?",
  );
  const upsert = database.connection.prepare(`
    INSERT INTO workbench_assets(id, payload_json) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json
  `);
  const remove = database.connection.prepare("DELETE FROM workbench_assets WHERE id = ?");
  return {
    async get(id) {
      const row = selectById.get(id) as { payloadJson: string } | undefined;
      return row === undefined ? undefined : JSON.parse(row.payloadJson) as WorkbenchAsset;
    },
    async list() {
      return database.connection.prepare("SELECT payload_json AS payloadJson FROM workbench_assets ORDER BY rowid").all()
        .map((row) => JSON.parse(String((row as { payloadJson: string }).payloadJson)) as WorkbenchAsset);
    },
    async upsertMany(assets) {
      database.transaction(() => {
        for (const asset of assets) upsert.run(asset.id, JSON.stringify(asset));
      });
    },
    async removeMany(assetIds) {
      database.transaction(() => {
        for (const assetId of new Set(assetIds)) remove.run(assetId);
      });
    },
    async updateText(input) {
      if (Buffer.byteLength(input.text, "utf8") > MAX_WORKBENCH_ASSET_TEXT_BYTES) {
        return { status: "too_large" };
      }
      return database.transaction(() => {
        const row = selectById.get(input.id) as { payloadJson: string } | undefined;
        if (row === undefined) return { status: "not_found" } as const;
        const asset = JSON.parse(row.payloadJson) as WorkbenchAsset;
        const editable = editableWorkbenchAssetText(asset);
        if (editable === undefined) return { status: "not_editable", kind: asset.kind } as const;
        const currentFingerprint = workbenchAssetTextFingerprint(editable.text);
        if (currentFingerprint !== input.expectedFingerprint) {
          return { status: "conflict", fingerprint: currentFingerprint } as const;
        }
        const updated = replaceWorkbenchAssetText(asset, input.text);
        upsert.run(updated.id, JSON.stringify(updated));
        return {
          status: "updated",
          asset: updated,
          fingerprint: workbenchAssetTextFingerprint(input.text),
        } as const;
      });
    },
    async updateCaption(input) {
      if (Buffer.byteLength(input.caption, "utf8") > MAX_WORKBENCH_ASSET_CAPTION_BYTES) {
        return { status: "too_large" };
      }
      return database.transaction(() => {
        const row = selectById.get(input.id) as { payloadJson: string } | undefined;
        if (row === undefined) return { status: "not_found" } as const;
        const asset = JSON.parse(row.payloadJson) as WorkbenchAsset;
        if (asset.kind !== "image" || asset.image === undefined) return { status: "not_editable", kind: asset.kind } as const;
        const currentFingerprint = workbenchAssetCaptionFingerprint(asset.image.caption);
        if (currentFingerprint !== input.expectedFingerprint) {
          return { status: "conflict", fingerprint: currentFingerprint } as const;
        }
        const updated = replaceWorkbenchAssetCaption(asset, input.caption);
        upsert.run(updated.id, JSON.stringify(updated));
        return {
          status: "updated",
          asset: updated,
          fingerprint: workbenchAssetCaptionFingerprint(updated.image?.caption),
        } as const;
      });
    },
  };
}