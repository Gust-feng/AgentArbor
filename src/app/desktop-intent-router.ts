// Legacy compatibility types. Desktop Shell no longer routes messages through
// an intent gate; the product default is the ordinary Agent loop. Keep these
// only so old routeDecision records can still be projected.
export type DesktopIntentRoute = "chat_direct" | "chat_plus_tools" | "task_work_session";

export type DesktopIntentDecision = {
  readonly route: DesktopIntentRoute;
  readonly reason: string;
  readonly confidence: number;
  readonly source: "ai";
  readonly modelCallRefs: readonly string[];
};

export type DesktopIntentRouteExplanation = {
  readonly title: string;
  readonly summary: string;
};

export function explainDesktopIntentDecision(decision: DesktopIntentDecision): DesktopIntentRouteExplanation {
  if (decision.route === "task_work_session") {
    return {
      title: "正在展开任务",
      summary: "我判断这需要读取上下文、拆分检查或形成可审阅结果，会把它展开成任务处理。",
    };
  }
  if (decision.route === "chat_plus_tools") {
    return {
      title: "正在查证后回复",
      summary: "我判断这需要少量授权材料或工具辅助，会先查证再回答。",
    };
  }
  return {
    title: "正在准备回复",
    summary: "我判断这适合直接回答，不启动报告或复杂任务流程。",
  };
}
