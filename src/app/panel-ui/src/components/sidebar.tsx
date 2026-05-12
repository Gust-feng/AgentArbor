import React from "react";
import { compact, relativeTime } from "../text";
import type { ConversationSummary } from "../types";
import type { SettingsTab } from "../ui-state";

export function Sidebar(props: {
  readonly conversations: readonly ConversationSummary[];
  readonly activeConversationId?: string;
  readonly onNew: () => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onSettings: (tab: SettingsTab) => void;
}): React.ReactElement {
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
        <button type="button" onClick={props.onNew}>新对话</button>
        <button type="button" onClick={() => props.onSettings("skills")}>技能</button>
        <button type="button" onClick={() => props.onSettings("tools")}>工具</button>
        <button type="button" onClick={() => props.onSettings("model")}>设置</button>
      </nav>
      <section className="conversation-list" aria-label="会话列表">
        <h2>最近会话</h2>
        {props.conversations.length === 0 ? (
          <p className="muted">暂无会话。开始后会显示在这里。</p>
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
