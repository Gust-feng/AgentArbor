import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getResolvedPDFJS } from "unpdf";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import type { SpaceReferenceItem } from "../spaces/index.js";
import { releasePanelRuntimeResources } from "./request-handler.js";
import {
  createInitialWorkbenchDataInitializer,
  initializeInitialWorkbenchData,
  INITIAL_BUILTIN_DATA_ELIGIBILITY_KEY,
  INITIAL_BUILTIN_DATA_KEY,
  INITIAL_SPACE_ID,
  INITIAL_WORKBENCH_DATA_KEY,
} from "./initial-workbench-data.js";
import { createPanelRuntime } from "./runtime.js";

test("Panel 全新首次启动把内置内容创建为普通 Space 托管文件和知识收藏", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-initial-space-"));
  try {
    const firstRuntime = createPanelRuntime({ configDirectory: directory });
    let quickStartPath = "";
    let mountainPath = "";
    try {
      await firstRuntime.ensureInitialWorkbenchData();
      assert.equal(firstRuntime.workbenchDatabase.hasInitialization(INITIAL_WORKBENCH_DATA_KEY), true);
      assert.equal(firstRuntime.workbenchDatabase.hasInitialization(INITIAL_BUILTIN_DATA_ELIGIBILITY_KEY), true);
      assert.equal(firstRuntime.workbenchDatabase.hasInitialization(INITIAL_BUILTIN_DATA_KEY), true);

      const spaces = (await firstRuntime.spaceFeature.queries.list()).map(({ id, title }) => ({ id, title }));
      assert.deepEqual(spaces, [
        { id: INITIAL_SPACE_ID, title: "我的空间" },
        { id: "space-learning", title: "学习空间" },
      ]);

      const mySpace = await firstRuntime.spaceFeature.queries.getTree(INITIAL_SPACE_ID);
      assert.equal(mySpace?.entries.length, 2);
      assert.deepEqual(mySpace?.entries.map((entry) => entry.item.title), ["开始使用", "灵感收藏"]);
      const gettingStarted = managedFolder(mySpace?.entries.map((entry) => entry.item) ?? [], "builtin-my-space-getting-started");
      const inspiration = managedFolder(mySpace?.entries.map((entry) => entry.item) ?? [], "builtin-my-space-inspiration");
      quickStartPath = path.join(gettingStarted.reference.path, "AgentArbor 快速开始.md");
      mountainPath = path.join(inspiration.reference.path, "灵感·山.jpg");
      assert.match(await fs.readFile(quickStartPath, "utf8"), /与之后由你或 Agent 创建的文件完全相同/u);
      const mountain = await fs.readFile(mountainPath);
      assert.equal((await fs.stat(mountainPath)).isFile(), true);
      assert.equal(sha256(mountain), "ca8b725928da5a36e9019acf33da95f0602c7ec61daf3053b94f2a07fb474abd");
      assert.equal(inspiration.imageCaptions?.["灵感·山.jpg"]?.text, "像爬山：看不见顶，但每一步都在升高。");

      const learningSpace = await firstRuntime.spaceFeature.queries.getTree("space-learning");
      assert.equal(learningSpace?.entries.length, 4);
      assert.deepEqual(
        learningSpace?.entries.map((entry) => entry.item.title).sort(),
        ["2026年学习资料", "Distill：特征可视化", "CS231n 课程主页", "阅读笔记"].sort(),
      );
      assert.deepEqual(
        learningSpace?.entries.map((entry) => entry.item.reference.kind).sort(),
        ["managed_folder", "managed_folder", "web_page", "web_page"],
      );
      const materials = managedFolder(learningSpace?.entries.map((entry) => entry.item) ?? [], "builtin-learning-study-materials");
      const notes = managedFolder(learningSpace?.entries.map((entry) => entry.item) ?? [], "builtin-learning-reading-notes");
      const referencesByTitle = new Map(learningSpace?.entries.map((entry) => [entry.item.title, entry.item]));
      assert.match(referencesByTitle.get("CS231n 课程主页")?.annotation?.markdown ?? "", /反向传播与计算图/u);
      assert.match(referencesByTitle.get("Distill：特征可视化")?.annotation?.markdown ?? "", /特征可视化/u);
      const pdf = await fs.readFile(path.join(materials.reference.path, "PyTorch 入门笔记.pdf"));
      const diagram = await fs.readFile(path.join(materials.reference.path, "神经网络结构图.png"));
      const lossCurve = await fs.readFile(path.join(materials.reference.path, "训练损失曲线.png"));
      assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
      assert.ok(pdf.length > 100_000, "内置 PyTorch 笔记 PDF 必须包含完整排版内容，而不是占位文件");
      const pdfJs = await getResolvedPDFJS();
      const pdfDocument = await pdfJs.getDocument({ data: new Uint8Array(pdf) }).promise;
      assert.equal(pdfDocument.numPages, 3);
      const pdfText = (await Promise.all(Array.from({ length: pdfDocument.numPages }, async (_, index) => {
        const page = await pdfDocument.getPage(index + 1);
        const content = await page.getTextContent();
        return content.items.map((item: { readonly str: string }) => item.str).join(" ");
      }))).join("\n");
      assert.match(pdfText, /requires_grad/u);
      assert.match(pdfText, /optimizer\.zero_grad/u);
      assert.match(pdfText, /optimizer\.step/u);
      assert.equal(sha256(diagram), "bab45b61e3b615e9dea9e31b53c08b8ddac48b9d78b546d7bc41ad3182595937");
      assert.equal(sha256(lossCurve), "c359d04f5fdf5adf2ebe12228269f7b7195031da00bfa69c895ed8b1f4895f71");
      assert.equal(materials.imageCaptions?.["神经网络结构图.png"]?.text, "手绘的网络结构与推导草稿");
      assert.equal(materials.imageCaptions?.["训练损失曲线.png"]?.text, "第 3 次实验：验证集 loss 在第 12 轮后开始反弹，疑似过拟合");
      assert.match(await fs.readFile(path.join(notes.reference.path, "Transformer 精读.md"), "utf8"), /自注意力/u);
      assert.match(await fs.readFile(path.join(notes.reference.path, "卡片笔记法完整介绍.md"), "utf8"), /Zettelkasten/u);
      assert.equal((await firstRuntime.workbenchAssets.list()).length, 0);

      const knowledge = await firstRuntime.personalKnowledgeFeature.queries.snapshot();
      assert.equal(knowledge.pages.length, 6);
      assert.equal(knowledge.pages.every((page) => page.kind === "space_reference" && page.asset?.status === "managed"), true);
      assert.equal(knowledge.pages.some((page) => page.asset?.sourceReferenceId === inspiration.id
        && page.asset?.sourceRelativePath === "灵感·山.jpg"), true);
      assert.equal(knowledge.themes.length, 4);
      assert.equal(knowledge.assignments.length, 7);
      assert.equal(knowledge.links.length, 3);

      await fs.writeFile(quickStartPath, "用户已经修改", "utf8");
      await fs.rm(mountainPath);
    } finally {
      await releasePanelRuntimeResources(firstRuntime);
    }

    const restartedRuntime = createPanelRuntime({ configDirectory: directory });
    try {
      await restartedRuntime.ensureInitialWorkbenchData();
      assert.equal((await restartedRuntime.spaceFeature.queries.list()).length, 2);
      assert.equal(await fs.readFile(quickStartPath, "utf8"), "用户已经修改");
      await assert.rejects(fs.access(mountainPath), (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "ENOENT");
      assert.equal((await restartedRuntime.workbenchAssets.list()).length, 0);
      assert.equal((await restartedRuntime.personalKnowledgeFeature.queries.snapshot()).pages.length, 6);
    } finally {
      await releasePanelRuntimeResources(restartedRuntime);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("升级旧数据库不会导入内置内容，只补齐我的空间", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-initial-upgrade-"));
  try {
    const databasePath = path.join(directory, "runtime", "workbench.sqlite3");
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const legacyDatabase = new SqliteRuntimeDatabase(databasePath);
    legacyDatabase.recordInitialization("workbench-initial-assets/v5");
    legacyDatabase.close();

    const runtime = createPanelRuntime({ configDirectory: directory });
    try {
      await runtime.ensureInitialWorkbenchData();
      assert.equal(runtime.workbenchDatabase.hasInitialization(INITIAL_WORKBENCH_DATA_KEY), true);
      assert.equal(runtime.workbenchDatabase.hasInitialization(INITIAL_BUILTIN_DATA_ELIGIBILITY_KEY), false);
      assert.equal(runtime.workbenchDatabase.hasInitialization(INITIAL_BUILTIN_DATA_KEY), false);
      assert.deepEqual(
        (await runtime.spaceFeature.queries.list()).map(({ id, title }) => ({ id, title })),
        [{ id: INITIAL_SPACE_ID, title: "我的空间" }],
      );
      assert.deepEqual((await runtime.spaceFeature.queries.getTree(INITIAL_SPACE_ID))?.entries, []);
      assert.deepEqual(await runtime.workbenchAssets.list(), []);
      assert.deepEqual((await runtime.personalKnowledgeFeature.queries.snapshot()).pages, []);
    } finally {
      await releasePanelRuntimeResources(runtime);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("已有业务数据但缺少初始化标记时不会误判为首次安装", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-initial-existing-data-"));
  try {
    const runtime = createPanelRuntime({
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
    });
    try {
      await runtime.spaceFeature.commands.createSpace({ id: "space-user", title: "用户空间" });
      await initializeInitialWorkbenchData({
        database: runtime.workbenchDatabase,
        spaceFeature: runtime.spaceFeature,
        personalKnowledgeFeature: runtime.personalKnowledgeFeature,
        workbenchAssets: runtime.workbenchAssets,
        managedSpaceRoot: path.join(directory, "runtime", "spaces"),
        managedSpaceFolderRoot: path.join(directory, "runtime", "space-folders"),
      });

      assert.equal(runtime.workbenchDatabase.hasInitialization(INITIAL_BUILTIN_DATA_ELIGIBILITY_KEY), false);
      assert.equal(runtime.workbenchDatabase.hasInitialization(INITIAL_BUILTIN_DATA_KEY), false);
      assert.deepEqual(
        (await runtime.spaceFeature.queries.list())
          .map(({ id, title }) => ({ id, title }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        [
          { id: INITIAL_SPACE_ID, title: "我的空间" },
          { id: "space-user", title: "用户空间" },
        ],
      );
      assert.deepEqual((await runtime.spaceFeature.queries.getTree(INITIAL_SPACE_ID))?.entries, []);
      assert.deepEqual(await runtime.workbenchAssets.list(), []);
      assert.deepEqual((await runtime.personalKnowledgeFeature.queries.snapshot()).pages, []);
    } finally {
      await releasePanelRuntimeResources(runtime);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("首次内置内容导入失败后沿同一安装批次继续且不复制文件或知识页面", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-initial-retry-"));
  try {
    const runtime = createPanelRuntime({
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
    });
    try {
      const knowledge = runtime.personalKnowledgeFeature;
      let failAfterFirstCollection = true;
      const flakyKnowledge: typeof knowledge = {
        ...knowledge,
        commands: {
          ...knowledge.commands,
          collectSpaceReference: async (input) => {
            const page = await knowledge.commands.collectSpaceReference(input);
            if (failAfterFirstCollection) {
              failAfterFirstCollection = false;
              throw new Error("simulated initial content interruption");
            }
            return page;
          },
        },
      };
      const initialize = async (personalKnowledgeFeature: typeof knowledge) =>
        await initializeInitialWorkbenchData({
          database: runtime.workbenchDatabase,
          spaceFeature: runtime.spaceFeature,
          personalKnowledgeFeature,
          workbenchAssets: runtime.workbenchAssets,
          managedSpaceRoot: path.join(directory, "runtime", "spaces"),
          managedSpaceFolderRoot: path.join(directory, "runtime", "space-folders"),
        });

      await assert.rejects(initialize(flakyKnowledge), /simulated initial content interruption/u);
      assert.equal(runtime.workbenchDatabase.hasInitialization(INITIAL_BUILTIN_DATA_ELIGIBILITY_KEY), true);
      assert.equal(runtime.workbenchDatabase.hasInitialization(INITIAL_BUILTIN_DATA_KEY), false);
      assert.equal((await runtime.personalKnowledgeFeature.queries.snapshot()).pages.length, 1);

      await initialize(knowledge);
      assert.equal(runtime.workbenchDatabase.hasInitialization(INITIAL_BUILTIN_DATA_KEY), true);
      assert.equal((await runtime.spaceFeature.queries.getTree(INITIAL_SPACE_ID))?.entries.length, 2);
      assert.equal((await runtime.spaceFeature.queries.getTree("space-learning"))?.entries.length, 4);
      assert.equal((await runtime.personalKnowledgeFeature.queries.snapshot()).pages.length, 6);
      assert.equal((await fs.readdir(path.join(directory, "runtime", "space-folders"))).length, 4);
      assert.deepEqual(await runtime.workbenchAssets.list(), []);
    } finally {
      await releasePanelRuntimeResources(runtime);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Initial Workbench data retries after a failed in-process attempt", async () => {
  let attempts = 0;
  const initializer = createInitialWorkbenchDataInitializer(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("transient initialization failure");
  });

  await assert.rejects(initializer.ensure(), /transient initialization failure/u);
  await initializer.ensure();
  await initializer.ensure();
  assert.equal(attempts, 2);
});

type ManagedFolderReferenceItem = SpaceReferenceItem & {
  readonly reference: Extract<SpaceReferenceItem["reference"], { readonly kind: "managed_folder" }>;
};

function managedFolder(items: readonly SpaceReferenceItem[], id: string): ManagedFolderReferenceItem {
  const item = items.find((candidate) => candidate.id === id);
  assert.equal(item?.reference.kind, "managed_folder");
  return item as ManagedFolderReferenceItem;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
