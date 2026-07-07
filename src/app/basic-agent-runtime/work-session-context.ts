export * from "./work-view-context.js";

/**
 * @deprecated Historical ordinary read-model name. New code should use
 * WorkViewTaskSoilCanvasLike.
 */
export type {
  WorkViewCanvasContextLike as WorkSessionCanvasContextLike,
  WorkViewContextProjectionInput as WorkSessionContextProjectionInput,
  WorkViewTaskSoilCanvasLike as WorkSessionTaskSoilCanvasLike,
} from "./work-view-context.js";
