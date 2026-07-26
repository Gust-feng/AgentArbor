import type { DeepConversationStore } from "./deep-conversation.js";
import {
  latestDeepRunRecordsByRoot,
  projectDeepConversation,
  projectDeepConversationSummary,
  projectDeepRunSummary,
  projectDeepRunView,
} from "./deep-read-model.js";
import {
  deepRunRuntimeHealth,
  type DeepRunRuntimeHealthView,
} from "./deep-run-health.js";
import type { DeepRunRecord, DeepRunRecordStore } from "./deep-run-record-store.js";

export type MultiAgentConversationView = Readonly<ReturnType<typeof projectDeepConversation>>;
type DeepRunSummaryProjection = ReturnType<typeof projectDeepRunSummary>;
export type MultiAgentRunSummaryView = Readonly<DeepRunSummaryProjection & {
  readonly runtimeHealth: DeepRunRuntimeHealthView;
}>;
type DeepConversationSummaryProjection = ReturnType<typeof projectDeepConversationSummary>;
export type MultiAgentConversationSummaryView = Readonly<
  Omit<DeepConversationSummaryProjection, "latestRun"> & {
    readonly latestRun?: MultiAgentRunSummaryView;
  }
>;
type DeepRunViewProjection = ReturnType<typeof projectDeepRunView>;
export type MultiAgentRunView = Readonly<
  Omit<DeepRunViewProjection, "run"> & {
    readonly run: DeepRunViewProjection["run"] & {
      readonly runtimeHealth: DeepRunRuntimeHealthView;
    };
  }
>;

export type MultiAgentConversationDetailView = {
  readonly conversation: MultiAgentConversationView;
  readonly runs: readonly MultiAgentRunSummaryView[];
};

export type MultiAgentFeatureQueries = {
  readonly getConversation: (
    conversationId: string,
  ) => Promise<MultiAgentConversationView | undefined>;
  readonly getConversationDetail: (
    conversationId: string,
    runLimit?: number,
  ) => Promise<MultiAgentConversationDetailView | undefined>;
  readonly listConversationSummaries: (
    limit: number,
  ) => Promise<readonly MultiAgentConversationSummaryView[]>;
  readonly getRunView: (runId: string) => Promise<MultiAgentRunView | undefined>;
  readonly getRunRuntimeHealth: (
    runId: string,
  ) => Promise<DeepRunRuntimeHealthView | undefined>;
  readonly listRunSummaries: (limit: number) => Promise<readonly MultiAgentRunSummaryView[]>;
  readonly listConversationRunSummaries: (
    conversationId: string,
    limit?: number,
  ) => Promise<readonly MultiAgentRunSummaryView[] | undefined>;
};

export type MultiAgentReadModelSource = {
  readonly conversations: DeepConversationStore;
  readonly runs: DeepRunRecordStore;
  readonly isRunActive: (runId: string) => boolean;
};

export async function projectMultiAgentRunView(
  input: MultiAgentReadModelSource,
  record: DeepRunRecord,
): Promise<MultiAgentRunView> {
  const conversation = await input.conversations.get(record.run.conversationId);
  const view = projectDeepRunView(record, conversation);
  return {
    ...view,
    run: {
      ...view.run,
      runtimeHealth: deepRunRuntimeHealth(input.isRunActive, record),
    },
  };
}

export function createMultiAgentFeatureQueries(
  input: MultiAgentReadModelSource,
): MultiAgentFeatureQueries {
  async function rootRecord(record: DeepRunRecord): Promise<DeepRunRecord | undefined> {
    const rootRunId = record.run.rootRunId ?? record.run.runId;
    return rootRunId === record.run.runId ? record : input.runs.get(rootRunId);
  }

  async function runSummaries(
    records: readonly DeepRunRecord[],
  ): Promise<readonly MultiAgentRunSummaryView[]> {
    const selected = latestDeepRunRecordsByRoot(records);
    const conversations = new Map(await Promise.all(
      [...new Set(selected.map((record) => record.run.conversationId))].map(async (conversationId) => [
        conversationId,
        await input.conversations.get(conversationId),
      ] as const),
    ));
    return Promise.all(selected.map(async (record) => {
      const conversation = conversations.get(record.run.conversationId);
      return {
        ...projectDeepRunSummary(
          record,
          await rootRecord(record),
          conversation?.workspaceSelection,
        ),
        runtimeHealth: deepRunRuntimeHealth(input.isRunActive, record),
      };
    }));
  }

  return {
    async getConversation(conversationId) {
      const conversation = await input.conversations.get(conversationId);
      return conversation === undefined ? undefined : projectDeepConversation(conversation);
    },

    async getConversationDetail(conversationId, runLimit = 200) {
      const conversation = await input.conversations.get(conversationId);
      if (conversation === undefined) {
        return undefined;
      }
      return {
        conversation: projectDeepConversation(conversation),
        runs: await runSummaries(await input.runs.listByConversation(conversationId, runLimit)),
      };
    },

    async listConversationSummaries(limit) {
      const [conversations, records] = await Promise.all([
        input.conversations.list(Math.max(limit, 200)),
        input.runs.list(500),
      ]);
      const latestByConversation = new Map<
        string,
        { readonly record: DeepRunRecord; readonly rootRecord?: DeepRunRecord }
      >();
      const latestRecordByConversation = new Map<string, DeepRunRecord>();
      for (const record of latestDeepRunRecordsByRoot(records)) {
        if (!latestRecordByConversation.has(record.run.conversationId)) {
          latestRecordByConversation.set(record.run.conversationId, record);
        }
      }
      const recordsWithRoots = await Promise.all(
        [...latestRecordByConversation.values()].map(async (record) => ({
          record,
          rootRecord: await rootRecord(record),
        })),
      );
      for (const { record, rootRecord: root } of recordsWithRoots) {
        latestByConversation.set(record.run.conversationId, { record, rootRecord: root });
      }
      return conversations
        .map((conversation) => {
          const latest = latestByConversation.get(conversation.conversationId);
          const summary = projectDeepConversationSummary(
            conversation,
            latest?.record,
            latest?.rootRecord,
          );
          if (latest === undefined || summary.latestRun === undefined) {
            return { ...summary, latestRun: undefined };
          }
          return {
            ...summary,
            latestRun: {
              ...summary.latestRun,
              runtimeHealth: deepRunRuntimeHealth(input.isRunActive, latest.record),
            },
          };
        })
        .sort((left, right) => {
          const pinned = summaryPinnedAt(right).localeCompare(summaryPinnedAt(left));
          return pinned === 0
            ? summaryUpdatedAt(right).localeCompare(summaryUpdatedAt(left))
            : pinned;
        })
        .slice(0, limit);
    },

    async getRunView(runId) {
      const record = await input.runs.get(runId);
      return record === undefined ? undefined : projectMultiAgentRunView(input, record);
    },

    async getRunRuntimeHealth(runId) {
      const record = await input.runs.get(runId);
      return record === undefined
        ? undefined
        : deepRunRuntimeHealth(input.isRunActive, record);
    },

    async listRunSummaries(limit) {
      return runSummaries(await input.runs.list(limit));
    },

    async listConversationRunSummaries(conversationId, limit = 200) {
      if (await input.conversations.get(conversationId) === undefined) {
        return undefined;
      }
      return runSummaries(await input.runs.listByConversation(conversationId, limit));
    },
  };
}

function summaryUpdatedAt(summary: Record<string, unknown>): string {
  return [
    typeof summary.updatedAt === "string" ? summary.updatedAt : "",
    typeof summary.titleEditedAt === "string" ? summary.titleEditedAt : "",
    typeof summary.pinnedAt === "string" ? summary.pinnedAt : "",
  ].sort((left, right) => right.localeCompare(left))[0] ?? "";
}

function summaryPinnedAt(summary: Record<string, unknown>): string {
  return typeof summary.pinnedAt === "string" ? summary.pinnedAt : "";
}
