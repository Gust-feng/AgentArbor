import React from "react";
import { PanelLeft, Sparkles } from "lucide-react";
import type { BasicAgentRun } from "../types";

type PanelScreen = "chat" | "skills" | "tools" | "settings";

const SCREEN_LABELS: Record<PanelScreen, string> = {
  chat: "对话",
  skills: "技能",
  tools: "工具",
  settings: "设置",
};

export function TopBar(props: {
  readonly run?: BasicAgentRun;
  readonly screen: PanelScreen;
  readonly sidebarCollapsed: boolean;
  readonly onToggleSidebar: () => void;
  readonly conversationTitle?: string;
}): React.ReactElement {
  const isChat = props.screen === "chat";
  const showRunStatus = isChat && props.run !== undefined && shouldShowRunStatus(props.run.status);

  return (
    <header className="h-16 bg-white border-b border-[#EAEBF0] flex items-center px-4 gap-4 shrink-0 z-10">
      {/* Sidebar toggle */}
      <button
        type="button"
        onClick={props.onToggleSidebar}
        className="w-9 h-9 rounded-xl flex items-center justify-center text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#374151] transition-colors"
        aria-label={props.sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
      >
        <PanelLeft size={16} />
      </button>

      {/* Product identity */}
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-xl bg-[#111827] flex items-center justify-center shadow-sm">
          <Sparkles size={13} className="text-white/80" />
        </div>
        <span className="text-sm text-[#111827]">AgentArbor</span>
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-[#EAEBF0]" />

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        <span className="text-[#374151] truncate">{SCREEN_LABELS[props.screen]}</span>
        {isChat && props.conversationTitle && (
          <>
            <span className="text-[#D1D5DB]">/</span>
            <span className="text-[#6B7280] truncate">{props.conversationTitle}</span>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* Run status */}
      {showRunStatus && (
        <div className="flex items-center gap-2 h-8 px-3.5 rounded-xl border border-[#E2E3E8] bg-white text-[#6B7280] text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
          <span>{runStatusLabel(props.run.status)}</span>
        </div>
      )}

    </header>
  );
}

function shouldShowRunStatus(status: BasicAgentRun["status"]): boolean {
  return (
    status === "queued" ||
    status === "planning" ||
    status === "running" ||
    status === "approval_needed" ||
    status === "needs_input" ||
    status === "failed" ||
    status === "blocked"
  );
}

function runStatusLabel(status: BasicAgentRun["status"]): string {
  if (status === "running") return "处理中";
  if (status === "planning") return "准备中";
  if (status === "queued") return "排队中";
  if (status === "approval_needed") return "待确认";
  if (status === "needs_input") return "需要补充";
  if (status === "failed") return "未完成";
  if (status === "blocked") return "需要处理";
  return status;
}
