import React from "react";
import { PanelLeft, Sparkles } from "lucide-react";
import { STATUS_LABELS } from "../text";
import type { BasicAgentRun } from "../types";

type PanelScreen = "chat" | "skills" | "routines" | "tools" | "settings";

const SCREEN_LABELS: Record<PanelScreen, string> = {
  chat: "对话",
  skills: "技能",
  routines: "例行任务",
  tools: "工具",
  settings: "设置",
};

export function TopBar(props: {
  readonly run?: BasicAgentRun;
  readonly screen: PanelScreen;
  readonly sidebarCollapsed: boolean;
  readonly onToggleSidebar: () => void;
  readonly onOpenSettings: () => void;
}): React.ReactElement {
  const isChat = props.screen === "chat";
  const showRunStatus = isChat && props.run !== undefined && shouldShowRunStatus(props.run.status);
  return (
    <header className="h-16 bg-white border-b border-[#EAEBF0] flex items-center px-4 gap-4 shrink-0 z-10">
      <button
        type="button"
        onClick={props.onToggleSidebar}
        className="w-9 h-9 rounded-xl flex items-center justify-center text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#374151] transition-colors"
        aria-label={props.sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
      >
        <PanelLeft size={15} />
      </button>

      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-xl bg-[#111827] flex items-center justify-center shadow-sm">
          <Sparkles size={13} className="text-white/80" />
        </div>
        <span className="text-sm text-[#111827]">AgentArbor</span>
      </div>

      <div className="w-px h-5 bg-[#EAEBF0]" />

      <div className="flex items-center gap-1.5 text-sm min-w-0">
        <span className="text-[#374151] truncate">{SCREEN_LABELS[props.screen]}</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {showRunStatus && (
          <div className="flex items-center gap-2 h-8 px-3.5 rounded-xl border border-[#E2E3E8] bg-white text-[#6B7280] text-xs">
            <div className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
            <span>{STATUS_LABELS[props.run.status]}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className="w-8 h-8 rounded-full bg-[#F0F0F5] border border-[#E2E3E8] flex items-center justify-center"
          aria-label="打开设置"
          onClick={props.onOpenSettings}
        >
          <div className="w-3.5 h-3.5 rounded-full bg-[#D1D5DB]" />
        </button>
      </div>
    </header>
  );
}

function shouldShowRunStatus(status: BasicAgentRun["status"]): boolean {
  return status === "queued" ||
    status === "planning" ||
    status === "running" ||
    status === "approval_needed" ||
    status === "needs_input" ||
    status === "failed" ||
    status === "blocked";
}
