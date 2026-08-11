import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import type { PersonalKnowledgeFeature } from "../personal-knowledge/index.js";
import type { SpaceFeature } from "../spaces/index.js";
import type { WorkbenchAssetRepository } from "../workbench-assets/index.js";
import { getInitialWorkbenchAssets } from "../workbench-assets/index.js";

/**
 * The production first-install contract is intentionally small: create one
 * ordinary Space and let the user/model populate everything else.
 *
 * The version is separate from the retired demo seed so upgrading a machine
 * never re-imports example assets or treats old demo data as product state.
 */
export const INITIAL_WORKBENCH_DATA_KEY = "workbench-initial-space/v1";
export const INITIAL_SPACE_ID = "space-default";
export const INITIAL_DEMO_DATA_KEY = "workbench-initial-demo/v1";
const DEMO_SPACE_ID = "space-learning";

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
  /** Host-owned root used to materialize each Space managedRoot. */
  readonly managedSpaceRoot?: string;
  /** Development/test seam only. Production must leave the demo seed off. */
  readonly seedDemo?: boolean;
}): Promise<void> {
  if (!input.database.hasInitialization(INITIAL_WORKBENCH_DATA_KEY)) {
    const existingSpaces = await input.spaceFeature.queries.list();
    if (existingSpaces.length === 0) {
      await input.spaceFeature.commands.createSpace({ id: INITIAL_SPACE_ID, title: "我的空间" });
    }
    await ensureSpaceManagedRoot(input.managedSpaceRoot, INITIAL_SPACE_ID);
    input.database.recordInitialization(INITIAL_WORKBENCH_DATA_KEY);
  }

  if (input.seedDemo !== true || input.database.hasInitialization(INITIAL_DEMO_DATA_KEY)) return;

  await input.workbenchAssets.upsertMany(getInitialWorkbenchAssets());

  const existingSpace = (await input.spaceFeature.queries.list()).find((space) => space.id === DEMO_SPACE_ID);
  if (existingSpace === undefined) {
    await input.spaceFeature.commands.createSpace({ id: DEMO_SPACE_ID, title: "学习空间" });
  }
  await ensureSpaceManagedRoot(input.managedSpaceRoot, DEMO_SPACE_ID);

  const existingTree = await input.spaceFeature.queries.getTree(DEMO_SPACE_ID);
  const existingItemIds = new Set(existingTree?.entries.map((entry) => entry.item.id) ?? []);
  for (const item of INITIAL_SPACE_ITEMS) {
    const parentId = "parentId" in item ? item.parentId : undefined;
    if (existingItemIds.has(item.id)) {
      // 旧演示数据缺失 annotation 时，对同一演示引用做一次性补齐；
      // 已有 Agent/用户 annotation 的引用绝不覆盖。
      const existing = existingTree?.entries.find((entry) => entry.item.id === item.id)?.item;
      const initialAnnotation = "annotation" in item ? item.annotation : undefined;
      if (existing?.annotation === undefined && initialAnnotation !== undefined) {
        await input.spaceFeature.commands.updateReferenceAnnotation({
          itemId: item.id,
          expectedRevision: 0,
          patch: { markdown: initialAnnotation.markdown, ...(initialAnnotation.keyPoints === undefined ? {} : { keyPoints: initialAnnotation.keyPoints }), ...(initialAnnotation.tags === undefined ? {} : { tags: initialAnnotation.tags }) },
          actor: { kind: "agent" },
        });
      }
      continue;
    }
    if (item.reference.kind === "conversation") {
      await input.spaceFeature.commands.linkConversationOwner({
        id: item.id,
        spaceId: DEMO_SPACE_ID,
        title: item.title,
        conversationId: item.reference.conversationId,
        conversationTitle: item.reference.conversationTitle,
      });
    } else {
      const initialAnnotation = "annotation" in item ? item.annotation : undefined;
      await input.spaceFeature.commands.addReference({
        id: item.id,
        spaceId: DEMO_SPACE_ID,
        title: item.title,
        ...(parentId === undefined ? {} : { parentId }),
        reference: item.reference,
        ...(initialAnnotation === undefined ? {} : { annotation: initialAnnotation, actor: { kind: "agent" } }),
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

  input.database.recordInitialization(INITIAL_DEMO_DATA_KEY);
}

async function ensureSpaceManagedRoot(root: string | undefined, spaceId: string): Promise<void> {
  if (root === undefined) return;
  await mkdir(path.join(root, spaceId, "files"), { recursive: true });
}

const INITIAL_SPACE_ITEMS = [
  { id: "f4", title: "学习框架制定对话", reference: { kind: "conversation" as const, conversationId: "conv-learning-plan", conversationTitle: "学习框架制定对话" } },
  { id: "f2", title: "阅读笔记", reference: { kind: "asset_folder" as const } },
  { id: "f2-3", parentId: "f2", title: "认知偏见与阅读整理", reference: { kind: "conversation" as const, conversationId: "conv-bias", conversationTitle: "认知偏见与阅读整理" } },
  {
    id: "f2-2", parentId: "f2", title: "卡片笔记法完整介绍", reference: { kind: "workbench_asset" as const, assetId: "f2-2" },
    annotation: {
      markdown: `# 卡片笔记法（Zettelkasten）

卡片笔记法的核心不是"记录"而是"连接"：每张卡片承载一个原子化的想法，通过链接与其他卡片相连，逐渐长成一张思想网络。

## 三类笔记

- 闪念笔记：随手记下的临时想法，当天处理
- 文献笔记：读到的内容，用自己的话重写
- 永久笔记：提炼后的原子想法，进入卡片盒并建立链接

关键在写永久笔记时强迫自己"用自己的话"——这一步就是主动回忆，也是理解真正发生的地方。`,
      keyPoints: ["核心是连接而不是记录", "文献笔记必须用自己的话重写", "永久笔记是理解真正发生的地方"],
      tags: ["读书方法", "笔记法", "知识管理"],
    },
  },
  { id: "f1", title: "2026年学习资料", reference: { kind: "asset_folder" as const } },
  {
    id: "f1-5", parentId: "f1", title: "神经网络结构图.png", reference: { kind: "workbench_asset" as const, assetId: "f1-5" },
    annotation: {
      markdown: `# 手绘网络结构与推导草稿

一张手绘的学习笔记草图，梳理了网络结构示意与推导过程，属于课程学习中的直观理解素材，可配合 CS231n 与 PyTorch 笔记一起使用。`,
      keyPoints: ["网络结构示意图", "包含推导草稿", "课程学习辅助素材"],
      tags: ["深度学习", "手写笔记"],
    },
  },
  { id: "f1-3", parentId: "f1", title: "关于梯度下降的讨论", reference: { kind: "conversation" as const, conversationId: "conv-grad", conversationTitle: "关于梯度下降的讨论" } },
  {
    id: "f1-2", parentId: "f1", title: "CS231n 课程主页", reference: { kind: "workbench_asset" as const, assetId: "f1-2" },
    annotation: {
      markdown: `# CS231n：面向视觉识别的卷积神经网络

这门课深入讲解深度学习在计算机视觉中的应用，尤其是图像分类。课程从最近邻、线性分类器讲起，逐步过渡到神经网络与卷积神经网络。

## 核心主题

- 反向传播与计算图：理解梯度如何在网络中流动
- 卷积网络架构：卷积层、池化层、批归一化
- 训练技巧：初始化、优化器选择、正则化与 dropout
- 迁移学习：如何复用预训练模型

作业围绕从零实现这些组件展开——先手写，再用框架，理解会深得多。`,
      keyPoints: ["从最近邻到卷积网络的完整路径", "反向传播与计算图是理解主线", "作业要求先手写再框架实现"],
      tags: ["CS231n", "计算机视觉", "卷积网络"],
    },
  },
  {
    id: "f1-1", parentId: "f1", title: "PyTorch 入门笔记.pdf", reference: { kind: "workbench_asset" as const, assetId: "f1-1" },
    annotation: {
      markdown: `# PyTorch 入门笔记

一份入门级 PyTorch 笔记，覆盖三个部分：张量与基础运算、自动求导（Autograd）、最小训练循环骨架。

## 要点

- 张量类似 NumPy ndarray，可在 GPU 上运算并支持自动求导
- \`requires_grad=True\` 会构建动态计算图，\`.backward()\` 反向传播梯度
- 梯度是累加的，训练循环每步前要调用 \`optimizer.zero_grad()\` 清零
- 训练循环五步：前向、算损失、清梯度、反向、更新`,
      keyPoints: ["张量是 GPU 上的 ndarray 并支持自动求导", "backward 沿动态计算图传播梯度", "zero_grad 必须在每步前清零", "训练循环五步骨架"],
      tags: ["PyTorch", "深度学习", "入门"],
    },
  },
] as const;
