/**
 * 材料假数据 —— 支撑"空间里点开文件"的只读查看。
 *
 * 每个材料声明 kind 与对应的内容载荷；材料视图按 kind 选择渲染器。
 * KIND_META 是全局唯一的「类型 → 颜色 + 标签」映射，列表徽标与材料视图头部共用，
 * 以后接真实数据时替换 MATERIALS 即可，UI 不动。
 */

export type MaterialKind = 'markdown' | 'pdf' | 'web' | 'image' | 'video' | 'audio' | 'code'

export interface Material {
  id: string
  kind: MaterialKind
  title: string
  /** 引用自资料库(只读来源) 还是 空间内产出。 */
  origin: 'library' | 'space'
  meta?: string
  /** 画廊卡片的缩略图(可选)。网页可用 favicon,图片用自身,视频用封面。 */
  thumbnail?: string
  markdown?: string
  pdf?: { pages: string[] }
  web?: { url: string; site: string; body: string }
  image?: { src: string; alt: string; caption?: string }
  video?: { src: string; poster?: string; duration?: string }
  audio?: { src: string; duration?: string; transcript?: string }
  code?: { language: string; filename: string; source: string }
}

export const KIND_META: Record<MaterialKind, { label: string; color: string }> = {
  markdown: { label: 'Markdown', color: '#6f8778' },
  pdf: { label: 'PDF', color: '#c07a55' },
  web: { label: '网页', color: '#6686a2' },
  image: { label: '图片', color: '#7d8a63' },
  video: { label: '视频', color: '#8a6aa0' },
  audio: { label: '音频', color: '#b0885a' },
  code: { label: '代码', color: '#5f8a86' },
}

const NN_IMG =
  'https://images.unsplash.com/photo-1588561181397-fed38f837e17?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxuZXVyYWwlMjBuZXR3b3JrJTIwZGlhZ3JhbSUyMG5vdGVib29rJTIwc3R1ZHl8ZW58MXx8fHwxNzg1MjQ0NDQ4fDA&ixlib=rb-4.1.0&q=80&w=1080'

/** 画廊缩略图素材(unsplash)——仅用于「内容本身就是图片」的材料。 */
const IMG_CHART =
  'https://images.unsplash.com/photo-1551288049-bebda4e38f71?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxkYXRhJTIwdmlzdWFsaXphdGlvbiUyMGNoYXJ0JTIwZGFzaGJvYXJkfGVufDF8fHx8MTc4NTI1MDkwMnww&ixlib=rb-4.1.0&q=80&w=1080'
const IMG_MOUNTAIN =
  'https://images.unsplash.com/photo-1611572789411-6240f6cea970?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3VudGFpbiUyMGxhbmRzY2FwZSUyMGNhbG0lMjBtaW5pbWFsfGVufDF8fHx8MTc4NTI1MDkwM3ww&ixlib=rb-4.1.0&q=80&w=1080'

/** 网页 favicon(用站点域名取)。 */
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`

/** 以 SpaceItem 的 id 为键。 */
export const MATERIALS: Record<string, Material> = {
  'f1-1': {
    id: 'f1-1',
    kind: 'pdf',
    title: 'PyTorch 入门笔记.pdf',
    origin: 'library',
    meta: '2.4 MB · 3 页',
    pdf: {
      pages: [
        `PyTorch 入门\n\nPyTorch 是一个以张量(Tensor)为核心的深度学习框架。张量与 NumPy 的 ndarray 类似，但可以在 GPU 上运算，并且支持自动求导。\n\n创建张量：\n  x = torch.tensor([1.0, 2.0, 3.0])\n  y = torch.zeros(2, 3)\n\n张量的 requires_grad 属性开启后，所有对它的运算都会被记录，用于反向传播时自动计算梯度。`,
        `自动求导 (Autograd)\n\n当一个张量的 requires_grad=True 时，PyTorch 会构建一张动态计算图。调用 .backward() 会沿计算图反向传播，把梯度累加到各叶子张量的 .grad 上。\n\n  x = torch.tensor(2.0, requires_grad=True)\n  y = x ** 2\n  y.backward()\n  print(x.grad)   # 4.0\n\n注意：梯度是累加的，训练循环里每步前要调用 optimizer.zero_grad() 清零。`,
        `训练循环骨架\n\n一个最小可用的训练循环包含五步：前向、算损失、清梯度、反向、更新。\n\n  for epoch in range(epochs):\n      pred = model(x)\n      loss = loss_fn(pred, target)\n      optimizer.zero_grad()\n      loss.backward()\n      optimizer.step()\n\n把这五步记牢，几乎所有 PyTorch 训练代码都是它的变体。`,
      ],
    },
  },
  'f1-2': {
    id: 'f1-2',
    kind: 'web',
    title: 'CS231n 课程主页',
    origin: 'library',
    meta: 'cs231n.stanford.edu',
    thumbnail: favicon('cs231n.stanford.edu'),
    web: {
      url: 'https://cs231n.stanford.edu',
      site: 'cs231n.stanford.edu',
      body: `CS231n：面向视觉识别的卷积神经网络\n\n这门课深入讲解深度学习在计算机视觉中的应用，尤其是图像分类。课程从最近邻、线性分类器讲起，逐步过渡到神经网络与卷积神经网络。\n\n核心主题\n\n- 反向传播与计算图：理解梯度如何在网络中流动\n- 卷积网络架构：卷积层、池化层、批归一化\n- 训练技巧：初始化、优化器选择、正则化与 dropout\n- 迁移学习：如何复用预训练模型\n\n作业围绕从零实现这些组件展开——先手写，再用框架，理解会深得多。`,
    },
  },
  'f1-5': {
    id: 'f1-5',
    kind: 'image',
    title: '神经网络结构图.png',
    origin: 'library',
    meta: '1.8 MB · 1080×720',
    thumbnail: NN_IMG,
    image: {
      src: NN_IMG,
      alt: '桌面上摊开的学习笔记与草图',
      caption: '手绘的网络结构与推导草稿',
    },
  },
  'f1-6': {
    id: 'f1-6',
    kind: 'video',
    title: '梯度下降讲解.mp4',
    origin: 'library',
    meta: '08:24',
    video: {
      src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      poster: NN_IMG,
      duration: '08:24',
    },
  },
  'f2-2': {
    id: 'f2-2',
    kind: 'web',
    title: '卡片笔记法完整介绍',
    origin: 'library',
    meta: 'zettelkasten.de',
    thumbnail: favicon('zettelkasten.de'),
    web: {
      url: 'https://zettelkasten.de',
      site: 'zettelkasten.de',
      body: `卡片笔记法 (Zettelkasten)\n\n卡片笔记法的核心不是"记录"，而是"连接"。每张卡片承载一个原子化的想法，并通过链接与其它卡片相连，逐渐长成一张思想网络。\n\n三类笔记\n\n- 闪念笔记：随手记下的临时想法，当天处理\n- 文献笔记：读到的内容，用自己的话重写\n- 永久笔记：提炼后的原子想法，进入卡片盒并建立链接\n\n关键在于：写永久笔记时强迫自己"用自己的话",这一步就是主动回忆，也是理解真正发生的地方。`,
    },
  },
  'm-attn-pdf': {
    id: 'm-attn-pdf',
    kind: 'pdf',
    title: 'Attention Is All You Need.pdf',
    origin: 'library',
    meta: '1.1 MB · 15 页',
    pdf: {
      pages: [
        `Attention Is All You Need\n\n我们提出 Transformer——一种完全基于注意力机制、彻底抛弃循环与卷积的序列转换模型。在两个机器翻译任务上，它在质量更优的同时更易并行，训练时间大幅缩短。\n\n关键在于自注意力(self-attention)：序列中每个位置都能直接看到其它所有位置，路径长度为常数，长程依赖不再随距离衰减。`,
        `多头注意力 (Multi-Head Attention)\n\n与其用单一注意力，不如把 Q/K/V 线性投影到多个子空间，各自独立做缩放点积注意力，再拼接。\n\n  Attention(Q,K,V) = softmax(QKᵀ/√dₖ) V\n\n多头让模型在不同表示子空间里关注不同位置的信息，是 Transformer 表达力的来源之一。`,
      ],
    },
  },
  'm-transformer-md': {
    id: 'm-transformer-md',
    kind: 'markdown',
    title: 'Transformer 精读.md',
    origin: 'library',
    meta: 'Markdown · 6 KB',
    markdown: `# Transformer 精读\n\n把这篇论文拆成三块来理解：\n\n## 1. 为什么要抛弃 RNN\n\nRNN 必须**按时间步串行**计算，无法并行；而且长程依赖会随距离衰减。自注意力把任意两个位置的路径长度压到 **O(1)**。\n\n## 2. 自注意力的本质\n\n每个 token 都在问：在这句话里，我该多关注谁？用注意力权重给出答案，再据此加权聚合。\n\n## 3. 位置编码\n\n注意力本身不含顺序信息，所以要额外注入位置编码。\n\n关联：见「卡片笔记法」——用自己的话重写，才算真读懂。`,
  },
  'm-loss-img': {
    id: 'm-loss-img',
    kind: 'image',
    title: '训练损失曲线.png',
    origin: 'library',
    meta: '640 KB · 1600×900',
    thumbnail: IMG_CHART,
    image: {
      src: IMG_CHART,
      alt: '屏幕上的性能分析折线图',
      caption: '第 3 次实验：验证集 loss 在第 12 轮后开始反弹，疑似过拟合',
    },
  },
  'm-inspo-img': {
    id: 'm-inspo-img',
    kind: 'image',
    title: '灵感·山.jpg',
    origin: 'space',
    meta: '2.1 MB · 1080×1620',
    thumbnail: IMG_MOUNTAIN,
    image: {
      src: IMG_MOUNTAIN,
      alt: '蓝天下的雪山',
      caption: '像爬山：看不见顶，但每一步都在升高。',
    },
  },
  'm-stanford-video': {
    id: 'm-stanford-video',
    kind: 'video',
    title: '斯坦福公开课·反向传播.mp4',
    origin: 'library',
    meta: '17:52',
    video: {
      src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      duration: '17:52',
    },
  },
  'm-distill-web': {
    id: 'm-distill-web',
    kind: 'web',
    title: 'Distill：特征可视化',
    origin: 'library',
    meta: 'distill.pub',
    thumbnail: favicon('distill.pub'),
    web: {
      url: 'https://distill.pub/2017/feature-visualization',
      site: 'distill.pub',
      body: `特征可视化 (Feature Visualization)\n\n神经网络学到了什么？一种回答方式是：通过优化输入，找出能最大激活某个神经元的图像。\n\n从单个神经元，到通道，再到整层，可视化让我们得以"看见"网络内部的表示。越深的层，越倾向于表示越抽象、越语义化的概念。\n\n这类交互式文章的价值在于：把抽象的高维表示，翻译成人能直接看的图。`,
    },
  },
  'm-podcast-audio': {
    id: 'm-podcast-audio',
    kind: 'audio',
    title: '播客·深度学习的历史.mp3',
    origin: 'library',
    meta: '42:10',
    audio: {
      src: 'https://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Kangaroo_MusiQue_-_The_Neverwritten_Role_Playing_Game.mp3',
      duration: '42:10',
      transcript:
        '……从感知机的寒冬，到 2012 年 AlexNet 在 ImageNet 上的爆发，再到 Transformer 统一各个领域——这一集我们聊聊那些关键转折点，以及它们背后被忽视的人。',
    },
  },
  'm-train-code': {
    id: 'm-train-code',
    kind: 'code',
    title: 'train_loop.py',
    origin: 'space',
    meta: 'Python · 28 行',
    code: {
      language: 'python',
      filename: 'train_loop.py',
      source: `import torch
import torch.nn as nn

def train(model, loader, epochs=10, lr=1e-3):
    """最小可用训练循环：前向 → 算损失 → 清梯度 → 反向 → 更新。"""
    loss_fn = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    for epoch in range(epochs):
        running = 0.0
        for x, target in loader:
            pred = model(x)
            loss = loss_fn(pred, target)

            optimizer.zero_grad()   # 梯度是累加的，每步先清零
            loss.backward()         # 沿计算图反向传播
            optimizer.step()        # 按梯度更新参数

            running += loss.item()
        print(f"epoch {epoch:02d}  loss={running / len(loader):.4f}")

    return model
`,
    },
  },
}

export function getMaterial(id: string): Material | undefined {
  return MATERIALS[id]
}

export function getAllMaterials(): Material[] {
  return Object.values(MATERIALS)
}

/** 材料的可搜索正文(用于全局检索的命中与摘要)。 */
export function materialSearchText(m: Material): string {
  switch (m.kind) {
    case 'markdown':
      return m.markdown ?? ''
    case 'pdf':
      return (m.pdf?.pages ?? []).join('\n')
    case 'web':
      return m.web?.body ?? ''
    case 'image':
      return m.image?.caption ?? ''
    case 'video':
      return ''
    case 'audio':
      return m.audio?.transcript ?? ''
    case 'code':
      return m.code?.source ?? ''
  }
}
