import { z } from "zod";

import { SpaceFeatureError, type SpaceReference } from "./contracts.js";
import { toPersistedJsonShape } from "../../kernel/values/index.js";

export const spaceReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local_file"), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("workspace_folder"), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("web_page"), url: z.string().url() }).strict(),
  z.object({ kind: z.literal("generated_artifact"), artifactRef: z.string().min(1) }).strict(),
  z.object({
    kind: z.literal("conversation"),
    conversationId: z.string().min(1),
    conversationTitle: z.string().min(1).optional(),
  }).strict(),
]);

/** Validate the opaque edge, never by reading or resolving its external target. */
export function validateSpaceReference(reference: SpaceReference): SpaceReference {
  const result = spaceReferenceSchema.safeParse(reference);
  if (!result.success) {
    throw new SpaceFeatureError("space_invalid_input", `Space reference is invalid: ${z.prettifyError(result.error)}`);
  }
  return toPersistedJsonShape(result.data);
}
