/**
 * Agent 笔记（模型自主记忆）的公开契约。
 *
 * 笔记是模型自己撰写并沉淀的自然语言记忆（ADR-0033）：模型判断什么值得记、
 * 怎么组织；工程只提供存储、大小边界、启动注入和用户可见可删的机械能力。
 * 笔记不是执行流水档案——那是 PathMemory 的职责。
 */

/** 笔记作用域：跟随工作区的项目笔记，或跨项目的全局偏好笔记。 */
export type AgentNoteScope =
  | { readonly kind: "workspace"; readonly workspaceRoot: string }
  | { readonly kind: "global" };

/** 正文内容派生的版本；用户直接编辑 Markdown 后也会立即形成新版本。 */
export type AgentNoteVersion = `sha256:${string}`;

/** 单本笔记的当前内容与元数据。 */
export type AgentNotebook = {
  readonly scope: AgentNoteScope;
  /** 模型撰写的 Markdown 正文；空串表示还没有笔记。 */
  readonly content: string;
  readonly version: AgentNoteVersion;
  readonly updatedAt: string | undefined;
};

/** 与一次 Ordinary run 启动时所见正文严格对应的两本笔记版本。 */
export type AgentNoteVersions = {
  readonly global: AgentNoteVersion;
  readonly workspace: AgentNoteVersion;
};

export type AgentNotesStartupSnapshot = {
  readonly injection: string | undefined;
  readonly versions: AgentNoteVersions;
};

export type AgentNoteWriteInput = {
  readonly scope: AgentNoteScope;
  readonly content: string;
  readonly expectedVersion: AgentNoteVersion;
};

export type AgentNoteRepositoryWriteInput = AgentNoteWriteInput & {
  readonly updatedAt: string;
};

export type AgentNoteWriteResult =
  | { readonly status: "saved"; readonly notebook: AgentNotebook }
  | { readonly status: "conflict"; readonly current: AgentNotebook };

/**
 * 单本笔记的大小上限（字符）。
 *
 * 这是注入成本的机械边界，不是内容规则：超限时写入失败并明确告知模型，
 * 由模型自己整理精简（对应 Claude Code 只注入 MEMORY.md 前 200 行的同类约束，
 * 我们选择让模型收到显式失败而不是被静默截断）。
 */
export const AGENT_NOTE_MAX_CHARS = 20_000;

/** 笔记存储端口：feature 拥有语义，存储实现只做机械读写。 */
export interface AgentNoteRepository {
  read(scope: AgentNoteScope): Promise<AgentNotebook>;
  write(input: AgentNoteRepositoryWriteInput): Promise<AgentNoteWriteResult>;
}

/** 笔记功能的公开 facade。 */
export type AgentNotesFeature = {
  readonly queries: {
    /** 读取一本笔记；从未写过时返回空内容。 */
    get(scope: AgentNoteScope): Promise<AgentNotebook>;
    /**
     * 同一次读取组装启动注入文本与对应版本，避免 run birth 冻结错位。
     * 两本都为空时 injection 为 undefined，版本仍对应空正文。
     */
    startupSnapshot(workspaceRoot: string): Promise<AgentNotesStartupSnapshot>;
  };
  readonly commands: {
    /**
     * 全量替换一本笔记。模型每次提交完整笔记正文——这让"整理、合并、删旧"
     * 成为模型的普通编辑动作，而不需要工程提供 append/merge 语义。
     */
    write(input: AgentNoteWriteInput): Promise<AgentNoteWriteResult>;
  };
};

export class AgentNotesError extends Error {
  constructor(
    readonly code: "note_too_large" | "note_io_failure",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AgentNotesError";
  }
}
