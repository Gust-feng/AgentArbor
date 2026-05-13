import React from "react";
import { compact, relativeTime, statusTone } from "../text";
import type { ConversationSummary } from "../types";
import type { SettingsTab } from "../ui-state";

export function Sidebar(props: {
  readonly conversations: readonly ConversationSummary[];
  readonly activeConversationId?: string;
  readonly onNew: () => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onSettings: (tab: SettingsTab) => void;
}): React.ReactElement {
  const activeConversations = props.conversations.filter((conversation) =>
    conversation.status === "running" ||
    conversation.status === "planning" ||
    conversation.status === "approval_needed" ||
    conversation.status === "needs_input"
  );
  return (
    <aside className="sidebar" aria-label="工作入口">
      <div className="brand">
        <span className="brand-mark" />
        <div>
          <strong>AgentArbor</strong>
          <span>桌面 Agent</span>
        </div>
      </div>
      <nav className="nav-stack">
        <button type="button" className="primary-nav" onClick={props.onNew}>新任务</button>
        <button type="button" onClick={() => props.onSettings("skills")}>技能</button>
        <button type="button" onClick={() => props.onSettings("tools")}>工具</button>
        <button type="button" onClick={() => props.onSettings("model")}>设置</button>
      </nav>
      <section className="active-task-list" aria-label="当前任务">
        <h2>当前任务</h2>
        {activeConversations.length === 0 ? (
          <p className="muted">没有正在运行或等待确认的任务。</p>
        ) : (
          <ul>
            {activeConversations.slice(0, 4).map((conversation) => (
              <li key={conversation.conversationId}>
                <button
                  type="button"
                  className={conversation.conversationId === props.activeConversationId ? "selected conversation-item" : "conversation-item"}
                  onClick={() => props.onOpen(conversation.conversationId)}
                >
                  <span>{compact(conversation.title, 42)}</span>
                  <small className={`inline-status ${statusTone(conversation.status)}`}>{conversationStatusLabel(conversation.status)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="conversation-list" aria-label="会话列表">
        <h2>最近任务</h2>
        {props.conversations.length === 0 ? (
          <p className="muted">暂无记录。开始后会显示在这里。</p>
        ) : (
          <ul>
            {props.conversations.slice(0, 24).map((conversation) => (
              <li key={conversation.conversationId}>
                <button
                  type="button"
                  className={conversation.conversationId === props.activeConversationId ? "selected conversation-item" : "conversation-item"}
                  onClick={() => props.onOpen(conversation.conversationId)}
                >
                  <span>{compact(conversation.title, 42)}</span>
                  <small>{relativeTime(conversation.updatedAt)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function conversationStatusLabel(status: string | undefined): string {
  if (status === "running") return "进行中";
  if (status === "planning") return "准备中";
  if (status === "approval_needed") return "待确认";
  if (status === "needs_input") return "需补充";
  return "任务";
}
