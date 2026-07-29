export type LearningDemoSpaceItem = {
  id: string
  name: string
  type: 'folder' | 'file' | 'web' | 'conversation'
  domainKind: 'folder' | 'local_file' | 'web_reference' | 'conversation_reference'
  meta?: string
  defaultExpanded?: boolean
  children?: LearningDemoSpaceItem[]
  demo: true
}

export const LEARNING_DEMO_SPACE_TREE: LearningDemoSpaceItem[] = [
  {
    id: 'f1', name: '2026年学习资料', type: 'folder', domainKind: 'folder', demo: true, defaultExpanded: true,
    children: [
      { id: 'f1-1', name: 'PyTorch 入门笔记.pdf', type: 'file', domainKind: 'local_file', meta: '2.4 MB', demo: true },
      { id: 'f1-2', name: 'CS231n 课程主页', type: 'web', domainKind: 'web_reference', meta: 'cs231n.stanford.edu', demo: true },
      { id: 'f1-3', name: '关于梯度下降的讨论', type: 'conversation', domainKind: 'conversation_reference', meta: '昨天', demo: true },
      { id: 'f1-5', name: '神经网络结构图.png', type: 'file', domainKind: 'local_file', meta: '1.8 MB', demo: true },
      { id: 'f1-6', name: '梯度下降讲解.mp4', type: 'file', domainKind: 'local_file', meta: '08:24', demo: true },
    ],
  },
  {
    id: 'f2', name: '阅读笔记', type: 'folder', domainKind: 'folder', demo: true, defaultExpanded: false,
    children: [
      { id: 'f2-2', name: '卡片笔记法完整介绍', type: 'web', domainKind: 'web_reference', meta: 'zettelkasten.de', demo: true },
      { id: 'f2-3', name: '认知偏见与阅读整理', type: 'conversation', domainKind: 'conversation_reference', meta: '3天前', demo: true },
    ],
  },
  { id: 'f4', name: '学习框架制定对话', type: 'conversation', domainKind: 'conversation_reference', meta: '1周前', demo: true },
]

export const LEARNING_DEMO_MATERIAL_IDS = new Set(['f1-1', 'f1-2', 'f1-5', 'f1-6', 'f2-2'])

export const LEARNING_DEMO_CONVERSATION_RESULTS = [
  {
    id: 'conv-grad', name: '关于梯度下降的讨论',
    snippet: '…反向传播的核心是梯度的链式法则,每一层的梯度都依赖更深层的计算结果…',
    haystack: '关于梯度下降的讨论 反向传播 链式法则 梯度',
  },
  {
    id: 'conv-bias', name: '认知偏见与阅读整理',
    snippet: '整合了《思考,快与慢》与认知偏见的研究框架…',
    haystack: '认知偏见与阅读整理 思考快与慢 系统1 系统2',
  },
]

export const LEARNING_DEMO_TIMELINE = [
  { id: 'e1', type: 'conversation' as const, date: '7 月 25 日', time: '09:18', action: '发起对话', title: '建立机器学习学习计划', detail: '学习空间 · 新建会话', navigateTo: 'conv-done' as const },
  { id: 'e2', type: 'file' as const, date: '7 月 26 日', time: '19:42', action: '加入资料', title: 'PyTorch 入门笔记.pdf', detail: '学习空间 · 12 页', navigateTo: 'space' as const },
  { id: 'e3', type: 'web' as const, date: '7 月 27 日', time: '16:47', action: '保存链接', title: 'CS231n 课程主页', detail: '学习空间 · 网页摘录', navigateTo: 'space' as const },
  { id: 'e4', type: 'conversation' as const, date: '7 月 28 日', time: '09:12', action: '继续对话', title: '认知偏见与阅读整理', detail: '对话已归档 · 18 条消息', navigateTo: 'conv-done' as const },
  { id: 'e5', type: 'file' as const, date: '今天', time: '11:08', action: '更新笔记', title: '反向传播推导笔记.md', detail: '学习空间 · 已同步', navigateTo: 'space' as const },
  { id: 'e6', type: 'conversation' as const, date: '今天', time: '14:32', action: '正在进行', title: '整理机器学习学习路径', detail: '对话中 · 6 条消息', navigateTo: 'conv-active' as const },
]
