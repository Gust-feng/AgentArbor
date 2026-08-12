import { randomUUID } from "node:crypto";

import type { RemoteCommand, RemoteEvent } from "./protocol.js";

type ConversationIndex = Extract<RemoteEvent, { readonly kind: "conversation.index" }>;
type ConversationPage = Extract<RemoteEvent, { readonly kind: "conversation.page" }>;
type RunSnapshot = Extract<RemoteEvent, { readonly kind: "run.snapshot" }>;
const REMOTE_DELTA_BATCH_WINDOW_MS = 24;
const REMOTE_DELTA_MAX_CODE_UNITS = 64 * 1_024;
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
      readonly modelSelectionId?: string;
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
        const conversationId = command.kind === "conversation.submit"
          ? snapshots.find((snapshot): snapshot is RunSnapshot => snapshot.kind === "run.snapshot")?.conversationId
          : undefined;
        return {
          result: {
            kind: "command.result",
            eventId: idFactory(),
            commandId: command.commandId,
            status: "applied",
            ...(conversationId === undefined ? {} : { entity: { conversationId } }),
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
      let pendingDelta = "";
      let pendingSequence = 0;
      let deltaTimer: NodeJS.Timeout | undefined;

      const flushDelta = (): void => {
        if (deltaTimer !== undefined) clearTimeout(deltaTimer);
        deltaTimer = undefined;
        if (pendingDelta.length === 0) return;
        listener([{
          kind: "run.delta",
          eventId: idFactory(),
          runId,
          activitySequence: pendingSequence,
          delta: pendingDelta,
        }]);
        pendingDelta = "";
      };
      const unsubscribe = input.ports.ordinary.subscribe(runId, (activity) => {
        if (activity.kind === "text_delta") {
          if (pendingDelta.length > 0 && pendingDelta.length + activity.delta.length > REMOTE_DELTA_MAX_CODE_UNITS) {
            flushDelta();
          }
          pendingDelta += activity.delta;
          pendingSequence = activity.sequence;
          if (pendingDelta.length >= REMOTE_DELTA_MAX_CODE_UNITS) {
            flushDelta();
          } else if (deltaTimer === undefined) {
            deltaTimer = setTimeout(flushDelta, REMOTE_DELTA_BATCH_WINDOW_MS);
            deltaTimer.unref?.();
          }
          return;
        }
        flushDelta();
        chain = chain.then(async () => {
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
      return () => {
        if (deltaTimer !== undefined) clearTimeout(deltaTimer);
        deltaTimer = undefined;
        pendingDelta = "";
        unsubscribe();
      };
    },
    async snapshotsForRun(runId: string): Promise<readonly RemoteEvent[]> {
      const run = await input.ports.ordinary.runSnapshot(runId);
      return [
        await input.ports.ordinary.conversationIndex(),
        await input.ports.ordinary.conversationPage({ conversationId: run.conversationId, limit: 50 }),
        run,
      ];
    },
    async connectionSnapshot(): Promise<readonly RemoteEvent[]> {
      return [await input.ports.ordinary.conversationIndex()];
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
        ...(command.modelSelectionId === undefined ? {} : { modelSelectionId: command.modelSelectionId }),
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
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return "remote_command_failed";
}
