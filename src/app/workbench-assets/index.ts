export type {
  UpdateWorkbenchAssetTextInput,
  UpdateWorkbenchAssetTextResult,
  WorkbenchAsset,
  WorkbenchAssetEvent,
  WorkbenchAssetKind,
  WorkbenchAssetRepository,
  WorkbenchAssetsFeature,
} from "./contracts.js";
export { createWorkbenchAssetsFeature } from "./workbench-assets-feature.js";
export {
  editableWorkbenchAssetText,
  MAX_WORKBENCH_ASSET_TEXT_BYTES,
  replaceWorkbenchAssetText,
  workbenchAssetTextFingerprint,
} from "./asset-text.js";
export { createSqliteWorkbenchAssetRepository } from "./sqlite-repository.js";
export { getAllMaterials as getInitialWorkbenchAssets } from "./initial-assets.js";