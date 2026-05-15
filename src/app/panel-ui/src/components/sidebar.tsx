import React, { useMemo } from "react";
import { MessageSquare, Plus, Settings, User, Wrench, Zap } from "lucide-react";
import { compact, relativeTime } from "../text";
import type { ConversationSummary } from "../types";

type PanelScreen = "chat" | "skills" | "tools" | "settings";

const NAV_ITEMS: readonly { readonly label: string; readonly screen: PanelScreen; readonly icon: React.ReactNode }[] = [
  { label: "对话", screen: "chat", icon: <MessageSquare size={15} /> },
  { label: "技能", screen: "skills", icon: <Zap size={15} /> },
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
  const activeConversations = props.conversations.filter(
    (c) => c.status === "running" || c.status === "planning" || c.status === "approval_needed" || c.status === "needs_input",
  );

  return (
    <aside
      data-collapsed={props.collapsed ? "true" : "false"}
      style={{ width: props.collapsed ? 68 : 260 } as React.CSSProperties}
      className="sidebar relative flex flex-col h-full bg-[var(--sidebar)] border-r border-[var(--sidebar-border)] shrink-0 overflow-hidden z-20"
      aria-label="工作入口"
    >
      {/* ── Top: New conversation ── */}
      <div className="px-3 pt-2 pb-2">
        <button
          type="button"
          onClick={() => {
            props.onNavigate("chat");
            props.onNew();
          }}
          aria-label="新对话"
          className="sidebar-action sidebar-rail-button sidebar-new-button w-full h-9 rounded-xl bg-[var(--accent-strong)] text-white hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] shadow-sm"
        >
          <span className="sidebar-icon-slot" aria-hidden="true">
            <Plus size={15} />
          </span>
          <span className="sidebar-label text-sm">新对话</span>
        </button>
      </div>

      {/* ── Navigation ── */}
      <nav className="px-3 flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ label, screen, icon }) => (
          <button
            type="button"
            key={screen}
            onClick={() => props.onNavigate(screen)}
            title={props.collapsed ? label : undefined}
            aria-current={props.activeScreen === screen ? "page" : undefined}
            className={`sidebar-action sidebar-rail-button sidebar-nav-button w-full h-9 rounded-xl text-sm ${
              props.activeScreen === screen
                ? "bg-white text-[var(--fg)] shadow-sm border border-[var(--border)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]"
            }`}
          >
            <span className={`sidebar-icon-slot ${props.activeScreen === screen ? "text-[var(--accent-strong)]" : ""}`} aria-hidden="true">
              {icon}
            </span>
            <span className="sidebar-label relative">{label}</span>
          </button>
        ))}
      </nav>

      {/* ── Active tasks ── */}
      {activeConversations.length > 0 && (
        <div className="sidebar-expandable mt-2 px-3 overflow-hidden">
          <span className="text-[10px] uppercase text-[var(--muted)] select-none px-0.5 mb-1 block">当前任务</span>
          <div className="flex flex-col gap-0.5 max-h-[160px] overflow-auto">
            {activeConversations.slice(0, 4).map((conversation) => (
              <button
                type="button"
                key={conversation.conversationId}
                onClick={() => {
                  props.onNavigate("chat");
                  props.onOpen(conversation.conversationId);
                }}
                className={`sidebar-recent-row w-full text-left px-2.5 py-1 rounded-lg hover:bg-[var(--surface-muted)] group flex items-center gap-1.5 ${
                  conversation.conversationId === props.activeConversationId ? "bg-white shadow-sm border border-[var(--border)]" : ""
                }`}
              >
                <div className="w-1 h-1 rounded-full bg-[var(--border)] shrink-0 group-hover:bg-[var(--muted)] transition-colors duration-[var(--motion-panel-duration)] ease-[var(--motion-ease-standard)]" />
                <span className="min-w-0 flex-1 text-sm text-[var(--fg)] truncate">{compact(conversation.title, 34)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent conversations ── */}
      <div className="sidebar-expandable mt-2 px-3 flex-1 min-h-0 overflow-hidden">
        <div className="flex items-center gap-2 mb-1 px-0.5">
          <span className="text-[10px] uppercase text-[var(--muted)] select-none">最近对话</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {props.conversations.length === 0 ? (
            <p className="text-xs text-[var(--muted-faint)] px-0.5 py-1 leading-relaxed">暂无记录。开始后会显示在这里。</p>
          ) : (
            props.conversations.slice(0, 18).map((conversation) => (
              <button
                type="button"
                key={conversation.conversationId}
                onClick={() => {
                  props.onNavigate("chat");
                  props.onOpen(conversation.conversationId);
                }}
                className={`sidebar-recent-row w-full text-left px-2.5 py-1 rounded-lg hover:bg-[var(--surface-muted)] group flex items-center gap-1.5 ${
                  conversation.conversationId === props.activeConversationId ? "bg-white shadow-sm border border-[var(--border)]" : ""
                }`}
              >
                <div className="w-1 h-1 rounded-full bg-[var(--border)] shrink-0 group-hover:bg-[var(--muted)] transition-colors duration-[var(--motion-panel-duration)] ease-[var(--motion-ease-standard)]" />
                <span className="min-w-0 flex-1 text-sm text-[var(--muted)] truncate">{compact(conversation.title, 34)}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1" />

      {/* ── User area ── */}
      <div className="border-t border-[var(--sidebar-border)] px-3 py-2.5">
        <div className="sidebar-user-card">
          <span className="sidebar-avatar-slot" aria-hidden="true">
            <span className="sidebar-user-avatar">
              <User size={15} className="text-[var(--muted)]" />
            </span>
          </span>
          <div className="sidebar-label sidebar-user-copy flex flex-col min-w-0">
            <span className="text-xs text-[var(--fg)]">本地工作区</span>
            <span className="text-[11px] text-[var(--muted)]">{relativeTime(undefined)}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
