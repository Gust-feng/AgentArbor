import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createMinimalReadonlySoilStore, createMinimalSoilConstraints } from "../../domain/soil/index.js";
import { TaskSoilInputValidationError } from "../task-soil-workspace.js";
import {
  createDeepConversationService,
  createFileSystemDeepConversationStore,
  DeepConversationError,
  InMemoryDeepConversationStore,
  type DeepConversationStore,
} from "./deep-conversation.js";
import type { DeepConversation } from "./contracts.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// T2-2 测试点（task.md）：
//   1. deep 会话与普通会话 store 隔离校验
//   2. Task Soil 装配含 workspace 上下文
//   3. 普通会话数据不被污染
// ---------------------------------------------------------------------------

function makeService(store: DeepConversationStore) {
  const soilStore = createMinimalReadonlySoilStore(createMinimalSoilConstraints());
  return createDeepConversationService({
    store,
    constraints: soilStore.listConstraints(),
    soilStore,
    aiMode: "fake",
  });
}

test("createDeepConversation 写入 deep 专属 store 并标记 isolation", async () => {
  const store = new InMemoryDeepConversationStore();
  const service = makeService(store);
  const conversation = await service.create({
    goal: "分析项目并产出优化报告",
    taskSoilInput: {
      contextRefs: [{ ref: "workspace:demo", kind: "workspace", summary: "demo workspace" }],
    },
  });

  // deep 隔离标记
  assert.equal(conversation.isolation.kind, "deep_conversation");
  assert.equal(conversation.isolation.runKind, "underground");
  assert.equal(conversation.isolation.runMode, "deep");
  // id 非空
  assert.ok(conversation.conversationId.length > 0);
  assert.ok(conversation.title.length > 0);
  // 写入 deep 专属 store
  const stored = await store.get(conversation.conversationId);
  assert.equal(stored?.conversationId, conversation.conversationId);
  assert.equal(stored?.isolation.runMode, "deep");
});

test("createDeepConversation 装配 Task Soil 含 workspace 上下文与权限边界", async () => {
  const store = new InMemoryDeepConversationStore();
  const service = makeService(store);
  const conversation = await service.create({
    goal: "评估重构方案",
    taskSoilInput: {
      contextRefs: [
        { ref: "local-file:src/app.ts", kind: "file", summary: "主入口" },
        { ref: "local-project:agentarbor", kind: "project", summary: "项目根" },
      ],
      permissionBoundaryRefs: ["read:local-file:src/app.ts"],
    },
  });
  assert.equal(conversation.taskSoilInput?.contextRefs?.length, 2);
  assert.deepEqual(conversation.permissionBoundaryRefs, ["read:local-file:src/app.ts"]);
  // goal 与 title 保留
  assert.equal(conversation.goal, "评估重构方案");
});

test("createDeepConversation 拒绝非法 workspace 上下文（Task Soil 装配失败，会话不创建）", async () => {
  const store = new InMemoryDeepConversationStore();
  const service = makeService(store);
  await assert.rejects(
    () =>
      service.create({
        goal: "g",
        taskSoilInput: {
          // secret:// 不是授权的 workspace 上下文引用前缀
          contextRefs: [{ ref: "secret://leak", kind: "file" }],
        },
      }),
    TaskSoilInputValidationError,
  );
  // 会话未被创建
  const list = await service.list();
  assert.equal(list.length, 0);
});

test("createDeepConversation 拒绝空 goal", async () => {
  const store = new InMemoryDeepConversationStore();
  const service = makeService(store);
  await assert.rejects(
    () => service.create({ goal: "   " }),
    (error: unknown) => {
      assert.ok(error instanceof DeepConversationError);
      assert.equal((error as DeepConversationError).code, "empty_goal");
      return true;
    },
  );
});

test("DeepConversationService 仅经 DeepConversationStore 读写，不触碰普通会话 store", async () => {
  // 用 spy store 记录所有调用，验证 service.create 只调用 store.upsert（deep 分区），
  // 不调用任何读写普通会话的能力（service 接口本身不暴露 RuntimeDatabase 会话方法）。
  const calls: string[] = [];
  const base = new InMemoryDeepConversationStore();
  const spyStore: DeepConversationStore = {
    async upsert(conversation) {
      calls.push("upsert");
      return base.upsert(conversation);
    },
    async get(id) {
      calls.push("get");
      return base.get(id);
    },
    async list(limit) {
      calls.push("list");
      return base.list(limit);
    },
    async delete(id) {
      calls.push("delete");
      return base.delete(id);
    },
  };
  const service = makeService(spyStore);
  const created = await service.create({ goal: "deep goal" });
  await service.get(created.conversationId);
  await service.list();

  assert.deepEqual(calls, ["upsert", "get", "list"]);
  // 普通 agent 会话数据不被污染：deep list 只含 deep 会话
  const deepList = await service.list();
  assert.equal(deepList.length, 1);
  assert.equal(deepList[0].isolation.kind, "deep_conversation");
});

test("FileSystemDeepConversationStore 写入 runtimeHome/deep-conversations 独立物理分区", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "deep-conv-"));
  try {
    const runtimeHome = path.join(tmp, "runtime");
    const store = createFileSystemDeepConversationStore(runtimeHome);
    const sample: DeepConversation = {
      conversationId: "deep-conversation-fs-1",
      title: "FS Deep 会话",
      goal: "分析项目",
      isolation: {
        kind: "deep_conversation",
        runKind: "underground",
        runMode: "deep",
      },
      permissionBoundaryRefs: [],
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    await store.upsert(sample);

    // 写入 deep-conversations/ 独立分区
    const deepDir = path.join(runtimeHome, "deep-conversations");
    const deepFiles = await fs.readdir(deepDir);
    assert.ok(deepFiles.some((f) => f.includes("deep-conversation-fs-1")));

    // 普通会话目录 conversations/ 不存在（物理隔离于普通会话 store）
    const ordinaryDir = path.join(runtimeHome, "conversations");
    await assert.rejects(() => fs.readdir(ordinaryDir), /ENOENT/);

    // 回读保持 deep 隔离标记
    const got = await store.get(sample.conversationId);
    assert.equal(got?.isolation.runMode, "deep");
    assert.equal(got?.goal, "分析项目");

    // list 只返回 deep 会话
    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].conversationId, sample.conversationId);

    // delete 后 get 返回 undefined
    await store.delete(sample.conversationId);
    const afterDelete = await store.get(sample.conversationId);
    assert.equal(afterDelete, undefined);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("FileSystemDeepConversationStore keeps conversations created by fresh processes distinct", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "deep-conv-restart-"));
  try {
    const runtimeHome = path.join(tmp, "runtime");
    const firstId = await deepConversationIdInFreshProcess();
    const firstStore = createFileSystemDeepConversationStore(runtimeHome);
    await firstStore.upsert(deepConversationRecord(
      firstId,
      "first process",
      "2026-07-14T00:00:01.000Z",
    ));

    const secondId = await deepConversationIdInFreshProcess();
    const restartedStore = createFileSystemDeepConversationStore(runtimeHome);
    await restartedStore.upsert(deepConversationRecord(
      secondId,
      "second process",
      "2026-07-14T00:00:02.000Z",
    ));

    assert.notEqual(firstId, secondId);
    assert.equal((await restartedStore.list()).length, 2);
    assert.equal((await restartedStore.get(firstId))?.title, "first process");
    assert.equal((await restartedStore.get(secondId))?.title, "second process");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DeepConversationService 的 get/list/delete 委托 deep store（隔离读取路径）", async () => {
  const store = new InMemoryDeepConversationStore();
  const service = makeService(store);
  const c1 = await service.create({ goal: "goal one" });
  const c2 = await service.create({ goal: "goal two" });

  // get
  const got = await service.get(c1.conversationId);
  assert.equal(got?.goal, "goal one");

  // list 在相同毫秒内以 opaque id 稳定兜底，不承诺随机 ID 表示创建先后。
  const list = await service.list();
  assert.equal(list.length, 2);
  assert.deepEqual(new Set(list.map((c) => c.conversationId)), new Set([c1.conversationId, c2.conversationId]));

  // list limit
  const limited = await service.list(1);
  assert.equal(limited.length, 1);

  // 删除后 list 不再包含
  await store.delete(c1.conversationId);
  const afterDelete = await service.list();
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].conversationId, c2.conversationId);
});

function deepConversationRecord(
  conversationId: string,
  title: string,
  updatedAt: string,
): DeepConversation {
  return {
    conversationId,
    title,
    goal: title,
    isolation: {
      kind: "deep_conversation",
      runKind: "underground",
      runMode: "deep",
    },
    permissionBoundaryRefs: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

async function deepConversationIdInFreshProcess(): Promise<string> {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "dist", "kernel", "id.js")).href;
  const source = [
    `import { createId } from ${JSON.stringify(moduleUrl)};`,
    "process.stdout.write(createId('deep-conversation'));",
  ].join("\n");
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return stdout.trim();
}
