import { createHash } from "node:crypto";

import type { WorkbenchAsset } from "./contracts.js";

export const MAX_WORKBENCH_ASSET_CAPTION_BYTES = 16 * 1024;

export function workbenchAssetCaptionFingerprint(caption: string | undefined): string {
  return `sha256:${createHash("sha256").update(caption ?? "", "utf8").digest("hex")}`;
}

export function replaceWorkbenchAssetCaption(asset: WorkbenchAsset, caption: string): WorkbenchAsset {
  if (asset.kind !== "image" || asset.image === undefined) return asset;
  return {
    ...asset,
    image: {
      ...asset.image,
      ...(caption.length === 0 ? { caption: undefined } : { caption }),
    },
  };
}
