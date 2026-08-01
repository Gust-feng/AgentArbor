import { promises as fs } from "node:fs";

import { isNodeError } from "../../kernel/values/index.js";
import type { DesktopTaskSoilInput } from "../task-soil/task-soil-workspace.js";
import { SpaceFeatureError, type SpaceFeature } from "../spaces/index.js";
import { spaceReferenceIdFromAttachmentId } from "../spaces/space-file-access.js";

export type SpaceFileReferenceReconciliationResult = {
  readonly removedReferenceIds: readonly string[];
  readonly inspectionFailures: readonly {
    readonly referenceId: string;
    readonly error: unknown;
  }[];
};

type SpaceFileInspection =
  | { readonly status: "present" }
  | { readonly status: "missing" }
  | { readonly status: "failed"; readonly error: unknown };

type ReconciliationOptions = {
  readonly inspect?: (absolutePath: string) => Promise<SpaceFileInspection>;
};

/** Removes only frozen single-file links that are confirmed absent after an Agent run. */
export async function reconcileMissingRunSpaceFiles(
  spaces: Pick<SpaceFeature, "commands" | "queries">,
  taskSoil: DesktopTaskSoilInput | undefined,
  options: ReconciliationOptions = {},
): Promise<SpaceFileReferenceReconciliationResult> {
  const inspect = options.inspect ?? inspectLocalPath;
  const referenceIds = [...new Set((taskSoil?.contextRefs ?? []).flatMap((contextRef) => {
    const referenceId = contextRef.attachmentId === undefined
      ? undefined
      : spaceReferenceIdFromAttachmentId(contextRef.attachmentId);
    return referenceId === undefined ? [] : [referenceId];
  }))];
  const removedReferenceIds: string[] = [];
  const inspectionFailures: { referenceId: string; error: unknown }[] = [];

  for (const referenceId of referenceIds) {
    const item = await spaces.queries.getReference(referenceId);
    if (item?.reference.kind !== "local_file") continue;
    const inspection = await inspect(item.reference.path);
    if (inspection.status === "failed") {
      inspectionFailures.push({ referenceId, error: inspection.error });
      continue;
    }
    if (inspection.status === "present") continue;
    try {
      await spaces.commands.unlinkReference(referenceId);
      removedReferenceIds.push(referenceId);
    } catch (error) {
      if (!(error instanceof SpaceFeatureError) || error.code !== "space_reference_not_found") throw error;
    }
  }

  return { removedReferenceIds, inspectionFailures };
}

async function inspectLocalPath(absolutePath: string): Promise<SpaceFileInspection> {
  try {
    await fs.lstat(absolutePath);
    return { status: "present" };
  } catch (error) {
    return isNodeError(error, "ENOENT")
      ? { status: "missing" }
      : { status: "failed", error };
  }
}
