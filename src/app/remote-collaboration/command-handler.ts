import { randomUUID } from "node:crypto";

import type { RemoteCommand, RemoteEvent } from "./protocol.js";

type ConversationIndex = Extract<RemoteEvent, { readonly kind: "conversation.index" }>;
type ConversationPage = Extract<RemoteEvent, { readonly kind: "conversation.page" }>;
type RunSnapshot = Extract<RemoteEvent, { readonly kind: "run.snapshot" }>;
type SpaceSnapshot = Extract<RemoteEvent, { readonly kind: "space.snapshot" }>;
type NotebookSnapshot = Extract<RemoteEvent, { readonly kind: "notebook.snapshot" }>;
type AssetSnapshot = Extract<RemoteEvent, { readonly kind: "asset.snapshot" }>;
type ManagedFolderSnapshot = Extract<RemoteEvent, { readonly kind: "managed_folder.snapshot" }>;
type RemoteOrdinaryActivity =
  | { readonly kind: "text_delta"; readonly sequence: number; readonly delta: string }
  | { readonly kind: "state_changed"; readonly sequence: number };

export type RemoteCommandHandlerPorts = {
  readonly ordinary: {
    submit(input: {
      readonly submissionId: string;
      readonly conversationId?: string;
      readonly message: string;
      readonly spaceId?: string;
    }): Promise<{ readonly conversationId: string; readonly runId: string }>;
    cancel(runId: string): Promise<void>;
    decide(input: {
      readonly runId: string;
      readonly confirmationId: string;
      readonly decision: "approve_once" | "deny" | "guidance";
      readonly guidance?: string;
    }): Promise<void>;
    conversationIndex(): Promise<ConversationIndex>;
    conversationPage(input: {
      readonly conversationId: string;
      readonly beforeTurnId?: string;
      readonly limit: number;
    }): Promise<ConversationPage>;
    runSnapshot(runId: string): Promise<RunSnapshot>;
    subscribe(runId: string, listener: (activity: RemoteOrdinaryActivity) => void): () => void;
  };
  readonly spaces: {
    create(input: { readonly spaceId: string; readonly title: string }): Promise<void>;
    addReference(input: Extract<RemoteCommand, { readonly kind: "space.reference.add" }>): Promise<void>;
    snapshot(): Promise<SpaceSnapshot>;
  };
  readonly notebooks: {
    replace(input: Extract<RemoteCommand, { readonly kind: "note.replace" }>): Promise<void>;
    snapshot(): Promise<NotebookSnapshot>;
  };
  readonly assets: {
    replaceText(input: Extract<RemoteCommand, { readonly kind: "asset.replace_text" }>): Promise<void>;
    snapshot(): Promise<readonly AssetSnapshot[]>;
  };
  readonly managedFiles: {
    replaceText(input: Extract<RemoteCommand, { readonly kind: "managed_file.replace_text" }>): Promise<void>;
    createText(input: Extract<RemoteCommand, { readonly kind: "managed_file.create_text" }>): Promise<void>;
    snapshot(): Promise<readonly ManagedFolderSnapshot[]>;
  };
};

export type RemoteCommandApplication = {
  readonly result: Extract<RemoteEvent, { readonly kind: "command.result" }>;
  readonly snapshots: readonly Exclude<RemoteEvent, { readonly kind: "command.result" }>[];
  readonly watchRunId?: string;
};

export class RemoteCommandConflict extends Error {
  readonly name = "RemoteCommandConflict";
  constructor(readonly code: string, message: string) { super(message); }
}

export function createRemoteCommandHandler(input: {
  readonly ports: RemoteCommandHandlerPorts;
  readonly idFactory?: () => string;
}) {
  const idFactory = input.idFactory ?? randomUUID;

  return {
    async apply(command: RemoteCommand): Promise<RemoteCommandApplication> {
      try {
        const snapshots = await applyCommand(input.ports, command);
        const watchRunId = command.kind === "confirmation.decide"
          ? command.runId
          : command.kind === "conversation.submit"
            ? snapshots.find((snapshot): snapshot is RunSnapshot => snapshot.kind === "run.snapshot")?.runId
            : undefined;
        return {
          result: {
            kind: "command.result",
            eventId: idFactory(),
            commandId: command.commandId,
            status: "applied",
          },
          snapshots,
          ...(watchRunId === undefined ? {} : { watchRunId }),
        };
      } catch (error) {
        const conflict = error instanceof RemoteCommandConflict;
        return {
          result: {
            kind: "command.result",
            eventId: idFactory(),
            commandId: command.commandId,
            status: conflict ? "conflict" : "failed",
            error: {
              code: conflict ? error.code : errorCode(error),
              message: error instanceof Error ? error.message : "Remote command failed",
            },
          },
          snapshots: [],
        };
      }
    },
    watchRun(
      runId: string,
      listener: (events: readonly RemoteEvent[]) => void,
      onError?: (error: unknown) => void,
    ): () => void {
      let chain = Promise.resolve();
      return input.ports.ordinary.subscribe(runId, (activity) => {
        chain = chain.then(async () => {
          if (activity.kind === "text_delta") {
            listener([{
              kind: "run.delta",
              eventId: idFactory(),
              runId,
              activitySequence: activity.sequence,
              delta: activity.delta,
            }]);
            return;
          }
          const run = await input.ports.ordinary.runSnapshot(runId);
          if (!["completed", "failed", "cancelled", "blocked"].includes(run.status)) {
            listener([run]);
            return;
          }
          listener([
            run,
            await input.ports.ordinary.conversationIndex(),
            await input.ports.ordinary.conversationPage({ conversationId: run.conversationId, limit: 50 }),
          ]);
        }).catch((error: unknown) => onError?.(error));
      });
    },
    async snapshotsForRun(runId: string): Promise<readonly RemoteEvent[]> {
      const run = await input.ports.ordinary.runSnapshot(runId);
      return [
        await input.ports.ordinary.conversationIndex(),
        await input.ports.ordinary.conversationPage({ conversationId: run.conversationId, limit: 50 }),
        run,
      ];
    },
  };
}

async function applyCommand(
  ports: RemoteCommandHandlerPorts,
  command: RemoteCommand,
): Promise<readonly Exclude<RemoteEvent, { readonly kind: "command.result" }>[]> {
  switch (command.kind) {
    case "conversation.submit": {
      const submitted = await ports.ordinary.submit({
        submissionId: command.commandId,
        ...(command.conversationId === undefined ? {} : { conversationId: command.conversationId }),
        message: command.message,
        ...(command.spaceId === undefined ? {} : { spaceId: command.spaceId }),
      });
      return Promise.all([
        ports.ordinary.conversationIndex(),
        ports.ordinary.conversationPage({ conversationId: submitted.conversationId, limit: 50 }),
        ports.ordinary.runSnapshot(submitted.runId),
      ]);
    }
    case "conversation.page.request":
      return [await ports.ordinary.conversationPage({
        conversationId: command.conversationId,
        ...(command.beforeTurnId === undefined ? {} : { beforeTurnId: command.beforeTurnId }),
        limit: command.limit ?? 50,
      })];
    case "run.cancel":
      await ports.ordinary.cancel(command.runId);
      return [await ports.ordinary.runSnapshot(command.runId)];
    case "confirmation.decide":
      await ports.ordinary.decide({
        runId: command.runId,
        confirmationId: command.confirmationId,
        decision: command.decision,
        ...(command.guidance === undefined ? {} : { guidance: command.guidance }),
      });
      return [await ports.ordinary.runSnapshot(command.runId)];
    case "space.create":
      await ports.spaces.create({ spaceId: command.spaceId, title: command.title });
      return [await ports.spaces.snapshot()];
    case "space.reference.add":
      await ports.spaces.addReference(command);
      return [await ports.spaces.snapshot()];
    case "note.replace":
      await ports.notebooks.replace(command);
      return [await ports.notebooks.snapshot()];
    case "asset.replace_text":
      await ports.assets.replaceText(command);
      return ports.assets.snapshot();
    case "managed_file.replace_text":
      await ports.managedFiles.replaceText(command);
      return ports.managedFiles.snapshot();
    case "managed_file.create_text":
      await ports.managedFiles.createText(command);
      return ports.managedFiles.snapshot();
    case "sync.snapshot.request": {
      const [conversationIndex, spaces, notebooks, assets, managedFolders] = await Promise.all([
        ports.ordinary.conversationIndex(),
        ports.spaces.snapshot(),
        ports.notebooks.snapshot(),
        ports.assets.snapshot(),
        ports.managedFiles.snapshot(),
      ]);
      return [
        conversationIndex,
        spaces,
        notebooks,
        ...assets,
        ...managedFolders,
      ];
    }
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return "remote_command_failed";
}
