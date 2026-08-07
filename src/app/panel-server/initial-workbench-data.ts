import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import type { PersonalKnowledgeFeature } from "../personal-knowledge/index.js";
import type { SpaceFeature } from "../spaces/index.js";
import type { WorkbenchAssetRepository } from "../workbench-assets/index.js";
import { getInitialWorkbenchAssets } from "../workbench-assets/index.js";

export const INITIAL_WORKBENCH_DATA_KEY = "workbench-initial-assets/v5";
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
  "m-train-code",
  "m-distill-web",
  "m-inspo-img",
] as const;

const INITIAL_KNOWLEDGE_THEMES = [
  { id: "t-transformer", name: "Transformer", color: "#6865a7", origin: "agent" as const },
  { id: "t-training", name: "训练与实践", color: "#c07a55", origin: "agent" as const },
  { id: "t-method", name: "读书与方法", color: "#6f8778", origin: "agent" as const },
  { id: "t-inspo", name: "灵感与杂谈", color: "#8a6aa0", origin: "agent" as const },
] as const;

const INITIAL_KNOWLEDGE_ASSIGNMENTS = [
  { refId: "m-attn-pdf", themeId: "t-transformer" },
  { refId: "m-transformer-md", themeId: "t-transformer" },
  { refId: "m-train-code", themeId: "t-transformer" },
  { refId: "f1-1", themeId: "t-training" },
  { refId: "m-train-code", themeId: "t-training" },
  { refId: "m-loss-img", themeId: "t-training" },
  { refId: "f2-2", themeId: "t-method" },
  { refId: "m-transformer-md", themeId: "t-method" },
  { refId: "m-inspo-img", themeId: "t-inspo" },
  { refId: "m-distill-web", themeId: "t-inspo" },
] as const;

const INITIAL_KNOWLEDGE_LINKS = [
  { from: "m-transformer-md", to: "m-attn-pdf" },
  { from: "m-transformer-md", to: "f2-2" },
  { from: "m-loss-img", to: "f1-1" },
  { from: "m-train-code", to: "m-attn-pdf" },
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
    const parentId = "parentId" in item ? item.parentId : undefined;
    if (item.reference.kind === "conversation") {
      await input.spaceFeature.commands.linkConversationOwner({
        id: item.id,
        spaceId: INITIAL_SPACE_ID,
        title: item.title,
        conversationId: item.reference.conversationId,
        conversationTitle: item.reference.conversationTitle,
      });
    } else {
      await input.spaceFeature.commands.addReference({
        id: item.id,
        spaceId: INITIAL_SPACE_ID,
        title: item.title,
        ...(parentId === undefined ? {} : { parentId }),
        reference: item.reference,
      });
    }
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

  const existingThemeIds = new Set(snapshot.themes.map((theme) => theme.id));
  for (const theme of INITIAL_KNOWLEDGE_THEMES) {
    if (existingThemeIds.has(theme.id)) continue;
    await input.personalKnowledgeFeature.commands.execute({ type: "theme.create", theme });
    existingThemeIds.add(theme.id);
  }

  const assignmentKey = (refId: string, themeId: string): string => `${refId}\u0000${themeId}`;
  const existingAssignments = new Set(snapshot.assignments.map((assignment) => assignmentKey(assignment.refId, assignment.themeId)));
  for (const assignment of INITIAL_KNOWLEDGE_ASSIGNMENTS) {
    const key = assignmentKey(assignment.refId, assignment.themeId);
    if (existingAssignments.has(key)) continue;
    await input.personalKnowledgeFeature.commands.execute({
      type: "theme.assign",
      assignment: { ...assignment, by: "agent", locked: false },
    });
    existingAssignments.add(key);
  }

  const linkKey = (from: string, to: string): string => `${from}\u0000${to}`;
  const existingLinks = new Set(snapshot.links.map((link) => linkKey(link.from, link.to)));
  for (const link of INITIAL_KNOWLEDGE_LINKS) {
    const key = linkKey(link.from, link.to);
    if (existingLinks.has(key)) continue;
    await input.personalKnowledgeFeature.commands.execute({ type: "knowledge.link_add", link });
    existingLinks.add(key);
  }

  input.database.recordInitialization(INITIAL_WORKBENCH_DATA_KEY);
}

const INITIAL_SPACE_ITEMS = [
  { id: "f4", title: "学习框架制定对话", reference: { kind: "conversation" as const, conversationId: "conv-learning-plan", conversationTitle: "学习框架制定对话" } },
  { id: "f2", title: "阅读笔记", reference: { kind: "asset_folder" as const } },
  { id: "f2-3", parentId: "f2", title: "认知偏见与阅读整理", reference: { kind: "conversation" as const, conversationId: "conv-bias", conversationTitle: "认知偏见与阅读整理" } },
  { id: "f2-2", parentId: "f2", title: "卡片笔记法完整介绍", reference: { kind: "workbench_asset" as const, assetId: "f2-2" } },
  { id: "f1", title: "2026年学习资料", reference: { kind: "asset_folder" as const } },
  { id: "f1-5", parentId: "f1", title: "神经网络结构图.png", reference: { kind: "workbench_asset" as const, assetId: "f1-5" } },
  { id: "f1-3", parentId: "f1", title: "关于梯度下降的讨论", reference: { kind: "conversation" as const, conversationId: "conv-grad", conversationTitle: "关于梯度下降的讨论" } },
  { id: "f1-2", parentId: "f1", title: "CS231n 课程主页", reference: { kind: "workbench_asset" as const, assetId: "f1-2" } },
  { id: "f1-1", parentId: "f1", title: "PyTorch 入门笔记.pdf", reference: { kind: "workbench_asset" as const, assetId: "f1-1" } },
] as const;
