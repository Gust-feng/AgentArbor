import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import type { PersonalKnowledgeFeature } from "../personal-knowledge/index.js";
import type { SpaceFeature } from "../spaces/index.js";
import type { WorkbenchAssetRepository } from "../workbench-assets/index.js";
import { getInitialWorkbenchAssets } from "../workbench-assets/index.js";

export const INITIAL_WORKBENCH_DATA_KEY = "workbench-initial-assets/v3";
export const INITIAL_SPACE_ID = "space-learning";

export type InitialWorkbenchDataInitializer = {
  ensure(): Promise<void>;
};

/** Shares one active initialization attempt and permits a later retry after failure. */
export function createInitialWorkbenchDataInitializer(
  initialize: () => Promise<void>,
): InitialWorkbenchDataInitializer {
  let completed = false;
  let active: Promise<void> | undefined;
  return {
    ensure() {
      if (completed) return Promise.resolve();
      if (active !== undefined) return active;
      const attempt = initialize().then(() => {
        completed = true;
      }).finally(() => {
        if (active === attempt) active = undefined;
      });
      active = attempt;
      return attempt;
    },
  };
}

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
  readonly workbenchAssets: WorkbenchAssetRepository;
}): Promise<void> {
  if (input.database.hasInitialization(INITIAL_WORKBENCH_DATA_KEY)) return;

  await input.workbenchAssets.upsertMany(getInitialWorkbenchAssets());

  const existingSpace = (await input.spaceFeature.queries.list()).find((space) => space.id === INITIAL_SPACE_ID);
  if (existingSpace === undefined) {
    await input.spaceFeature.commands.createSpace({ id: INITIAL_SPACE_ID, title: "学习空间" });
  }

  const existingTree = await input.spaceFeature.queries.getTree(INITIAL_SPACE_ID);
  const existingItemIds = new Set(existingTree?.entries.map((entry) => entry.item.id) ?? []);
  for (const item of INITIAL_SPACE_ITEMS) {
    if (existingItemIds.has(item.id)) continue;
    await input.spaceFeature.commands.addReference({ ...item, spaceId: INITIAL_SPACE_ID });
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

const INITIAL_SPACE_ITEMS = [
  { id: "f4", title: "学习框架制定对话", reference: { kind: "conversation" as const, conversationId: "conv-learning-plan", conversationTitle: "学习框架制定对话" } },
  { id: "f2", title: "阅读笔记", reference: { kind: "asset_folder" as const } },
  { id: "f2-3", parentId: "f2", title: "认知偏见与阅读整理", reference: { kind: "conversation" as const, conversationId: "conv-bias", conversationTitle: "认知偏见与阅读整理" } },
  { id: "f2-2", parentId: "f2", title: "卡片笔记法完整介绍", reference: { kind: "workbench_asset" as const, assetId: "f2-2" } },
  { id: "f1", title: "2026年学习资料", reference: { kind: "asset_folder" as const } },
  { id: "f1-6", parentId: "f1", title: "梯度下降讲解.mp4", reference: { kind: "workbench_asset" as const, assetId: "f1-6" } },
  { id: "f1-5", parentId: "f1", title: "神经网络结构图.png", reference: { kind: "workbench_asset" as const, assetId: "f1-5" } },
  { id: "f1-3", parentId: "f1", title: "关于梯度下降的讨论", reference: { kind: "conversation" as const, conversationId: "conv-grad", conversationTitle: "关于梯度下降的讨论" } },
  { id: "f1-2", parentId: "f1", title: "CS231n 课程主页", reference: { kind: "workbench_asset" as const, assetId: "f1-2" } },
  { id: "f1-1", parentId: "f1", title: "PyTorch 入门笔记.pdf", reference: { kind: "workbench_asset" as const, assetId: "f1-1" } },
] as const;
