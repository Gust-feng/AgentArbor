export type {
  UpdateWorkbenchAssetTextInput,
  UpdateWorkbenchAssetTextResult,
  UpdateWorkbenchAssetCaptionInput,
  UpdateWorkbenchAssetCaptionResult,
  WorkbenchAsset,
  WorkbenchAssetKind,
  WorkbenchAssetRepository,
  WorkbenchAssetEvent,
  WorkbenchAssetsFeature,
} from "./contracts.js";
export {
  editableWorkbenchAssetText,
  MAX_WORKBENCH_ASSET_TEXT_BYTES,
  replaceWorkbenchAssetText,
  workbenchAssetTextFingerprint,
} from "./asset-text.js";
export {
  MAX_WORKBENCH_ASSET_CAPTION_BYTES,
  replaceWorkbenchAssetCaption,
  workbenchAssetCaptionFingerprint,
} from "./asset-caption.js";
export { createSqliteWorkbenchAssetRepository } from "./sqlite-repository.js";

export { createWorkbenchAssetsFeature } from "./workbench-assets-feature.js";