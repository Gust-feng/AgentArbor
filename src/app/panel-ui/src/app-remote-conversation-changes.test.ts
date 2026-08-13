import { expect, test } from "vitest";

import { handleRemoteConversationChange, type RemoteConversationChangeDeps } from "./app-remote-conversation-changes";
import type { WorkbenchProjectionChange } from "../../panel-api-contracts";
import type { ConversationSummary } from "./contracts/conversation";
import type { LiveRunSubscription } from "./app-live-run-updates";

function createDeps(input: {
  readonly conversations: readonly ConversationSummary[];
  readonly openConversationId?: string;
  readonly observedRunId?: string;
}) {
  const applied: (readonly ConversationSummary[])[] = [];
  const started: LiveRunSubscription[] = [];
  let fetches = 0;
  const deps: RemoteConversationChangeDeps = {
    fetchConversations: async () => {
      fetches += 1;
      return input.conversations;
    },
    applyConversations: (conversations) => { applied.push(conversations); },
    openConversationId: () => input.openConversationId,
    observedRunId: () => input.observedRunId,
    currentEpoch: () => 7,
    startLiveUpdates: (subscription) => { started.push(subscription); },
  };
  return { deps, applied, started, fetches: () => fetches };
}

function change(partial: Partial<WorkbenchProjectionChange>): WorkbenchProjectionChange {
  return { revision: 1, reset: false, owners: ["conversations"], ...partial };
}

test("忽略与会话无关的投影变更", async () => {
  const { deps, fetches } = createDeps({ conversations: [] });
  await handleRemoteConversationChange(change({ owners: ["spaces"] }), deps);
  expect(fetches()).toBe(0);
});

test("刷新列表并为打开会话的新 run 接上直播", async () => {
  const { deps, applied, started } = createDeps({
    conversations: [{ conversationId: "conversation-1", title: "远程", activeRunId: "run-2" }],
    openConversationId: "conversation-1",
    observedRunId: "run-1",
  });
  await handleRemoteConversationChange(change({ conversationIds: ["conversation-1"] }), deps);
  expect(applied).toHaveLength(1);
  expect(started).toEqual([{ runId: "run-2", conversationId: "conversation-1", epoch: 7 }]);
});

test("变更未命中打开的会话时只刷新列表", async () => {
  const { deps, applied, started } = createDeps({
    conversations: [{ conversationId: "conversation-2", title: "其他", activeRunId: "run-9" }],
    openConversationId: "conversation-1",
  });
  await handleRemoteConversationChange(change({ conversationIds: ["conversation-2"] }), deps);
  expect(applied).toHaveLength(1);
  expect(started).toHaveLength(0);
});

test("已在观察同一 run 时不重复订阅", async () => {
  const { deps, started } = createDeps({
    conversations: [{ conversationId: "conversation-1", title: "远程", activeRunId: "run-2" }],
    openConversationId: "conversation-1",
    observedRunId: "run-2",
  });
  await handleRemoteConversationChange(change({ conversationIds: ["conversation-1"] }), deps);
  expect(started).toHaveLength(0);
});

test("没有打开的会话时仅同步列表", async () => {
  const { deps, applied, started } = createDeps({
    conversations: [{ conversationId: "conversation-3", title: "新会话" }],
  });
  await handleRemoteConversationChange(change({}), deps);
  expect(applied).toHaveLength(1);
  expect(started).toHaveLength(0);
});
