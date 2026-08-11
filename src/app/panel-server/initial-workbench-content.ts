export const DEFAULT_SPACE_ID = "space-default";
export const LEARNING_SPACE_ID = "space-learning";

export type InitialWorkbenchFileDefinition =
  | { readonly relativePath: string; readonly source: "text"; readonly content: string }
  | { readonly relativePath: string; readonly source: "bundled"; readonly assetFileName: string };

export type InitialWorkbenchManagedFolderDefinition = {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  readonly files: readonly InitialWorkbenchFileDefinition[];
  readonly imageCaptions?: Readonly<Record<string, string>>;
};

export const INITIAL_WORKBENCH_SPACES = [
  { id: DEFAULT_SPACE_ID, title: "我的空间" },
  { id: LEARNING_SPACE_ID, title: "学习空间" },
] as const;

export const INITIAL_WORKBENCH_MANAGED_FOLDERS: readonly InitialWorkbenchManagedFolderDefinition[] = [
  {
    id: "builtin-my-space-getting-started",
    spaceId: DEFAULT_SPACE_ID,
    title: "开始使用",
    files: [
      {
        relativePath: "AgentArbor 快速开始.md",
        source: "text",
        content: `# 欢迎使用 AgentArbor

这里是你的默认空间。这里的文件与之后由你或 Agent 创建的文件完全相同：可以编辑、重命名、移动、收藏到知识库或删除。

## 建议从这里开始

1. 在空间中整理与一个主题相关的文件、网页和工作成果。
2. 从首页选择这个空间开始对话，Agent 会以该空间作为工作位置。
3. 把值得长期保留的文件收藏到知识库，再用主题和链接继续组织。

这些初始内容只在全新安装时创建。修改或删除后，软件不会自动恢复。`,
      },
      {
        relativePath: "随手记模板.md",
        source: "text",
        content: `# 随手记

## 我正在想什么

-

## 下一步

- [ ]

## 相关资料

-
`,
      },
    ],
  },
  {
    id: "builtin-my-space-inspiration",
    spaceId: DEFAULT_SPACE_ID,
    title: "灵感收藏",
    files: [
      { relativePath: "灵感·山.jpg", source: "bundled", assetFileName: "灵感·山.jpg" },
    ],
    imageCaptions: {
      "灵感·山.jpg": "像爬山：看不见顶，但每一步都在升高。",
    },
  },
  {
    id: "builtin-learning-study-materials",
    spaceId: LEARNING_SPACE_ID,
    title: "2026年学习资料",
    files: [
      { relativePath: "PyTorch 入门笔记.pdf", source: "bundled", assetFileName: "PyTorch 入门笔记.pdf" },
      { relativePath: "神经网络结构图.png", source: "bundled", assetFileName: "神经网络结构图.png" },
    ],
    imageCaptions: {
      "神经网络结构图.png": "输入层、隐藏层与输出层之间的全连接结构示意。",
    },
  },
  {
    id: "builtin-learning-reading-notes",
    spaceId: LEARNING_SPACE_ID,
    title: "阅读笔记",
    files: [
      {
        relativePath: "卡片笔记法完整介绍.md",
        source: "text",
        content: `# 卡片笔记法（Zettelkasten）

卡片笔记法的核心不是“记录”，而是“连接”。每张卡片承载一个原子化的想法，通过链接与其他卡片相连，逐渐长成一张思想网络。

## 三类笔记

- 闪念笔记：随手记下的临时想法，当天处理。
- 文献笔记：读到的内容，用自己的话重写。
- 永久笔记：提炼后的原子想法，进入卡片盒并建立链接。

关键在写永久笔记时强迫自己“用自己的话”。这一步就是主动回忆，也是理解真正发生的地方。`,
      },
      {
        relativePath: "Transformer 精读.md",
        source: "text",
        content: `# Transformer 精读

把 Transformer 拆成三块来理解。

## 1. 为什么要抛弃 RNN

RNN 必须按时间步串行计算，无法充分并行；长程依赖也会随距离增加而变难。自注意力把任意两个位置之间的路径长度压到常数级。

## 2. 自注意力的本质

每个 token 都在问：在这句话里，我应该关注谁？模型用注意力权重回答，再据此聚合上下文。

## 3. 位置编码

注意力本身没有顺序概念，因此需要额外注入位置信息。

阅读时尽量用自己的话重写关键机制，并把结论链接到可以验证它的代码或实验。`,
      },
      {
        relativePath: "train_loop.py",
        source: "text",
        content: `import torch
import torch.nn as nn


def train(model, loader, epochs=10, lr=1e-3):
    """最小训练循环：前向、损失、清梯度、反向与更新。"""
    loss_fn = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    for epoch in range(epochs):
        running_loss = 0.0
        for inputs, targets in loader:
            predictions = model(inputs)
            loss = loss_fn(predictions, targets)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            running_loss += loss.item()

        print(f"epoch {epoch:02d} loss={running_loss / len(loader):.4f}")

    return model
`,
      },
    ],
  },
];

export const INITIAL_WORKBENCH_WEB_REFERENCES = [
  {
    id: "builtin-learning-cs231n",
    spaceId: LEARNING_SPACE_ID,
    title: "CS231n 课程主页",
    url: "https://cs231n.stanford.edu",
  },
] as const;

export const INITIAL_KNOWLEDGE_COLLECTIONS = [
  { key: "inspiration", referenceId: "builtin-my-space-inspiration", relativePath: "灵感·山.jpg" },
  { key: "pytorch", referenceId: "builtin-learning-study-materials", relativePath: "PyTorch 入门笔记.pdf" },
  { key: "network-diagram", referenceId: "builtin-learning-study-materials", relativePath: "神经网络结构图.png" },
  { key: "card-notes", referenceId: "builtin-learning-reading-notes", relativePath: "卡片笔记法完整介绍.md" },
  { key: "transformer", referenceId: "builtin-learning-reading-notes", relativePath: "Transformer 精读.md" },
  { key: "train-loop", referenceId: "builtin-learning-reading-notes", relativePath: "train_loop.py" },
] as const;

export const INITIAL_KNOWLEDGE_THEMES = [
  { id: "builtin-theme-transformer", name: "Transformer", color: "#6865a7", origin: "agent" as const },
  { id: "builtin-theme-training", name: "训练与实践", color: "#c07a55", origin: "agent" as const },
  { id: "builtin-theme-method", name: "读书与方法", color: "#6f8778", origin: "agent" as const },
  { id: "builtin-theme-inspiration", name: "灵感与杂谈", color: "#8a6aa0", origin: "agent" as const },
] as const;

export const INITIAL_KNOWLEDGE_ASSIGNMENTS = [
  { collectionKey: "transformer", themeId: "builtin-theme-transformer" },
  { collectionKey: "train-loop", themeId: "builtin-theme-transformer" },
  { collectionKey: "pytorch", themeId: "builtin-theme-training" },
  { collectionKey: "network-diagram", themeId: "builtin-theme-training" },
  { collectionKey: "train-loop", themeId: "builtin-theme-training" },
  { collectionKey: "card-notes", themeId: "builtin-theme-method" },
  { collectionKey: "transformer", themeId: "builtin-theme-method" },
  { collectionKey: "inspiration", themeId: "builtin-theme-inspiration" },
] as const;

export const INITIAL_KNOWLEDGE_LINKS = [
  { fromCollectionKey: "transformer", toCollectionKey: "card-notes" },
  { fromCollectionKey: "train-loop", toCollectionKey: "pytorch" },
  { fromCollectionKey: "network-diagram", toCollectionKey: "pytorch" },
] as const;
