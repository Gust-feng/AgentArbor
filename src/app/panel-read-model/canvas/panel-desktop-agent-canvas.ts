import type { DesktopAgentSessionResult } from "../../desktop-agent/desktop-agent-session-contracts.js";
import { latestModelFailureTextForUser } from "../run/panel-model-failure-copy.js";
import { safeText, taskSoilCanvas, type PanelTaskSoilCanvasReadModel } from "./panel-canvas-common.js";
import {
  friendlyUserFacingFailureText,
  sanitizeAssistantVisibleText,
} from "../../text-projection/visible-text-safety.js";

export type DesktopAgentCanvasReadModel = {
  readonly kind: "desktop_agent_canvas";
  readonly taskSoil: PanelTaskSoilCanvasReadModel;
  readonly agent: {
    readonly status: DesktopAgentSessionResult["status"];
    readonly answer?: {
      readonly answer: string;
      readonly modelCallRefs: readonly string[];
      readonly toolCallRefs: readonly string[];
      readonly evidenceRefs: readonly string[];
      readonly resultBlocks: readonly {
        readonly blockId: string;
        readonly kind: string;
        readonly title: string;
        readonly summary: string;
        readonly evidenceRefs: readonly string[];
        readonly toolCallRefs: readonly string[];
      }[];
    };
    readonly pendingConfirmation?: {
      readonly confirmationId: string;
      readonly title: string;
      readonly question: string;
      readonly consequence: string;
      readonly affectedResources?: readonly string[];
      readonly riskLevel: string;
      readonly resumeAvailability?: "live" | "lost_after_restart";
      readonly requestedAt?: string;
      readonly expiresAt?: string;
      readonly modelCallRefs: readonly string[];
      readonly toolCallRefs: readonly string[];
      readonly sourceRefs: readonly string[];
    };
    readonly failureMessage?: string;
    readonly modelCallRefs: readonly string[];
    readonly toolCallRefs: readonly string[];
    readonly activity: readonly {
      readonly activityId: string;
      readonly type: string;
      readonly title: string;
      readonly summary: string;
      readonly status: string;
      readonly createdAt: string;
      readonly action?: string;
      readonly path?: string;
      readonly truncated?: boolean;
      readonly error?: string;
      readonly toolName?: string;
      readonly sourceRefs: readonly string[];
      readonly modelCallRefs: readonly string[];
      readonly toolCallRefs: readonly string[];
    }[];
    readonly context?: {
      readonly usageSummary: string;
      readonly budget: {
        readonly maxMessages: number;
        readonly maxChars: number;
        readonly usedChars: number;
      };
      readonly truncated: boolean;
      readonly truncationReport: {
        readonly truncated: boolean;
        readonly omittedItemCount: number;
        readonly truncatedItemIds: readonly string[];
      };
      readonly items: readonly {
        readonly itemId: string;
        readonly sourceKind: string;
        readonly summary: string;
        readonly visibility: string;
        readonly truncated: boolean;
        readonly skill?: NonNullable<DesktopAgentSessionResult["contextPack"]>["items"][number]["skill"];
      }[];
    };
  };
  readonly explanation: {
    readonly resultWhyReasonable: string;
    readonly observationPanelRole: string;
  };
};

export function createDesktopAgentCanvas(input: {
  readonly result: DesktopAgentSessionResult;
}): DesktopAgentCanvasReadModel {
  return {
    kind: "desktop_agent_canvas",
    taskSoil: taskSoilCanvas(input.result),
    agent: {
      status: input.result.status,
      answer:
        input.result.answer === undefined
          ? undefined
          : {
              answer: sanitizeAssistantVisibleText(input.result.answer.answer),
              modelCallRefs: [...input.result.answer.modelCallRefs],
              toolCallRefs: [...input.result.answer.toolCallRefs],
              evidenceRefs: input.result.answer.evidenceRefs.map((value) => safeText(value, 180)),
              resultBlocks: [],
            },
      pendingConfirmation:
        input.result.pendingConfirmation === undefined
          ? undefined
          : {
              confirmationId: input.result.pendingConfirmation.confirmationId,
              title: safeText(input.result.pendingConfirmation.title, 120),
              question: safeText(input.result.pendingConfirmation.question, 420),
              consequence: safeText(input.result.pendingConfirmation.consequence, 420),
              affectedResources: input.result.pendingConfirmation.affectedResources.map((value) => safeText(value, 240)),
              riskLevel: input.result.pendingConfirmation.riskLevel,
              resumeAvailability: input.result.pendingConfirmation.resumeAvailability,
              requestedAt: input.result.pendingConfirmation.requestedAt,
              expiresAt: input.result.pendingConfirmation.expiresAt,
              modelCallRefs: [...input.result.pendingConfirmation.modelCallRefs],
              toolCallRefs: [...input.result.pendingConfirmation.toolCallRefs],
              sourceRefs: input.result.pendingConfirmation.sourceRefs.map((value) => safeText(value, 180)),
            },
      failureMessage:
        input.result.failureMessage === undefined
          ? undefined
          : safeText(visibleFailureMessage(input.result), 420),
      modelCallRefs: [...input.result.modelCallRefs],
      toolCallRefs: [...input.result.toolCallRefs],
      activity: [],
      context:
        input.result.contextPack === undefined
          ? undefined
          : {
              usageSummary: safeText(input.result.contextPack.usageSummary, 420),
              budget: input.result.contextPack.budget,
              truncated: input.result.contextPack.truncated,
              truncationReport: input.result.contextPack.truncationReport,
              items: input.result.contextPack.items.map((item) => ({
                itemId: safeText(item.itemId, 160),
                sourceKind: item.sourceKind,
                summary: safeText(item.summary, 320),
                visibility: item.visibility,
                truncated: item.truncated,
                skill: item.skill,
              })),
            },
    },
    explanation: {
      resultWhyReasonable:
        input.result.answer !== undefined
          ? "已回答。"
          : input.result.pendingConfirmation !== undefined
            ? "等待你判断。"
            : "",
      observationPanelRole:
        "开发者详情展示调用引用和运行事件。",
    },
  };
}

function visibleFailureMessage(result: DesktopAgentSessionResult): string {
  return (
    latestModelFailureTextForUser(result.runtime.eventLog.list()) ??
    friendlyUserFacingFailureText(result.failureMessage)
  );
}
