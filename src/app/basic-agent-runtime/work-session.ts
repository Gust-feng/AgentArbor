export * from "./work-view.js";

/**
 * @deprecated Compatibility name for older panel code. New backend read-model
 * composition should use createDesktopWorkViewReadModel.
 */
export {
  createDesktopWorkViewReadModel as createDesktopWorkSessionReadModel,
} from "./work-view.js";

/**
 * @deprecated Compatibility names for older panel code. New backend read-model
 * composition should use DesktopWorkView* names.
 */
export type {
  CreateDesktopWorkViewReadModelInput as CreateDesktopWorkSessionReadModelInput,
  DesktopWorkViewCanvasLike as DesktopWorkSessionCanvasLike,
} from "./work-view.js";
