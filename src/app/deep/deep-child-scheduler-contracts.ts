/**
 * Public contracts for deep child scheduling.
 *
 * Scheduling clients can depend on these stable inputs, terminal materials,
 * and callback boundaries without importing the scheduler implementation.
 */
import type { ChildAgentRun, ChildAgentRunParentReview } from "../../domain/underground/agent-fabric.js";
import type {
  DeepChildSpec,
  DeepChildSummary,
  DeepChildTask,
  DeepTaskBoardSnapshot,
} from "./contracts.js";
import type { ExploreDeepChildResult } from "./child-delegation.js";
import type { DeepTaskBoard } from "./deep-task-board.js";

export type ExploreDeepChildFactory = (
  childRun: ChildAgentRun,
  childSpec: DeepChildSpec,
) => Promise<ExploreDeepChildResult>;

export type DeepChildQueuedInstructionSource = "manager" | "control_api";

export type ContinueDeepChildFactory = (
  childRun: ChildAgentRun,
  childSpec: DeepChildSpec,
  parentInstruction: string,
  previousSummary: DeepChildSummary | undefined,
  parentOperation: {
    readonly instructionId: string;
    readonly messageRef: string;
    readonly source: DeepChildQueuedInstructionSource;
    readonly review?: ChildAgentRunParentReview;
  },
) => Promise<ExploreDeepChildResult>;

export type DeepChildInstructionQueueResult =
  | {
      readonly status: "queued";
      readonly instructionId: string;
      readonly messageRef: string;
      readonly childRunId: string;
      readonly childStatus: DeepChildTask["status"];
      readonly queuedCount: number;
      readonly queuedAt: string;
    }
  | {
      readonly status: "child_not_found" | "not_accepting";
      readonly childRunId: string;
      readonly childStatus?: DeepChildTask["status"];
      readonly reason: string;
    };

export type DeepChildInstructionContinueResult =
  | {
      readonly status: "continued";
      readonly childRunId: string;
      readonly childStatus: DeepChildTask["status"];
      readonly material: DeepChildTerminalMaterial;
    }
  | {
      readonly status: "child_not_found" | "not_accepting";
      readonly childRunId: string;
      readonly childStatus?: DeepChildTask["status"];
      readonly reason: string;
    };

export type DeepChildInstructionQueueHandle = {
  readonly queueChildInstruction: (input: {
    readonly childRunId: string;
    readonly instruction: string;
    readonly source?: DeepChildQueuedInstructionSource;
    readonly review?: ChildAgentRunParentReview;
  }) => DeepChildInstructionQueueResult;
  readonly continueChildInstruction: (input: {
    readonly childRunId: string;
    readonly instruction: string;
    readonly source?: DeepChildQueuedInstructionSource;
    readonly review?: ChildAgentRunParentReview;
  }) => Promise<DeepChildInstructionContinueResult>;
  readonly snapshot: () => DeepTaskBoardSnapshot;
};

export type DeepChildExecutedQueuedInstruction = {
  readonly instructionId: string;
  readonly messageRef: string;
  readonly childRunId: string;
  readonly instruction: string;
  readonly source: DeepChildQueuedInstructionSource;
  readonly review?: ChildAgentRunParentReview;
  readonly queuedAt: string;
  readonly executedAt: string;
};

export type DeepChildQueuedInstructionProjection = {
  readonly instructionId: string;
  readonly messageRef: string;
  readonly childRunId: string;
  readonly source: DeepChildQueuedInstructionSource;
  readonly queuedAt: string;
  readonly queuedCount: number;
};

export type DeepChildInstructionRecord = {
  readonly instructionId: string;
  readonly messageRef: string;
  readonly childRunId: string;
  readonly source: DeepChildQueuedInstructionSource;
  readonly status: "queued" | "executed" | "cancelled";
  readonly instruction: string;
  readonly review?: ChildAgentRunParentReview;
  readonly requestedAt: string;
  readonly queuedAt?: string;
  readonly executedAt?: string;
  readonly cancelledAt?: string;
};

export type DeepChildTerminalMaterial = {
  readonly task: DeepChildTask;
  readonly summary: DeepChildSummary;
  readonly completedRun: ChildAgentRun;
  readonly pendingContinuation?: ExploreDeepChildResult["pendingContinuation"];
  readonly executedQueuedInstructions?: readonly DeepChildExecutedQueuedInstruction[];
};

export type DeepChildSchedulerCallbacks = {
  readonly onChildStarted?: (
    task: DeepChildTask,
    childRun: ChildAgentRun,
    stepIndex: number,
  ) => void | Promise<void>;
  readonly onChildTerminal?: (
    task: DeepChildTask,
    summary: DeepChildSummary,
    completedRun: ChildAgentRun,
    material: DeepChildTerminalMaterial,
    stepIndex: number,
  ) => void | Promise<void>;
  readonly onChildInstructionQueued?: (
    task: DeepChildTask,
    queued: DeepChildQueuedInstructionProjection,
    stepIndex: number,
  ) => void | Promise<void>;
  /** Internal persistence hook. Raw instruction content is not an event projection. */
  readonly onChildInstructionRecorded?: (
    instruction: DeepChildInstructionRecord,
    stepIndex: number,
  ) => void | Promise<void>;
};

export type DeepChildEnqueueResult = {
  readonly addedCount: number;
  readonly overflowCount: number;
  readonly depthGuardPassed: boolean;
  readonly tasks: readonly DeepChildTask[];
};

export type DeepChildCancelResult = {
  readonly cancelledCount: number;
};

export type DeepChildSchedulerConfig = {
  readonly board: DeepTaskBoard;
  readonly exploreFactory: ExploreDeepChildFactory;
  readonly continueFactory?: ContinueDeepChildFactory;
  readonly maxConcurrency?: number;
  readonly maxChildren?: number;
  readonly callbacks?: DeepChildSchedulerCallbacks;
};
