import type { ConversationOwner } from "../../domain/execution-scope/index.js";
import type { PersonalKnowledgeFeature } from "../personal-knowledge/index.js";
import type {
  OrdinaryAgentFeature,
  OrdinaryRunBirth,
  OrdinaryRunInput,
  SubmitOrdinaryTurnResult,
} from "../ordinary-agent/index.js";
import type { SpaceFeature } from "../spaces/index.js";
import type { WorkspaceFeature } from "../workspaces/index.js";
import {
  processCleanupHasUnresolvedStops,
  type InMemoryProcessRegistry,
  type ProcessTerminator,
} from "../runtime-guard/process-registry.js";
import { PanelHttpError } from "./http-utils.js";
import {
  newSpaceConversationDeletionRecord,
  type SpaceConversationDeletionCheckpoint,
  type SpaceConversationDeletionJournal,
  type SpaceConversationDeletionRecord,
} from "./space-conversation-deletion-journal.js";
import {
  newSpaceConversationBirthRecord,
  newSpaceConversationDeleteRecord,
  type SpaceConversationBirthPhase,
  type SpaceConversationBirthRecord,
  type SpaceConversationDeletePhase,
  type SpaceConversationDeleteRecord,
  type SpaceConversationLinkJournal,
  type SpaceConversationLinkRecord,
} from "./space-conversation-link-journal.js";

export type SpaceConversationLinkCoordinator = {
  /** Settles incomplete birth and single-delete records before request admission. */
  ready(): Promise<void>;
  /** Rejects a new turn while a durable single-conversation deletion is unresolved. */
  assertConversationAvailable(conversationId: string): void;
  submit(input: {
    readonly owner: ConversationOwner;
    readonly submissionId: string;
    readonly title: string;
    readonly runInput: OrdinaryRunInput;
    readonly birth: OrdinaryRunBirth;
  }): Promise<SubmitOrdinaryTurnResult>;
  deleteConversation(conversationId: string): Promise<void>;
};

/**
 * Host-owned coordination for the two small workflows that cross Space and
 * Ordinary persistence. The journal lets recovery finish cleanup without ever
 * replaying a model turn or a Shell command.
 */
export function createSpaceConversationLinkCoordinator(input: {
  readonly spaces: {
    readonly commands: Pick<SpaceFeature["commands"], "linkConversationOwner" | "unlinkConversationReferenceItem">;
    readonly queries: Pick<SpaceFeature["queries"], "findConversationOwner">;
  };
  readonly ordinary: {
    readonly commands: Pick<OrdinaryAgentFeature["commands"], "submitTurn" | "deleteConversation">;
    readonly queries: Pick<OrdinaryAgentFeature["queries"], "getConversation" | "getConversationOwner">;
  };
  readonly workspaces?: {
    readonly queries: Pick<WorkspaceFeature["queries"], "get">;
  };
  readonly processes: Pick<InMemoryProcessRegistry, "cleanupByConversation">;
  readonly processTerminator: ProcessTerminator;
  readonly journal: SpaceConversationLinkJournal;
  readonly runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly now?: () => string;
}): SpaceConversationLinkCoordinator {
  const now = input.now ?? (() => new Date().toISOString());
  const runExclusive = input.runExclusive ?? (async <T>(operation: () => Promise<T>) => await operation());
  const deletingConversationIds = new Set<string>();
  let tail = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  const resume = async (record: SpaceConversationLinkRecord): Promise<void> => {
    try {
      if (record.operation === "birth") {
        await resumeBirth(record);
      } else {
        await resumeDelete(record);
      }
    } catch (error) {
      try {
        await saveOperationFailure(input.journal, record, error, now());
      } catch (journalError) {
        throw new AggregateError(
          [error, journalError],
          `Space Conversation ${record.operation} ${record.operationId} failed and its journal state could not be persisted.`,
        );
      }
      throw error;
    }
  };

  const resumeBirth = async (initial: SpaceConversationBirthRecord): Promise<void> => {
    if (initial.ownerKind === "workspace") {
      const conversation = await input.ordinary.queries.getConversation(initial.conversationId);
      if (conversation !== undefined) {
        const committed = await saveBirthCheckpoint(input.journal, initial, "conversation_created", now());
        await input.journal.delete(committed.operationId);
        return;
      }
      await input.journal.delete(initial.operationId);
      return;
    }
    if (initial.referenceItemId === undefined) {
      // 新格式出生记录不写 Space 树引用；只对账 Ordinary conversation。
      const conversation = await input.ordinary.queries.getConversation(initial.conversationId);
      if (conversation !== undefined) {
        const committed = await saveBirthCheckpoint(input.journal, initial, "conversation_created", now());
        await input.journal.delete(committed.operationId);
        return;
      }
      await input.journal.delete(initial.operationId);
      return;
    }
    // 旧格式出生记录带 Space 树引用：保留回退清理。
    const [owner, conversation] = await Promise.all([
      input.spaces.queries.findConversationOwner(initial.conversationId),
      input.ordinary.queries.getConversation(initial.conversationId),
    ]);
    if (initial.spaceId === undefined) {
      throw new Error(`Space birth record ${initial.operationId} is missing Space identities.`);
    }
    if (owner !== undefined && (owner.spaceId !== initial.spaceId || owner.referenceItemId !== initial.referenceItemId)) {
      throw new Error(
        `Conversation ${initial.conversationId} has a different Space owner than birth record ${initial.operationId}.`,
      );
    }
    if (owner !== undefined && conversation !== undefined) {
      const committed = await saveBirthCheckpoint(input.journal, initial, "conversation_created", now());
      await input.journal.delete(committed.operationId);
      return;
    }
    if (owner !== undefined) {
      const linked = await saveBirthCheckpoint(input.journal, initial, "owner_linked", now());
      if (linked.referenceItemId === undefined) {
        throw new Error(`Space birth record ${linked.operationId} has no reference identity to unlink.`);
      }
      await input.spaces.commands.unlinkConversationReferenceItem(linked.referenceItemId);
      await input.journal.delete(linked.operationId);
      return;
    }
    if (conversation !== undefined) {
      assertProcessCleanupComplete(
        await input.processes.cleanupByConversation(initial.conversationId, input.processTerminator),
        `Conversation ${initial.conversationId}`,
      );
      await input.ordinary.commands.deleteConversation(initial.conversationId);
    }
    await input.journal.delete(initial.operationId);
  };

  const resumeDelete = async (initial: SpaceConversationDeleteRecord): Promise<void> => {
    let record = initial;
    if (record.phase === "prepared") {
      assertProcessCleanupComplete(
        await input.processes.cleanupByConversation(record.conversationId, input.processTerminator),
        `Conversation ${record.conversationId}`,
      );
      record = await saveDeleteCheckpoint(input.journal, record, "processes_stopped", now());
    }
    if (record.phase === "processes_stopped") {
      await input.ordinary.commands.deleteConversation(record.conversationId);
      record = await saveDeleteCheckpoint(input.journal, record, "conversation_deleted", now());
    }
    if (record.phase === "conversation_deleted") {
      await unlinkExpectedConversationOwner(input.spaces, record);
      record = await saveDeleteCheckpoint(input.journal, record, "reference_unlinked", now());
    }
    await input.journal.delete(record.operationId);
  };

  return {
    ready() {
      return serialize(async () => await runExclusive(async () => {
        const records = await input.journal.list();
        for (const record of records) {
          if (record.operation === "delete") deletingConversationIds.add(record.conversationId);
        }
        for (const record of records) {
          await resume(record);
          if (record.operation === "delete") deletingConversationIds.delete(record.conversationId);
        }
      }));
    },
    assertConversationAvailable(conversationId) {
      if (deletingConversationIds.has(conversationId)) {
        throw new PanelHttpError(409, "conversation_deletion_in_progress", `Conversation ${conversationId} is being deleted.`);
      }
    },
    submit(submission) {
      return serialize(async () => await runExclusive(async () => {
        const conversationId = `conversation:${submission.submissionId}`;
        if (deletingConversationIds.has(conversationId)) {
          throw new PanelHttpError(409, "conversation_deletion_in_progress", `Conversation ${conversationId} is being deleted.`);
        }
        const pending = await input.journal.getByConversation(conversationId);
        if (pending !== undefined) await resume(pending);

        const [existing, canonicalOwner, spaceOwner] = await Promise.all([
          input.ordinary.queries.getConversation(conversationId),
          input.ordinary.queries.getConversationOwner(conversationId),
          submission.owner.kind === "space"
            ? input.spaces.queries.findConversationOwner(conversationId)
            : Promise.resolve(undefined),
        ]);
        if (canonicalOwner !== undefined && (canonicalOwner.kind !== submission.owner.kind || canonicalOwner.id !== submission.owner.id)) {
          throw new PanelHttpError(
            409,
            "conversation_owner_conflict",
            `Conversation ${conversationId} already belongs to ${canonicalOwner.kind} ${canonicalOwner.id}.`,
          );
        }
        if (submission.owner.kind === "space" && spaceOwner !== undefined && spaceOwner.spaceId !== submission.owner.id) {
          throw new PanelHttpError(
            409,
            "conversation_owner_conflict",
            `Conversation ${conversationId} already belongs to Space ${spaceOwner.spaceId}.`,
          );
        }
        if (submission.owner.kind === "workspace" && spaceOwner !== undefined) {
          throw new PanelHttpError(
            409,
            "conversation_owner_conflict",
            `Conversation ${conversationId} already belongs to Space ${spaceOwner.spaceId}.`,
          );
        }
        if (existing !== undefined) {
          return await input.ordinary.commands.submitTurn({
            conversationId,
            owner: submission.owner,
            submissionId: submission.submissionId,
            input: submission.runInput,
            birth: submission.birth,
          });
        }
        if (submission.owner.kind === "workspace") {
          const workspace = await input.workspaces?.queries.get(submission.owner.id);
          if (workspace === undefined || workspace.status !== "available") {
            throw new PanelHttpError(404, "workspace_not_found", "所选工作区不存在或不可用。");
          }
          const record = newSpaceConversationBirthRecord({
            conversationId,
            owner: submission.owner,
            now: now(),
          });
          await input.journal.save(record);
          try {
            const submitted = await input.ordinary.commands.submitTurn({
              newConversationId: conversationId,
              owner: submission.owner,
              submissionId: submission.submissionId,
              input: submission.runInput,
              birth: submission.birth,
            });
            const committed = await saveBirthCheckpoint(input.journal, record, "conversation_created", now());
            await input.journal.delete(committed.operationId);
            return submitted;
          } catch (error) {
            try {
              const current = await input.journal.getByConversation(conversationId) ?? record;
              await input.journal.delete(current.operationId);
            } catch (recoveryError) {
              throw new AggregateError(
                [error, recoveryError],
                `Conversation ${conversationId} creation failed and its workspace birth journal could not be cleared.`,
              );
            }
            throw error;
          }
        }

        const record = newSpaceConversationBirthRecord({
          conversationId,
          owner: submission.owner,
          spaceId: submission.owner.id,
          now: now(),
        });
        await input.journal.save(record);
        try {
          const submitted = await input.ordinary.commands.submitTurn({
            newConversationId: conversationId,
            owner: submission.owner,
            submissionId: submission.submissionId,
            input: submission.runInput,
            birth: submission.birth,
          });
          const committed = await saveBirthCheckpoint(input.journal, record, "conversation_created", now());
          await input.journal.delete(committed.operationId);
          return submitted;
        } catch (error) {
          try {
            const current = await input.journal.getByConversation(conversationId) ?? record;
            await resume(current);
          } catch (recoveryError) {
            throw new AggregateError(
              [error, recoveryError],
              `Conversation ${conversationId} creation failed and could not be reconciled.`,
            );
          }
          throw error;
        }
      }));
    },
    deleteConversation(conversationId) {
      deletingConversationIds.add(conversationId);
      return serialize(async () => await runExclusive(async () => {
        try {
          const pending = await input.journal.getByConversation(conversationId);
          if (pending !== undefined) {
            await resume(pending);
            if (pending.operation === "delete") {
              deletingConversationIds.delete(conversationId);
              return;
            }
          }
          const owner = await input.spaces.queries.findConversationOwner(conversationId);
          const record = newSpaceConversationDeleteRecord({ conversationId, owner, now: now() });
          await input.journal.save(record);
          await resume(record);
          deletingConversationIds.delete(conversationId);
        } catch (error) {
          try {
            const unresolved = await input.journal.getByConversation(conversationId);
            if (unresolved?.operation !== "delete") deletingConversationIds.delete(conversationId);
          } catch (journalError) {
            throw new AggregateError(
              [error, journalError],
              `Conversation ${conversationId} deletion failed and its journal state could not be inspected.`,
            );
          }
          throw error;
        }
      }));
    },
  };
}

export type SpaceConversationDeletionCoordinator = {
  /** Reconciles durable deletions before the Host starts accepting requests. */
  ready(): Promise<void>;
  isDeleting(spaceId: string): boolean;
  assertAvailable(spaceId: string): void;
  deleteSpace(spaceId: string): Promise<void>;
};

/** Host-owned coordination for the only cross-feature Space deletion workflow. */
export function createSpaceConversationDeletionCoordinator(input: {
  readonly spaces: {
    readonly commands: Pick<SpaceFeature["commands"], "deleteSpace">;
    readonly queries: Pick<SpaceFeature["queries"], "getTree">;
  };
  readonly ordinary: {
    readonly commands: Pick<OrdinaryAgentFeature["commands"], "deleteConversation">;
    readonly queries: Pick<OrdinaryAgentFeature["queries"], "listConversationsByOwner">;
  };
  readonly personalKnowledge: {
    readonly commands: Pick<PersonalKnowledgeFeature["commands"], "cleanupSpace">;
  };
  readonly processes: Pick<InMemoryProcessRegistry, "cleanupBySpace">;
  readonly processTerminator: ProcessTerminator;
  readonly journal: SpaceConversationDeletionJournal;
  readonly runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly now?: () => string;
}): SpaceConversationDeletionCoordinator {
  const now = input.now ?? (() => new Date().toISOString());
  const runExclusive = input.runExclusive ?? (async <T>(operation: () => Promise<T>) => await operation());
  const deletingSpaceIds = new Set<string>();
  let tail = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  const resume = async (initial: SpaceConversationDeletionRecord): Promise<void> => {
    let record = initial;
    if (record.phase === "cleanup_pending") {
      await input.journal.delete(record.deletionId);
      return;
    }
    let checkpoint = record.phase === "failed" ? record.resumeFrom : record.phase;
    if (checkpoint === undefined) {
      throw new Error(`Space deletion ${record.deletionId} has no resumable checkpoint.`);
    }
    try {
      if (checkpoint === "prepared") {
        assertProcessCleanupComplete(
          await input.processes.cleanupBySpace(record.spaceId, input.processTerminator),
          `Space ${record.spaceId}`,
        );
        record = await saveCheckpoint(input.journal, record, "processes_stopped", now());
        checkpoint = "processes_stopped";
      }
      if (checkpoint === "processes_stopped") {
        for (const conversationId of record.conversationIds) {
          await input.ordinary.commands.deleteConversation(conversationId);
        }
        record = await saveCheckpoint(input.journal, record, "conversations_deleted", now());
        checkpoint = "conversations_deleted";
      }
      if (checkpoint === "conversations_deleted") {
        const tree = await input.spaces.queries.getTree(record.spaceId);
        const referenceIds = record.referenceIds === undefined || record.referenceIds.length === 0
          ? (tree?.entries.map((entry) => entry.item.id) ?? [])
          : record.referenceIds;
        await input.personalKnowledge.commands.cleanupSpace({
          spaceId: record.spaceId,
          referenceIds,
        });
        record = await saveCheckpoint(input.journal, { ...record, referenceIds }, "knowledge_cleaned", now());
        checkpoint = "knowledge_cleaned";
      }
      if (checkpoint === "knowledge_cleaned") {
        if (await input.spaces.queries.getTree(record.spaceId) !== undefined) {
          await input.spaces.commands.deleteSpace(record.spaceId);
        }
        record = await saveCheckpoint(input.journal, record, "space_deleted", now());
        checkpoint = "space_deleted";
      }
    } catch (error) {
      const failed: SpaceConversationDeletionRecord = {
        ...record,
        phase: "failed",
        resumeFrom: checkpoint,
        errorMessage: errorMessage(error),
        updatedAt: now(),
      };
      try {
        await input.journal.save(failed);
      } catch (journalError) {
        throw new AggregateError(
          [error, journalError],
          `Space deletion ${record.deletionId} failed and its failure checkpoint could not be persisted.`,
        );
      }
      throw error;
    }

    try {
      await input.journal.delete(record.deletionId);
    } catch (error) {
      await input.journal.save({
        schemaVersion: record.schemaVersion,
        deletionId: record.deletionId,
        spaceId: record.spaceId,
        conversationIds: record.conversationIds,
        ...(record.referenceIds === undefined ? {} : { referenceIds: record.referenceIds }),
        phase: "cleanup_pending",
        createdAt: record.createdAt,
        updatedAt: now(),
      });
      throw error;
    }
  };

  return {
    ready() {
      return serialize(async () => {
        const records = await input.journal.list();
        for (const record of records) deletingSpaceIds.add(record.spaceId);
        for (const record of records) {
          await resume(record);
          deletingSpaceIds.delete(record.spaceId);
        }
      });
    },
    isDeleting: (spaceId) => deletingSpaceIds.has(spaceId),
    assertAvailable(spaceId) {
      if (deletingSpaceIds.has(spaceId)) {
        throw new PanelHttpError(409, "space_deletion_in_progress", `Space ${spaceId} is being deleted.`);
      }
    },
    deleteSpace(spaceId) {
      deletingSpaceIds.add(spaceId);
      return serialize(async () => await runExclusive(async () => {
        let record = await input.journal.getBySpace(spaceId);
        if (record === undefined) {
          const tree = await input.spaces.queries.getTree(spaceId);
          if (tree === undefined) {
            deletingSpaceIds.delete(spaceId);
            throw new PanelHttpError(404, "space_not_found", `Space ${spaceId} was not found.`);
          }
          const conversations = await input.ordinary.queries.listConversationsByOwner({ kind: "space", id: spaceId });
          const conversationIds = conversations.map((conversation) => conversation.conversationId);
          record = newSpaceConversationDeletionRecord({
            spaceId,
            conversationIds,
            referenceIds: tree.entries.map((entry) => entry.item.id),
            now: now(),
          });
          await input.journal.save(record);
        }
        await resume(record);
        deletingSpaceIds.delete(spaceId);
      }));
    },
  };
}

async function unlinkExpectedConversationOwner(
  spaces: {
    readonly commands: Pick<SpaceFeature["commands"], "unlinkConversationReferenceItem">;
    readonly queries: Pick<SpaceFeature["queries"], "findConversationOwner">;
  },
  record: SpaceConversationDeleteRecord,
): Promise<void> {
  // A legacy unowned Conversation has no link to remove. More importantly, do
  // not delete a link created after this deletion started.
  if (record.referenceItemId === undefined || record.spaceId === undefined) return;
  const owner = await spaces.queries.findConversationOwner(record.conversationId);
  if (owner === undefined) return;
  if (owner.spaceId !== record.spaceId || owner.referenceItemId !== record.referenceItemId) {
    throw new Error(
      `Conversation ${record.conversationId} acquired a different Space owner while deletion ${record.operationId} was pending.`,
    );
  }
  await spaces.commands.unlinkConversationReferenceItem(record.referenceItemId);
}

async function saveBirthCheckpoint(
  journal: SpaceConversationLinkJournal,
  record: SpaceConversationBirthRecord,
  phase: SpaceConversationBirthPhase,
  updatedAt: string,
): Promise<SpaceConversationBirthRecord> {
  if (record.phase === phase && record.lastErrorMessage === undefined) return record;
  const { lastErrorMessage: _discarded, ...stable } = record;
  const next: SpaceConversationBirthRecord = { ...stable, phase, updatedAt };
  await journal.save(next);
  return next;
}

async function saveDeleteCheckpoint(
  journal: SpaceConversationLinkJournal,
  record: SpaceConversationDeleteRecord,
  phase: SpaceConversationDeletePhase,
  updatedAt: string,
): Promise<SpaceConversationDeleteRecord> {
  if (record.phase === phase && record.lastErrorMessage === undefined) return record;
  const { lastErrorMessage: _discarded, ...stable } = record;
  const next: SpaceConversationDeleteRecord = { ...stable, phase, updatedAt };
  await journal.save(next);
  return next;
}

async function saveOperationFailure(
  journal: SpaceConversationLinkJournal,
  fallback: SpaceConversationLinkRecord,
  error: unknown,
  updatedAt: string,
): Promise<void> {
  // A checkpoint may have committed immediately before the following action
  // failed. Reload before recording the error so recovery never regresses it.
  const current = await journal.getByConversation(fallback.conversationId) ?? fallback;
  await journal.save({
    ...current,
    lastErrorMessage: errorMessage(error),
    updatedAt,
  });
}

function assertProcessCleanupComplete(
  cleanup: Awaited<ReturnType<InMemoryProcessRegistry["cleanupBySpace"]>>,
  owner: string,
): void {
  if (!processCleanupHasUnresolvedStops(cleanup)) return;
  const processIds = [
    ...cleanup.attempted
      .filter((attempt) => attempt.outcome === "unknown" || attempt.outcome === "error")
      .map((attempt) => attempt.processId),
    ...cleanup.skipped
      .filter((skip) => skip.reason !== "inactive_status")
      .map((skip) => skip.processId),
  ];
  throw new PanelHttpError(
    409,
    "background_process_stop_pending",
    `${owner} still has managed processes that could not be confirmed stopped: ${processIds.join(", ")}.`,
  );
}

function boundedTitle(value: string): string {
  const title = value.trim();
  return title.length <= 160 ? title : `${title.slice(0, 157)}...`;
}

async function saveCheckpoint(
  journal: SpaceConversationDeletionJournal,
  record: SpaceConversationDeletionRecord,
  phase: SpaceConversationDeletionCheckpoint,
  updatedAt: string,
): Promise<SpaceConversationDeletionRecord> {
  const next: SpaceConversationDeletionRecord = {
    schemaVersion: record.schemaVersion,
    deletionId: record.deletionId,
    spaceId: record.spaceId,
    conversationIds: record.conversationIds,
    ...(record.referenceIds === undefined ? {} : { referenceIds: record.referenceIds }),
    phase,
    createdAt: record.createdAt,
    updatedAt,
  };
  await journal.save(next);
  return next;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
