import React from "react";
import { CalendarClock, MessageSquare, Plus, Settings, User, Wrench, Zap } from "lucide-react";
import { compact, relativeTime } from "../text";
import type { ConversationSummary } from "../types";

type PanelScreen = "chat" | "skills" | "routines" | "tools" | "settings";

const NAV_ITEMS: readonly { readonly label: string; readonly screen: PanelScreen; readonly icon: React.ReactNode }[] = [
  { label: "对话", screen: "chat", icon: <MessageSquare size={15} /> },
  { label: "技能", screen: "skills", icon: <Zap size={15} /> },
  { label: "例行任务", screen: "routines", icon: <CalendarClock size={15} /> },
  { label: "工具", screen: "tools", icon: <Wrench size={15} /> },
  { label: "设置", screen: "settings", icon: <Settings size={15} /> },
];

export function Sidebar(props: {
  readonly collapsed: boolean;
  readonly conversations: readonly ConversationSummary[];
  readonly activeConversationId?: string;
  readonly activeScreen: PanelScreen;
  readonly onNew: () => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onNavigate: (screen: PanelScreen) => void;
}): React.ReactElement {
  return (
    <aside
      style={{ width: props.collapsed ? 68 : 300 }}
      className="relative flex flex-col h-full bg-[#F7F7FA] border-r border-[#EAEBF0] transition-[width] duration-200 ease-in-out shrink-0 overflow-visible z-20"
      aria-label="工作入口"
    >
      <div className="px-3 pt-5 pb-4">
        <button
          type="button"
          onClick={() => {
            props.onNavigate("chat");
            props.onNew();
          }}
          className={`w-full flex items-center gap-2.5 rounded-xl bg-[#111827] text-white hover:bg-[#1F2937] active:bg-[#030712] transition-colors shadow-sm ${
            props.collapsed ? "justify-center px-0 py-2.5" : "px-3.5 py-2.5"
          }`}
          title="新对话"
        >
          <Plus size={14} className="shrink-0" />
          {!props.collapsed && <span className="text-sm">新对话</span>}
        </button>
      </div>

      <nav className="px-2.5 flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ label, screen, icon }) => (
          <button
            type="button"
            key={screen}
            onClick={() => props.onNavigate(screen)}
            className={`w-full flex items-center gap-3 rounded-xl text-sm transition-all duration-100 ${
              props.collapsed ? "justify-center px-0 py-3" : "px-3.5 py-2.5"
            } ${
              props.activeScreen === screen
                ? "bg-white text-[#111827] shadow-sm border border-[#E2E3E8]"
                : "text-[#6B7280] hover:bg-[#EEEEF2] hover:text-[#374151]"
            }`}
            title={label}
          >
            <span className="shrink-0">{icon}</span>
            {!props.collapsed && <span>{label}</span>}
          </button>
        ))}
      </nav>

      {!props.collapsed && (
        <div className="mt-5 px-4 flex flex-col min-h-0 flex-1">
          {props.conversations.length > 0 && <span className="text-[10px] uppercase tracking-widest text-[#BEBFC8] px-0.5 mb-1 select-none">最近对话</span>}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <div className="flex flex-col gap-1">
              {props.conversations.slice(0, 18).map((conversation) => (
                <button
                  type="button"
                  key={conversation.conversationId}
                  onClick={() => {
                    props.onNavigate("chat");
                    props.onOpen(conversation.conversationId);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#EBEBEF] transition-colors group ${
                    conversation.conversationId === props.activeConversationId ? "bg-white shadow-sm border border-[#E2E3E8]" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[#D1D5DB] shrink-0 group-hover:bg-[#9CA3AF]" />
                    <span className="min-w-0 flex-1 text-sm text-[#6B7280] truncate">{compact(conversation.title, 34)}</span>
                  </div>
                  <small className="block pl-3 mt-0.5 text-[10px] text-[#C4C4CE]">{relativeTime(conversation.updatedAt)}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-[#EBEBED] px-3 py-3">
        <div className={`flex items-center gap-2.5 ${props.collapsed ? "justify-center" : ""}`}>
          <div className="w-8 h-8 rounded-full bg-[#E9EAF0] flex items-center justify-center shrink-0 border border-[#E0E1EA]">
            <User size={14} className="text-[#9CA3AF]" />
          </div>
        </div>
      </div>
    </aside>
  );
}
