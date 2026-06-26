/**
 * DeepConversation —— deep 会话隔离边界与 Task Soil 装配（T2-2，FR-002）。
 *
 * 职责边界（design.md §3.1）：
 *   - 创建独立 deep 会话（带隔离标记 {@link DeepConversationIsolationMark}）
 *   - 装配 Task Soil（目标 + 用户显式选择的 workspace 上下文 + 权限边界，
 *     沿用 Desktop Shell 系统选择器授权口径），复用
 *     {@link createTaskSoilFromDesktopInput} 单一装配来源
 *   - 隔离普通会话历史：deep 会话读写路径独立分区（DeepConversationStore），
 *     不读取/不污染普通会话 store（对话历史、确认记录、run 投影）
 *
 * 复用边界（FR-010，复用而非另起）：
 *   - Task Soil 装配复用 task-soil-workspace.ts（含 workspace 上下文授权校验）
 *   - MinimalRuntime 的 soilStore / constraints 复用（Task Soil 装配输入）
 *   - RuntimeDatabase 的存储根（runtimeHome）与文件持久化模式复用——deep 会话
 *     写入 `${runtimeHome}/deep-conversations/` 独立分区，物理隔离于普通会话的
 *     `${runtimeHome}/conversations/`。DeepConversationStore 是 deep 模块自己的
 *     存储抽象；DeepConversationService 不调用 RuntimeDatabase 的会话方法
 *     （upsertConversation/getConversation/listConversations），从而保证隔离。
 */
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { createId, nowIso } from "../../kernel/id.js";
import type { MinimalRuntime } from "../runtime.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import {
  createTaskSoilFromDesktopInput,
  parseDesktopTaskSoilInput,
  type DesktopTaskSoilInput,
} from "../task-soil-workspace.js";
import {
  DEEP_RUN_KIND,
  DEEP_RUN_MODE,
  type DeepConversation,
  type DeepConversationIsolationMark,
} from "./contracts.js";

// ---------------------------------------------------------------------------
// deep 隔离标记工厂
// ---------------------------------------------------------------------------

/** 构造 deep 会话隔离标记（runKind="underground" / runMode="deep" 内部映射）。 */
export function createDeepConversationIsolationMark(): DeepConversationIsolationMark {
  return {
    kind: "deep_conversation",
    runKind: DEEP_RUN_KIND,
    runMode: DEEP_RUN_MODE,
  };
}

// ---------------------------------------------------------------------------
// DeepConversationStore —— deep 专属会话存储（隔离于普通会话 store）
// ---------------------------------------------------------------------------

/**
 * deep 会话存储抽象。实现负责 deep 会话记录的持久化与隔离——
 * 实现不得读写普通会话 store（RuntimeConversationRecord 路径）。
 */
export interface DeepConversationStore {
  upsert(conversation: DeepConversation): Promise<DeepConversation>;
  get(conversationId: string): Promise<DeepConversation | undefined>;
  list(limit?: number): Promise<readonly DeepConversation[]>;
  delete(conversationId: string): Promise<void>;
}

/**
 * 内存版 deep 会话存储（测试 / 临时会话用）。
 *
 * 天然隔离：仅持有 deep 会话记录，与普通会话 store 无任何交叉。
 */
export class InMemoryDeepConversationStore implements DeepConversationStore {
  private readonly conversations = new Map<string, DeepConversation>();

  async upsert(conversation: DeepConversation): Promise<DeepConversation> {
    const stored = cloneDeepConversation(conversation);
    this.conversations.set(stored.conversationId, stored);
    return cloneDeepConversation(stored);
  }

  async get(conversationId: string): Promise<DeepConversation | undefined> {
    const found = this.conversations.get(conversationId);
    return found === undefined ? undefined : cloneDeepConversation(found);
  }

  async list(limit = 50): Promise<readonly DeepConversation[]> {
    return [...this.conversations.values()]
      .sort(compareDeepConversationByRecency)
      .slice(0, Math.max(0, Math.floor(limit)))
      .map(cloneDeepConversation);
  }

  async delete(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
  }
}

/**
 * 创建文件系统版 deep 会话存储。
 *
 * 写入 `${runtimeHome}/deep-conversations/<id>.json` 独立分区，复用
 * file-system-runtime-database 的持久化模式（JSON 文件、encodeURIComponent
 * 文件名、原子写入、ENOENT 容错），但不调用 RuntimeDatabase 的会话方法，
 * 确保与普通会话 `${runtimeHome}/conversations/` 物理隔离。
 */
export function createFileSystemDeepConversationStore(runtimeHome: string): DeepConversationStore {
  const root = path.join(runtimeHome, "deep-conversations");
  return {
    async upsert(conversation: DeepConversation): Promise<DeepConversation> {
      const stored = cloneDeepConversation(conversation);
      await writeJsonFile(path.join(root, `${safeFileName(conversation.conversationId)}.json`), stored);
      return stored;
    },
    async get(conversationId: string): Promise<DeepConversation | undefined> {
      return readJsonFile<DeepConversation>(path.join(root, `${safeFileName(conversationId)}.json`));
    },
    async list(limit = 50): Promise<readonly DeepConversation[]> {
      const entries: readonly Dirent[] = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
        if (isFileNotFound(error)) {
          return [] as readonly Dirent[];
        }
        throw error;
      });
      const conversations = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry) => readJsonFile<DeepConversation>(path.join(root, entry.name))),
      );
      return conversations
        .filter((conversation): conversation is DeepConversation => conversation !== undefined)
        .sort(compareDeepConversationByRecency)
        .slice(0, Math.max(0, Math.floor(limit)));
    },
    async delete(conversationId: string): Promise<void> {
      await fs.rm(path.join(root, `${safeFileName(conversationId)}.json`), { force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// DeepConversationService —— 会话生命周期服务（隔离 + Task Soil 装配）
// ---------------------------------------------------------------------------

/** 创建 deep 会话的输入。goal 必填；workspace 上下文与权限边界统一经 `taskSoilInput`
 *（DesktopTaskSoilInput）传入，复用 task-soil-workspace 的授权校验（拒绝未授权引用）。 */
export type CreateDeepConversationInput = {
  readonly title?: string;
  readonly goal: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
};

/** DeepConversation 会话服务：创建 / 读取 / 列举，全部经 DeepConversationStore（隔离）。 */
export type DeepConversationService = {
  create(input: CreateDeepConversationInput): Promise<DeepConversation>;
  get(conversationId: string): Promise<DeepConversation | undefined>;
  list(limit?: number): Promise<readonly DeepConversation[]>;
};

/**
 * 创建 DeepConversationService。
 *
 * `runtime` 用于 Task Soil 装配（soilStore / constraints）；`aiMode` 决定权限边界
 * 默认值（复用 createTaskSoilFromDesktopInput 的 permission 推导）。
 * DeepConversationService 不持有也不调用 RuntimeDatabase 的会话方法——会话读写
 * 完全经 `store`（deep 专属分区），从而与普通会话 store 隔离。
 */
export function createDeepConversationService(options: {
  readonly store: DeepConversationStore;
  readonly runtime: MinimalRuntime;
  readonly aiMode: ModelRuntimeMode;
}): DeepConversationService {
  const { store, runtime, aiMode } = options;
  return {
    async create(input: CreateDeepConversationInput): Promise<DeepConversation> {
      const goal = input.goal.trim();
      if (goal.length === 0) {
        throw new DeepConversationError("empty_goal", "deep 会话需要非空 goal。");
      }
      const createdAt = nowIso();
      const conversationId = createId("deep-conversation");
      const goalId = createId("goal");
      const traceId = createId("trace");

      // 复用 task-soil-workspace 的授权校验：对 workspace 上下文引用与权限引用做
      // 授权检查（拒绝 secret:// 等未授权引用，沿用 panel-server 入口的
      // parseDesktopTaskSoilInput 同一校验）。校验失败会抛 TaskSoilInputValidationError，
      // 会话不被创建——保证 deep 会话不携带未授权上下文（design.md §3.1）。
      const validatedTaskSoilInput = parseDesktopTaskSoilInput(
        input.taskSoilInput === undefined ? {} : { taskSoilInput: input.taskSoilInput },
      );

      // 装配 Task Soil（复用 task-soil-workspace 单一装配来源）：含 workspace 上下文 +
      // 权限边界（permissionBoundaryRefs 经 createDesktopPermissionRefs 合并默认值）。
      createTaskSoilFromDesktopInput({
        goal,
        goalId,
        traceId,
        aiMode,
        constraints: runtime.constraints,
        soilStore: runtime.soilStore,
        taskSoilInput: validatedTaskSoilInput,
        createdAt,
      });

      const conversation: DeepConversation = {
        conversationId,
        title: deriveTitle(input.title, goal),
        goal,
        isolation: createDeepConversationIsolationMark(),
        taskSoilInput: validatedTaskSoilInput,
        permissionBoundaryRefs: validatedTaskSoilInput.permissionBoundaryRefs ?? [],
        createdAt,
        updatedAt: createdAt,
      };
      return store.upsert(conversation);
    },
    get: (conversationId: string) => store.get(conversationId),
    list: (limit?: number) => store.list(limit),
  };
}

// ---------------------------------------------------------------------------
// 错误类型与工具函数
// ---------------------------------------------------------------------------

/** DeepConversation 服务错误。 */
export class DeepConversationError extends Error {
  constructor(
    readonly code: "empty_goal" | "invalid_workspace_context",
    message: string,
  ) {
    super(message);
    this.name = "DeepConversationError";
  }
}

/**
 * deep 会话最近优先排序比较：先按 updatedAt 倒序；updatedAt 相等时按
 * conversationId 倒序兜底（createId 单调递增，id 字典序更大者创建更晚），
 * 保证 list 顺序确定——即便多次创建落在同一时间戳（nowIso 毫秒精度），
 * 最近创建的会话也稳定排在前面。
 */
function compareDeepConversationByRecency(
  left: DeepConversation,
  right: DeepConversation,
): number {
  const byUpdated = right.updatedAt.localeCompare(left.updatedAt);
  if (byUpdated !== 0) {
    return byUpdated;
  }
  return right.conversationId.localeCompare(left.conversationId);
}

function deriveTitle(title: string | undefined, goal: string): string {
  const trimmedTitle = title?.trim();
  if (trimmedTitle !== undefined && trimmedTitle.length > 0) {
    return trimmedTitle;
  }
  if (goal.length === 0) {
    return "Deep 会话";
  }
  return goal.length > 60 ? `${goal.slice(0, 59)}…` : goal;
}

function cloneDeepConversation(conversation: DeepConversation): DeepConversation {
  return JSON.parse(JSON.stringify(conversation)) as DeepConversation;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const targetDirectory = path.dirname(filePath);
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function safeFileName(value: string): string {
  return encodeURIComponent(value);
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
