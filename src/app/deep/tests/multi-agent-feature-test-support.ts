import {
  createMultiAgentFeature,
  type MultiAgentFeatureOptions,
  type MultiAgentFeatureTestPorts,
} from "../multi-agent-feature.js";
import {
  type DeepConversationStore,
} from "../deep-conversation.js";
import {
  type DeepRunRecord,
  type DeepRunRecordStore,
} from "../deep-run-record-store.js";

/**
 * Test-only compatibility fixture. Production callers receive only the public
 * command/query/event facade; tests that assert durable internals use the
 * injected stores owned by this fixture.
 */
export function createMultiAgentFeatureTestFixture(options: MultiAgentFeatureOptions = {}) {
  let testPorts: MultiAgentFeatureTestPorts | undefined;
  const feature = createMultiAgentFeature({
    ...options,
    testOnlyCapturePorts: (ports) => {
      testPorts = ports;
      options.testOnlyCapturePorts?.(ports);
    },
  });
  if (testPorts === undefined) {
    throw new Error("Multi-Agent test ports were not captured.");
  }
  const { conversationStore, runRecordStore } = testPorts;

  return {
    ...feature,
    ...testPorts,
    async getConversation(conversationId: string) {
      return conversationStore.get(conversationId);
    },
    async listConversations(limit: number) {
      return conversationStore.list(limit);
    },
    async getRun(runId: string) {
      return runRecordStore.get(runId);
    },
    async listRuns(limit: number) {
      return runRecordStore.list(limit);
    },
    async listRunsForConversation(conversationId: string, limit: number) {
      return runRecordStore.listByConversation(conversationId, limit);
    },
    async createConversation(input: Parameters<typeof feature.commands.createConversation>[0]) {
      const view = await feature.commands.createConversation(input);
      return requireConversation(conversationStore, view.conversationId);
    },
    async intake(input: Parameters<typeof feature.commands.intake>[0]) {
      const result = await feature.commands.intake(input);
      return {
        ...result,
        conversation: await requireConversation(
          conversationStore,
          result.conversation.conversationId,
        ),
      };
    },
    async startRun(input: Parameters<typeof feature.commands.startRun>[0]) {
      const result = await feature.commands.startRun(input);
      return {
        ...result,
        conversation: await requireConversation(
          conversationStore,
          result.conversation.conversationId,
        ),
      };
    },
    async followUp(input: Parameters<typeof feature.commands.followUp>[0]) {
      const result = await feature.commands.followUp(input);
      return {
        ...result,
        conversation: await requireConversation(
          conversationStore,
          result.conversation.conversationId,
        ),
      };
    },
    async renameConversation(conversationId: string, title: string) {
      await feature.commands.renameConversation(conversationId, title);
      return requireConversation(conversationStore, conversationId);
    },
    async pinConversation(conversationId: string, pinned: boolean) {
      await feature.commands.pinConversation(conversationId, pinned);
      return requireConversation(conversationStore, conversationId);
    },
    deleteConversation: (conversationId: string) => feature.commands.deleteConversation(conversationId),
    async resumeChild(input: Parameters<typeof feature.commands.resumeChild>[0]) {
      await feature.commands.resumeChild(input);
      return requireRun(runRecordStore, input.runId);
    },
    async sendChildInstruction(input: Parameters<typeof feature.commands.sendChildInstruction>[0]) {
      const result = await feature.commands.sendChildInstruction(input);
      if (result.status === "rejected") {
        return result;
      }
      const { view: _view, ...metadata } = result;
      return {
        ...metadata,
        record: await requireRun(runRecordStore, input.runId),
      };
    },
    async resynthesize(input: Parameters<typeof feature.commands.resynthesize>[0]) {
      await feature.commands.resynthesize(input);
      return requireRun(runRecordStore, input.runId);
    },
    async requestRunControl(input: Parameters<typeof feature.commands.requestRunControl>[0]) {
      const result = await feature.commands.requestRunControl(input);
      return {
        status: result.status,
        record: result.view === undefined ? undefined : await requireRun(runRecordStore, input.runId),
      };
    },
  };
}

async function requireConversation(store: DeepConversationStore, conversationId: string) {
  const conversation = await store.get(conversationId);
  if (conversation === undefined) {
    throw new Error(`Expected test conversation ${conversationId} to exist.`);
  }
  return conversation;
}

async function requireRun(store: DeepRunRecordStore, runId: string): Promise<DeepRunRecord> {
  const record = await store.get(runId);
  if (record === undefined) {
    throw new Error(`Expected test run ${runId} to exist.`);
  }
  return record;
}
