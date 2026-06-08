import React from "react";
import {
  Plus,
  Settings,
  ShieldCheck,
} from "lucide-react";
import {
  isConversationWaitingForUser,
} from "../conversation-state";
import { compact, relativeTime } from "../text";
import type { ConversationSummary } from "../contracts/conversation";

export type Screen = "chat-empty" | "chat-active";

export function Sidebar(props: {
  readonly currentScreen: Screen;
  readonly conversations: readonly ConversationSummary[];
  readonly activeConversationId?: string;
  readonly pendingCount: number;
  readonly onNew: () => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onOpenSettings: () => void;
}): React.ReactElement {
  const newTaskActive = props.currentScreen === "chat-empty" && props.activeConversationId === undefined;
  const pendingConversations = props.conversations.filter(isConversationWaitingForUser);
  const visibleConversations = [...props.conversations].sort(
    (left, right) => sidebarConversationTime(right) - sidebarConversationTime(left)
  );

  return (
    <aside
      className="app-sidebar"
      aria-label="工作入口"
    >
      <div className="sidebar-new-wrap">
        <button
          type="button"
          onClick={props.onNew}
          aria-label="新任务"
          aria-current={newTaskActive ? "page" : undefined}
          className={`sidebar-action sidebar-rail-button sidebar-new-button ${newTaskActive ? "active" : ""}`}
        >
          <span className="sidebar-icon-slot" aria-hidden="true">
            <Plus size={15} />
          </span>
          <span className="sidebar-label">新任务</span>
        </button>
      </div>

      {props.pendingCount > 0 && (
        <button
          type="button"
          className="sidebar-action sidebar-rail-button sidebar-pending-reminder"
          onClick={() => {
            const firstPending = pendingConversations[0];
            if (firstPending !== undefined) {
              props.onOpen(firstPending.conversationId);
            }
          }}
        >
          <span className="sidebar-icon-slot" aria-hidden="true">
            <ShieldCheck size={15} />
          </span>
          <span className="sidebar-label">{props.pendingCount} 个待处理</span>
        </button>
      )}

      <section className="sidebar-expandable sidebar-recent" aria-label="最近会话">
        <div className="sidebar-list-heading">
          <span>最近会话</span>
        </div>
        <div className="sidebar-recent-list">
          {visibleConversations.length === 0 ? (
            <p className="sidebar-empty">开始任务后，会话会显示在这里。</p>
          ) : (
            visibleConversations.slice(0, 12).map((conversation) => {
              const active = conversation.conversationId === props.activeConversationId;
              const meta = sidebarConversationMeta(conversation);
              return (
              <div
                key={conversation.conversationId}
                className={`sidebar-recent-item ${active ? "active" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => props.onOpen(conversation.conversationId)}
                  className="sidebar-recent-row"
                  aria-label={conversation.title}
                >
                  <span className="sidebar-conversation-copy">
                    <strong>{compact(conversation.title, 34)}</strong>
                    <small>{meta}</small>
                  </span>
                </button>
              </div>
              );
            })
          )}
        </div>
      </section>

      <footer className="sidebar-footer">
        <button
          type="button"
          onClick={props.onOpenSettings}
          className="sidebar-action sidebar-rail-button sidebar-nav-button sidebar-settings-button"
        >
          <span className="sidebar-icon-slot" aria-hidden="true">
            <Settings size={15} />
          </span>
          <span className="sidebar-label">设置</span>
        </button>
      </footer>
    </aside>
  );
}


function sidebarConversationTime(conversation: ConversationSummary): number {
  const time = Date.parse(conversation.updatedAt ?? "");
  return Number.isFinite(time) ? time : 0;
}

function sidebarConversationMeta(conversation: ConversationSummary): string {
  return relativeTime(conversation.updatedAt) || statusLabel(conversation.status);
}

function statusLabel(status: string | undefined): string {
  if (status === "completed") return "已完成";
  if (status === "running" || status === "planning") return "进行中";
  if (status === "approval_needed") return "待处理";
  if (status === "needs_input") return "待补充";
  if (status === "failed" || status === "blocked") return "未完成";
  return "";
}
