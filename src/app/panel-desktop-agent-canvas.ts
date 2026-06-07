import type { DesktopAgentSessionResult } from "./desktop-agent-session-contracts.js";
import { safeText, taskSoilCanvas, type PanelTaskSoilCanvasReadModel } from "./panel-canvas-common.js";
import type { PanelRunTranscript } from "./panel-run-transcript-contracts.js";

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
      readonly riskLevel: string;
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
  readonly transcript: PanelRunTranscript;
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
              answer: safeText(input.result.answer.answer, 1200),
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
              riskLevel: input.result.pendingConfirmation.riskLevel,
              modelCallRefs: [...input.result.pendingConfirmation.modelCallRefs],
              toolCallRefs: [...input.result.pendingConfirmation.toolCallRefs],
              sourceRefs: input.result.pendingConfirmation.sourceRefs.map((value) => safeText(value, 180)),
            },
      failureMessage:
        input.result.failureMessage === undefined ? undefined : safeText(input.result.failureMessage, 420),
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
              })),
            },
    },
    explanation: {
      resultWhyReasonable:
        input.result.answer !== undefined
          ? "这是桌面助手回合：模型可以直接回答，也可以在授权范围内调用工具，并在缺少权限时请求确认；没有启动地下组织或生成方向包。"
          : input.result.pendingConfirmation !== undefined
            ? "桌面助手需要用户补充授权或材料后继续；不会绕过确认边界。"
            : "这轮对话没有形成可展示回答。",
      observationPanelRole:
        `开发者详情只展示模型调用 refs、配置状态和安全事件；当前安全事件 ${input.transcript.events.length} 条。`,
    },
  };
}

/**
 * @deprecated Historical read-model alias for persisted desktop_chat records.
 * Current ordinary Agent runs should use createDesktopAgentCanvas.
 */
export const createDesktopChatCanvas = createDesktopAgentCanvas;
