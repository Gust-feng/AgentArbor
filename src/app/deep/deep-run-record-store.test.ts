import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  createAgentRunTree,
  type AgentSpec,
} from "../../domain/underground/agent-fabric.js";
import {
  DEEP_RUN_KIND,
  DEEP_RUN_MODE,
} from "./contracts.js";
import {
  createFileSystemDeepRunRecordStore,
  InMemoryDeepRunRecordStore,
  type DeepRunRecord,
  type DeepRunRecordStore,
} from "./deep-run-record-store.js";

const execFileAsync = promisify(execFile);

type StoreFixture = {
  readonly store: DeepRunRecordStore;
  readonly dispose: () => Promise<void>;
};

const implementations: readonly {
  readonly name: string;
  readonly create: () => Promise<StoreFixture>;
}[] = [
  {
    name: "InMemoryDeepRunRecordStore",
    create: async () => ({
      store: new InMemoryDeepRunRecordStore(),
      dispose: async () => undefined,
    }),
  },
  {
    name: "FileSystemDeepRunRecordStore",
    create: async () => {
      const runtimeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-run-store-"));
      return {
        store: createFileSystemDeepRunRecordStore(runtimeHome),
        dispose: () => fs.rm(runtimeHome, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 50,
        }),
      };
    },
  },
];

for (const implementation of implementations) {
  test(`${implementation.name} filters before limiting conversation and root-run queries`, async () => {
    const fixture = await implementation.create();
    try {
      const records = [
        deepRunRecord({
          runId: "root-run",
          conversationId: "target-conversation",
          updatedAt: timestamp(0),
        }),
        ...Array.from({ length: 51 }, (_, index) => deepRunRecord({
          runId: `follow-up-${index + 1}`,
          conversationId: "target-conversation",
          rootRunId: "root-run",
          updatedAt: timestamp(index + 1),
        })),
        deepRunRecord({
          runId: "other-root",
          conversationId: "target-conversation",
          rootRunId: "other-root",
          updatedAt: timestamp(52),
        }),
        deepRunRecord({
          runId: "foreign-newest",
          conversationId: "foreign-conversation",
          updatedAt: "2026-07-01T00:00:02.000Z",
        }),
        deepRunRecord({
          runId: "foreign-second",
          conversationId: "foreign-conversation",
          updatedAt: "2026-07-01T00:00:01.000Z",
        }),
      ];
      for (const record of records) {
        await fixture.store.upsert(record);
      }

      const recentConversationRuns = await fixture.store.listByConversation("target-conversation", 2);
      assert.deepEqual(
        recentConversationRuns.map((record) => record.run.runId),
        ["other-root", "follow-up-51"],
      );

      const allConversationRuns = await fixture.store.listByConversation("target-conversation");
      assert.equal(allConversationRuns.length, 53, "omitting limit must not apply the generic 50-record window");
      assert.equal(allConversationRuns.at(-1)?.run.runId, "root-run");
      assert.deepEqual(await fixture.store.listByConversation("target-conversation", 0), []);

      const rootChain = await fixture.store.listByRootRun("root-run");
      assert.equal(rootChain.length, 52);
      assert.equal(rootChain[0]?.run.runId, "follow-up-51");
      assert.equal(rootChain.at(-1)?.run.runId, "root-run", "legacy root records without rootRunId remain queryable");
      assert.deepEqual(
        (await fixture.store.listByRootRun("root-run", 1)).map((record) => record.run.runId),
        ["follow-up-51"],
      );
    } finally {
      await fixture.dispose();
    }
  });
}

test("FileSystemDeepRunRecordStore keeps runs created by fresh processes distinct", async () => {
  const runtimeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-run-restart-"));
  try {
    const firstRunId = await deepRunIdInFreshProcess();
    const firstStore = createFileSystemDeepRunRecordStore(runtimeHome);
    await firstStore.upsert(deepRunRecord({
      runId: firstRunId,
      conversationId: "deep-conversation-restart-test",
      updatedAt: "2026-07-14T00:00:01.000Z",
    }));

    const secondRunId = await deepRunIdInFreshProcess();
    const restartedStore = createFileSystemDeepRunRecordStore(runtimeHome);
    await restartedStore.upsert(deepRunRecord({
      runId: secondRunId,
      conversationId: "deep-conversation-restart-test",
      updatedAt: "2026-07-14T00:00:02.000Z",
    }));

    assert.notEqual(firstRunId, secondRunId);
    assert.equal((await restartedStore.list()).length, 2);
    assert.equal((await restartedStore.get(firstRunId))?.run.runId, firstRunId);
    assert.equal((await restartedStore.get(secondRunId))?.run.runId, secondRunId);
  } finally {
    await fs.rm(runtimeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function deepRunRecord(input: {
  readonly runId: string;
  readonly conversationId: string;
  readonly rootRunId?: string;
  readonly updatedAt: string;
}): DeepRunRecord {
  const rootSpec = managerSpec(input.updatedAt);
  return {
    run: {
      runId: input.runId,
      conversationId: input.conversationId,
      rootRunId: input.rootRunId,
      goal: "验证 Deep run 精确查询",
      status: "completed",
      isolation: {
        kind: "deep_conversation",
        runKind: DEEP_RUN_KIND,
        runMode: DEEP_RUN_MODE,
      },
      startedAt: input.updatedAt,
      updatedAt: input.updatedAt,
      completedAt: input.updatedAt,
    },
    agentRunTree: {
      ...createAgentRunTree({
        treeId: `tree:${input.runId}`,
        rootRunId: input.rootRunId ?? input.runId,
        rootAgentId: rootSpec.agentId,
        rootSpec,
        createdAt: input.updatedAt,
      }),
      status: "completed",
    },
    controlEvents: [],
    eventSequence: [],
    updatedAt: input.updatedAt,
  };
}

function managerSpec(createdAt: string): AgentSpec {
  return {
    specId: "deep-run-store-manager-spec",
    agentId: "deep-run-store-manager",
    displayName: "Deep Run Store Manager",
    agentKind: "manager",
    role: "测试 Deep run 查询",
    protocol: {
      inputs: [],
      outputs: [],
    },
    promptRef: "prompt:deep-run-store-manager",
    outputContractRef: "contract:deep-run-store-manager",
    permissions: {
      allowModel: true,
      allowedTools: [],
      fallback: "disabled",
    },
    budget: {
      maxModelRounds: 1,
      maxToolRounds: 0,
      maxChildRuns: 0,
      maxOutputRefs: 0,
    },
    inputRefs: [],
    createdAt,
  };
}

function timestamp(second: number): string {
  return `2026-06-01T00:00:${String(second).padStart(2, "0")}.000Z`;
}

async function deepRunIdInFreshProcess(): Promise<string> {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "dist", "kernel", "id.js")).href;
  const source = [
    `import { createId } from ${JSON.stringify(moduleUrl)};`,
    "process.stdout.write(createId('deep-run'));",
  ].join("\n");
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return stdout.trim();
}
