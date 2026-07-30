import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import type { PersonalKnowledgeFeature } from "../personal-knowledge/index.js";
import type { SpaceFeature } from "../spaces/index.js";

export const INITIAL_WORKBENCH_DATA_KEY = "workbench-initial-assets/v2";
export const INITIAL_SPACE_ID = "space-learning";

const INITIAL_KNOWLEDGE_MATERIAL_IDS = [
  "f1-1",
  "f2-2",
  "m-attn-pdf",
  "m-transformer-md",
  "m-loss-img",
  "m-stanford-video",
  "m-podcast-audio",
  "m-train-code",
  "m-distill-web",
  "m-inspo-img",
] as const;

export async function initializeInitialWorkbenchData(input: {
  readonly database: SqliteRuntimeDatabase;
  readonly spaceFeature: SpaceFeature;
  readonly personalKnowledgeFeature: PersonalKnowledgeFeature;
}): Promise<void> {
  if (input.database.hasInitialization(INITIAL_WORKBENCH_DATA_KEY)) return;

  const existingSpace = (await input.spaceFeature.queries.list()).find(
    (space) => space.demoDataset === "learning-workspace" || space.id === INITIAL_SPACE_ID,
  );
  if (existingSpace === undefined) {
    await input.spaceFeature.commands.createSpace({
      id: INITIAL_SPACE_ID,
      title: "学习空间",
      demoDataset: "learning-workspace",
    });
  }

  const snapshot = await input.personalKnowledgeFeature.queries.snapshot();
  const existingPageIds = new Set(snapshot.pages.map((page) => page.refId));
  const collectedAt = Date.UTC(2026, 6, 29, 12, 0);
  for (const [index, refId] of INITIAL_KNOWLEDGE_MATERIAL_IDS.entries()) {
    if (existingPageIds.has(refId)) continue;
    await input.personalKnowledgeFeature.commands.execute({
      type: "knowledge.collect",
      page: { refId, kind: "material", collectedAt: collectedAt - index * 60 * 60 * 1000 },
    });
  }

  input.database.recordInitialization(INITIAL_WORKBENCH_DATA_KEY);
}
