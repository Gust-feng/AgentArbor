import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import type { AgentNotesFeature } from "../agent-notes/index.js";
import type { OrdinaryAgentFeature, OrdinaryConversationReadModel, OrdinaryRunState } from "../ordinary-agent/index.js";
import type { SpaceFeature, SpaceReferenceItem } from "../spaces/index.js";
import {
  RemoteCommandConflict,
  type RemoteCommand,
  type RemoteCommandHandlerPorts,
  type RemoteDesktopStore,
  type RemoteEvent,
} from "../remote-collaboration/index.js";
import {
  editableWorkbenchAssetText,
  workbenchAssetTextFingerprint,
  type WorkbenchAssetRepository,
} from "../workbench-assets/index.js";
import type { LocalWorkspaceMutationCoordinator } from "../tool-center/adapters/local-workspace-mutation-coordinator.js";
import type { OrdinaryRunBirth } from "../ordinary-agent/contracts.js";
import { PanelHttpError } from "./http-utils.js";
import { resolveConversationSpaceAccess } from "./space-agent-access.js";
import { createManagedSpaceFolder, deleteManagedSpaceFolder } from "./space-managed-folder-store.js";
import { createPanelSpaceReferenceEntry, updatePanelSpaceReferenceText } from "./space-reference-mutations.js";
import { createPanelDocumentPreview } from "./space-reference-preview.js";
import { listDirectory, readFileText } from "../local-filesystem/index.js";

type ConversationIndex = Extract<RemoteEvent, { readonly kind: "conversation.index" }>;
type ConversationPage = Extract<RemoteEvent, { readonly kind: "conversation.page" }>;
type RunSnapshot = Extract<RemoteEvent, { readonly kind: "run.snapshot" }>;

export function createPanelRemoteCollaborationPorts(input: {
  readonly ordinary: OrdinaryAgentFeature;
  readonly spaces: SpaceFeature;
  readonly notes: AgentNotesFeature;
  readonly assets: WorkbenchAssetRepository;
  readonly store: RemoteDesktopStore;
  readonly managedSpaceFolderRoot: string;
  readonly fileMutationCoordinator: LocalWorkspaceMutationCoordinator;
  readonly prepareOrdinaryRunBirth: (input: {
    readonly goal: string;
    readonly taskSoilInput?: import("../task-soil/task-soil-workspace.js").DesktopTaskSoilInput;
  }) => Promise<OrdinaryRunBirth>;
  readonly defaultWorkspaceRoot: () => Promise<string>;
  readonly now?: () => string;
  readonly idFactory?: () => string;
}): RemoteCommandHandlerPorts {
  const now = input.now ?? (() => new Date().toISOString());
  const idFactory = input.idFactory ?? randomUUID;

  async function conversationIndex(): Promise<ConversationIndex> {
    const conversations = await input.ordinary.queries.listConversations(5_000);
    return {
      kind: "conversation.index",
      eventId: idFactory(),
      conversations: await Promise.all(conversations.map(async (conversation) => {
        const activeRun = conversation.activeRunId === undefined
          ? undefined
          : await input.ordinary.queries.getRun(conversation.activeRunId);
        const latestTurn = conversation.turns.at(-1);
        return {
          conversationId: conversation.conversationId,
          title: conversation.title,
          updatedAt: conversation.updatedAt,
          status: activeRun?.status.kind ?? (latestTurn?.status === "pending" ? "queued" : latestTurn?.status) ?? "idle",
          ...(conversation.activeRunId === undefined ? {} : { activeRunId: conversation.activeRunId }),
        };
      })),
    };
  }

  async function conversationPage(page: {
    readonly conversationId: string;
    readonly beforeTurnId?: string;
    readonly limit: number;
  }): Promise<ConversationPage> {
    const conversation = await input.ordinary.queries.getConversation(page.conversationId);
    if (conversation === undefined) throw new Error(`Conversation ${page.conversationId} was not found`);
    return projectConversationPage(conversation, page, idFactory());
  }

  async function runSnapshot(runId: string): Promise<RunSnapshot> {
    const run = await input.ordinary.queries.getRun(runId);
    if (run === undefined) throw new Error(`Run ${runId} was not found`);
    return projectRun(run, idFactory());
  }

  async function ensureNotebookMappings(): Promise<void> {
    if (input.store.getNotebook("global") === undefined) {
      input.store.upsertNotebook({ notebookId: "global", scope: { kind: "global" }, label: "全局笔记" }, now());
    }
    const workspaceRoot = await input.defaultWorkspaceRoot();
    const existing = input.store.listNotebooks().find((mapping) =>
      mapping.scope.kind === "workspace" && mapping.scope.workspaceRoot === workspaceRoot);
    if (existing === undefined) {
      const workspaceCount = input.store.listNotebooks().filter((mapping) => mapping.scope.kind === "workspace").length;
      input.store.upsertNotebook({
        notebookId: idFactory(),
        scope: { kind: "workspace", workspaceRoot },
        label: `工作区笔记 ${workspaceCount + 1}`,
      }, now());
    }
  }

  return {
    ordinary: {
      async submit(command) {
        let taskSoilInput;
        if (command.conversationId !== undefined) {
          const access = await resolveConversationSpaceAccess(input.spaces, command.conversationId, undefined);
          if (command.spaceId !== undefined && access.spaceId !== undefined && access.spaceId !== command.spaceId) {
            throw new RemoteCommandConflict("conversation_space_conflict", "The conversation belongs to another Space");
          }
          taskSoilInput = access.taskSoilInput;
        } else if (command.spaceId !== undefined && await input.spaces.queries.getTree(command.spaceId) === undefined) {
          throw new RemoteCommandConflict("space_not_found", "The selected Space no longer exists");
        }
        const submitted = await input.ordinary.commands.submitTurn({
          submissionId: command.submissionId,
          ...(command.conversationId === undefined ? {} : { conversationId: command.conversationId }),
          input: { userMessage: command.message, ...(taskSoilInput === undefined ? {} : { taskSoil: taskSoilInput }) },
          birth: await input.prepareOrdinaryRunBirth({
            goal: command.message,
            ...(taskSoilInput === undefined ? {} : { taskSoilInput }),
          }),
        });
        if (command.spaceId !== undefined && command.conversationId === undefined) {
          const owner = await input.spaces.queries.findConversationOwner(submitted.conversation.conversationId);
          if (owner === undefined) {
            await input.spaces.commands.addReference({
              id: `remote-conversation:${command.submissionId}`,
              spaceId: command.spaceId,
              title: submitted.conversation.title,
              reference: {
                kind: "conversation",
                conversationId: submitted.conversation.conversationId,
                conversationTitle: submitted.conversation.title,
              },
            });
          } else if (owner.spaceId !== command.spaceId) {
            throw new RemoteCommandConflict("conversation_space_conflict", "The new conversation was linked to another Space");
          }
        }
        return { conversationId: submitted.conversation.conversationId, runId: submitted.run.runId };
      },
      async cancel(runId) {
        await input.ordinary.commands.cancel(runId, "cancelled_by_user");
      },
      async decide(decision) {
        const run = await input.ordinary.queries.getRun(decision.runId);
        if (run === undefined) throw new Error(`Run ${decision.runId} was not found`);
        const alreadyApplied = run.timeline.some((event) =>
          event.type === "run.approval_decided"
          && event.decision.confirmationId === decision.confirmationId
          && event.decision.decision === decision.decision
          && event.decision.guidance === decision.guidance);
        if (alreadyApplied) return;
        await input.ordinary.commands.decideApproval({
          ownerRunId: decision.runId,
          confirmationId: decision.confirmationId,
          decision: decision.decision,
          ...(decision.guidance === undefined ? {} : { guidance: decision.guidance }),
          decidedAt: now(),
        });
      },
      conversationIndex,
      conversationPage,
      runSnapshot,
      subscribe(runId, listener) {
        return input.ordinary.events.subscribe(runId, (activity) => {
          if (activity.type === "model.output.delta") {
            listener({ kind: "text_delta", sequence: activity.sequence, delta: activity.delta });
            return;
          }
          listener({ kind: "state_changed", sequence: activity.sequence });
        });
      },
    },
    spaces: {
      async create({ spaceId, title }) {
        const existing = await input.spaces.queries.getTree(spaceId);
        if (existing !== undefined) {
          if (existing.space.title !== title) {
            throw new RemoteCommandConflict("space_id_conflict", "The Space id already exists with another title");
          }
          return;
        }
        await input.spaces.commands.createSpace({ id: spaceId, title });
      },
      async addReference(command) {
        const existing = await input.spaces.queries.getReference(command.referenceId);
        if (existing !== undefined) {
          if (!sameRemoteReference(existing, command)) {
            throw new RemoteCommandConflict("space_reference_conflict", "The reference id already exists with different content");
          }
          return;
        }
        if (command.reference.kind !== "managed_folder") {
          await input.spaces.commands.addReference({
            id: command.referenceId,
            spaceId: command.spaceId,
            title: command.title,
            ...(command.parentId === undefined ? {} : { parentId: command.parentId }),
            reference: command.reference,
          });
          return;
        }
        await input.fileMutationCoordinator.run(input.managedSpaceFolderRoot, async () => {
          const folder = await createManagedSpaceFolder(input.managedSpaceFolderRoot, command.referenceId);
          try {
            await input.spaces.commands.addReference({
              id: command.referenceId,
              spaceId: command.spaceId,
              title: command.title,
              ...(command.parentId === undefined ? {} : { parentId: command.parentId }),
              reference: { kind: "managed_folder", path: folder },
            });
          } catch (error) {
            await deleteManagedSpaceFolder(input.managedSpaceFolderRoot, folder).catch(() => undefined);
            throw error;
          }
        });
      },
      async snapshot() {
        const spaces = await input.spaces.queries.list();
        return {
          kind: "space.snapshot",
          eventId: idFactory(),
          spaces: await Promise.all(spaces.map(async (summary) => {
            const tree = await input.spaces.queries.getTree(summary.id);
            if (tree === undefined) throw new Error(`Space ${summary.id} disappeared during snapshot`);
            return {
              id: tree.space.id,
              title: tree.space.title,
              createdAt: tree.space.createdAt,
              updatedAt: tree.space.updatedAt,
              references: tree.entries.flatMap(({ item }) => {
                const reference = projectRemoteReference(item);
                return reference === undefined ? [] : [{
                  id: item.id,
                  title: item.title,
                  ...(item.parentId === undefined ? {} : { parentId: item.parentId }),
                  reference,
                  createdAt: item.createdAt,
                  updatedAt: item.updatedAt,
                }];
              }),
            };
          })),
        };
      },
    },
    notebooks: {
      async replace(command) {
        await ensureNotebookMappings();
        const mapping = input.store.getNotebook(command.notebookId);
        if (mapping === undefined) throw new RemoteCommandConflict("notebook_not_found", "The notebook is not shared with this device");
        const current = await input.notes.queries.get(mapping.scope);
        const version = noteVersion(current.content);
        if (version !== command.expectedVersion) {
          if (current.content === command.content) return;
          throw new RemoteCommandConflict("note_version_conflict", "The notebook changed on desktop");
        }
        await input.notes.commands.write(mapping.scope, command.content);
      },
      async snapshot() {
        await ensureNotebookMappings();
        const notebooks = await Promise.all(input.store.listNotebooks().map(async (mapping) => {
          const notebook = await input.notes.queries.get(mapping.scope);
          return {
            notebookId: mapping.notebookId,
            label: mapping.label,
            scope: mapping.scope.kind,
            content: notebook.content,
            version: noteVersion(notebook.content),
            ...(notebook.updatedAt === undefined ? {} : { updatedAt: notebook.updatedAt }),
          };
        }));
        return { kind: "notebook.snapshot", eventId: idFactory(), notebooks };
      },
    },
    assets: {
      async replaceText(command) {
        const result = await input.assets.updateText({
          id: command.assetId,
          expectedFingerprint: command.expectedFingerprint,
          text: command.text,
        });
        if (result.status === "updated") return;
        if (result.status === "conflict") {
          const current = await input.assets.get(command.assetId);
          if (current !== undefined && editableWorkbenchAssetText(current)?.text === command.text) return;
          throw new RemoteCommandConflict("workbench_asset_revision_conflict", "The asset changed on desktop");
        }
        if (result.status === "not_found") throw new Error(`Workbench asset ${command.assetId} was not found`);
        if (result.status === "not_editable") throw new Error(`Workbench asset ${command.assetId} is not editable`);
        throw new Error(`Workbench asset ${command.assetId} is too large`);
      },
      async snapshot() {
        const assets = (await input.assets.list()).flatMap((asset) => {
          const editable = editableWorkbenchAssetText(asset);
          return editable === undefined ? [] : [{
            assetId: asset.id,
            title: asset.title,
            kind: asset.kind as "markdown" | "code",
            text: editable.text,
            language: editable.language,
            fingerprint: workbenchAssetTextFingerprint(editable.text),
          }];
        });
        const snapshotId = idFactory();
        const pages = assets.length === 0 ? [[]] : assets.map((asset) => [asset]);
        return pages.map((page, pageIndex) => ({
          kind: "asset.snapshot" as const,
          eventId: idFactory(),
          snapshotId,
          pageIndex,
          pageCount: pages.length,
          assets: page,
        }));
      },
    },
    managedFiles: {
      async replaceText(command) {
        const item = await input.spaces.queries.getReference(command.referenceId);
        if (item?.reference.kind !== "managed_folder") {
          throw new RemoteCommandConflict("managed_folder_not_found", "The managed folder is not available");
        }
        await input.fileMutationCoordinator.run(item.reference.path, async () => {
          try {
            await updatePanelSpaceReferenceText(item, {
              relativePath: command.relativePath,
              expectedFingerprint: command.expectedFingerprint,
              text: command.text,
            });
          } catch (error) {
            if (error instanceof PanelHttpError && error.code === "space_reference_revision_conflict") {
              const preview = await createPanelDocumentPreview(item, command.relativePath);
              if (preview.content.kind === "text" && preview.content.text === command.text) return;
              throw new RemoteCommandConflict("managed_file_revision_conflict", "The managed file changed on desktop");
            }
            throw error;
          }
        });
      },
      async createText(command) {
        const item = await input.spaces.queries.getReference(command.referenceId);
        if (item?.reference.kind !== "managed_folder") {
          throw new RemoteCommandConflict("managed_folder_not_found", "The managed folder is not available");
        }
        await input.fileMutationCoordinator.run(item.reference.path, async () => {
          const existing = await createPanelDocumentPreview(item, command.relativePath).catch((error: unknown) => {
            if (error instanceof PanelHttpError && error.statusCode === 404) return undefined;
            throw error;
          });
          if (existing !== undefined) {
            if (existing.content.kind === "text" && existing.content.text === command.text) return;
            throw new RemoteCommandConflict("managed_file_exists", "A different file already exists at this path");
          }
          const parent = path.posix.dirname(command.relativePath);
          const created = await createPanelSpaceReferenceEntry(item, {
            parentRelativePath: parent === "." ? "" : parent,
            name: path.posix.basename(command.relativePath),
            kind: "file",
          });
          const preview = await createPanelDocumentPreview(item, created.relativePath);
          if (preview.fingerprint === undefined) throw new Error("The new managed file is not editable text");
          await updatePanelSpaceReferenceText(item, {
            relativePath: created.relativePath,
            expectedFingerprint: preview.fingerprint,
            text: command.text,
          });
        });
      },
      async snapshot() {
        const folders: Array<{
          referenceId: string;
          spaceId: string;
          title: string;
          files: Array<{ relativePath: string; text: string; fingerprint: string }>;
        }> = [];
        for (const space of await input.spaces.queries.list()) {
          const tree = await input.spaces.queries.getTree(space.id);
          if (tree === undefined) continue;
          for (const { item } of tree.entries) {
            if (item.reference.kind !== "managed_folder") continue;
            folders.push({
              referenceId: item.id,
              spaceId: item.spaceId,
              title: item.title,
              files: await readManagedFolderFiles(item.reference.path),
            });
          }
        }
        const snapshotId = idFactory();
        const pages = folders.flatMap((folder) => folder.files.length === 0
          ? [{ ...folder, files: [] }]
          : folder.files.map((file) => ({ ...folder, files: [file] })));
        const normalizedPages = pages.length === 0 ? [] : pages;
        if (normalizedPages.length === 0) {
          return [{
            kind: "managed_folder.snapshot" as const,
            eventId: idFactory(),
            snapshotId,
            pageIndex: 0,
            pageCount: 1,
            folders: [],
          }];
        }
        return normalizedPages.map((folder, pageIndex) => ({
          kind: "managed_folder.snapshot" as const,
          eventId: idFactory(),
          snapshotId,
          pageIndex,
          pageCount: normalizedPages.length,
          folders: [folder],
        }));
      },
    },
  };
}

async function readManagedFolderFiles(root: string): Promise<Array<{
  relativePath: string;
  text: string;
  fingerprint: string;
}>> {
  const files: Array<{ relativePath: string; text: string; fingerprint: string }> = [];
  const directories = [""];
  while (directories.length > 0 && files.length < 1_000) {
    const relativeDirectory = directories.shift()!;
    const absoluteDirectory = relativeDirectory.length === 0
      ? root
      : path.join(root, ...relativeDirectory.split("/"));
    const listing = await listDirectory(absoluteDirectory);
    if (!listing.ok) continue;
    for (const entry of listing.value.entries) {
      const relativePath = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (entry.kind === "directory") {
        directories.push(relativePath);
        continue;
      }
      if (entry.kind !== "file" || files.length >= 1_000) continue;
      const preview = await readFileText(path.join(root, ...relativePath.split("/")));
      if (!preview.ok || preview.value.truncated || preview.value.encoding !== "UTF-8") continue;
      files.push({ relativePath, text: preview.value.text, fingerprint: preview.value.fingerprint });
    }
  }
  return files;
}

function projectConversationPage(
  conversation: OrdinaryConversationReadModel,
  page: { readonly beforeTurnId?: string; readonly limit: number },
  eventId: string,
): ConversationPage {
  const requestedEnd = page.beforeTurnId === undefined
    ? conversation.turns.length
    : conversation.turns.findIndex((turn) => turn.turnId === page.beforeTurnId);
  if (requestedEnd < 0) throw new RemoteCommandConflict("conversation_cursor_invalid", "The conversation page cursor is no longer available");
  const start = Math.max(0, requestedEnd - page.limit);
  const turns = conversation.turns.slice(start, requestedEnd);
  return {
    kind: "conversation.page",
    eventId,
    conversationId: conversation.conversationId,
    ...(page.beforeTurnId === undefined ? {} : { beforeTurnId: page.beforeTurnId }),
    turns: turns.map((turn) => ({
      turnId: turn.turnId,
      runId: turn.runId,
      role: turn.role,
      content: turn.content,
      status: turn.status,
      createdAt: turn.createdAt,
      updatedAt: turn.updatedAt,
    })),
    hasMore: start > 0,
    ...(start > 0 && turns[0] !== undefined ? { nextBeforeTurnId: turns[0].turnId } : {}),
  };
}

function projectRun(run: OrdinaryRunState, eventId: string): RunSnapshot {
  return {
    kind: "run.snapshot",
    eventId,
    runId: run.runId,
    conversationId: run.turn.conversationId,
    status: run.status.kind,
    ...(run.visibleAssistantText === undefined ? {} : { visibleAssistantText: run.visibleAssistantText }),
    pendingConfirmations: run.status.kind !== "awaiting_approval" ? [] : run.status.confirmationRequests.map((request) => ({
      confirmationId: request.confirmationId,
      title: request.title,
      actionSummary: request.actionSummary,
      ...(request.consequence === undefined ? {} : { consequence: request.consequence }),
      affectedResources: [...request.affectedResources],
      riskLevel: request.riskLevel,
      ...(request.resumeAvailability === undefined ? {} : { resumeAvailability: request.resumeAvailability }),
      requestedAt: request.requestedAt,
      ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
    })),
    updatedAt: run.timestamps.updatedAt,
  };
}

function noteVersion(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function projectRemoteReference(item: SpaceReferenceItem) {
  switch (item.reference.kind) {
    case "asset_folder": return { kind: "asset_folder" as const };
    case "workbench_asset": return { kind: "workbench_asset" as const, assetId: item.reference.assetId };
    case "managed_folder": return { kind: "managed_folder" as const };
    default: return undefined;
  }
}

function sameRemoteReference(
  item: SpaceReferenceItem,
  command: Extract<RemoteCommand, { readonly kind: "space.reference.add" }>,
): boolean {
  const projected = projectRemoteReference(item);
  return item.spaceId === command.spaceId
    && item.title === command.title
    && item.parentId === command.parentId
    && JSON.stringify(projected) === JSON.stringify(command.reference);
}
