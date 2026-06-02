import React from "react";
import { createPortal } from "react-dom";
import {
  Clock3,
  MessageSquareText,
  MoreHorizontal,
  PencilLine,
  Pin,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { isConversationWaitingForUser } from "../conversation-state";
import { compact, relativeTime } from "../text";
import type { ConversationSummary } from "../contracts/conversation";

export type Screen = "chat-empty" | "chat-active" | "skills" | "tools";

type NavItem = {
  readonly screen: Screen;
  readonly label: string;
  readonly icon: React.ReactNode;
};

const NAV_ITEMS: readonly NavItem[] = [
  { screen: "skills", label: "工作方式", icon: <Sparkles size={15} /> },
  { screen: "tools", label: "工具", icon: <Wrench size={15} /> },
];

export function Sidebar(props: {
  readonly collapsed: boolean;
  readonly currentScreen: Screen;
  readonly conversations: readonly ConversationSummary[];
  readonly activeConversationId?: string;
  readonly pendingCount: number;
  readonly onNew: () => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onNavigate: (screen: Screen) => void;
  readonly onOpenSettings: () => void;
}): React.ReactElement {
  const newTaskActive = props.currentScreen === "chat-empty" && props.activeConversationId === undefined;
  const pendingConversations = props.conversations.filter(isConversationWaitingForUser);
  const [conversationOverrides, setConversationOverrides] = React.useState<Record<string, {
    readonly title?: string;
    readonly pinned?: boolean;
    readonly deleted?: boolean;
  }>>({});
  const [renamingConversationId, setRenamingConversationId] = React.useState<string | undefined>(undefined);
  const [renamingTitle, setRenamingTitle] = React.useState("");
  const [openConversationMenu, setOpenConversationMenu] = React.useState<{
    readonly conversationId: string;
    readonly left: number;
    readonly top: number;
  } | undefined>(undefined);
  const visibleConversations = props.conversations
    .map((conversation) => ({
      ...conversation,
      title: conversationOverrides[conversation.conversationId]?.title ?? conversation.title,
      pinned: conversationOverrides[conversation.conversationId]?.pinned === true,
      deleted: conversationOverrides[conversation.conversationId]?.deleted === true,
    }))
    .filter((conversation) => !conversation.deleted)
    .sort((left, right) => Number(right.pinned) - Number(left.pinned));

  function startRename(conversationId: string, title: string): void {
    setOpenConversationMenu(undefined);
    setRenamingConversationId(conversationId);
    setRenamingTitle(title);
  }

  function commitRename(conversationId: string): void {
    const title = renamingTitle.trim();
    if (title.length > 0) {
      setConversationOverrides((previous) => ({
        ...previous,
        [conversationId]: {
          ...previous[conversationId],
          title,
        },
      }));
    }
    setRenamingConversationId(undefined);
    setRenamingTitle("");
  }

  function togglePinned(conversationId: string): void {
    setOpenConversationMenu(undefined);
    setConversationOverrides((previous) => ({
      ...previous,
      [conversationId]: {
        ...previous[conversationId],
        pinned: previous[conversationId]?.pinned !== true,
      },
    }));
  }

  function deleteConversationLocally(conversationId: string): void {
    setOpenConversationMenu(undefined);
    setConversationOverrides((previous) => ({
      ...previous,
      [conversationId]: {
        ...previous[conversationId],
        deleted: true,
      },
    }));
    if (props.activeConversationId === conversationId) {
      props.onNew();
    }
  }

  function toggleConversationMenu(event: React.MouseEvent<HTMLButtonElement>, conversationId: string): void {
    event.stopPropagation();
    if (openConversationMenu?.conversationId === conversationId) {
      setOpenConversationMenu(undefined);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 150;
    setOpenConversationMenu({
      conversationId,
      left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      top: Math.min(rect.bottom + 6, window.innerHeight - 132),
    });
  }

  React.useEffect(() => {
    if (openConversationMenu === undefined) return;
    const close = (): void => setOpenConversationMenu(undefined);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openConversationMenu]);

  return (
    <aside
      className="app-sidebar"
      data-collapsed={props.collapsed ? "true" : "false"}
      style={{ "--sidebar-width": props.collapsed ? "64px" : "276px" } as React.CSSProperties}
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

      <nav className="sidebar-nav" aria-label="导航">
        {NAV_ITEMS.map((item) => {
          const active = props.currentScreen === item.screen;
          return (
            <button
              type="button"
              key={item.screen}
              onClick={() => props.onNavigate(item.screen)}
              title={props.collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={`sidebar-action sidebar-rail-button sidebar-nav-button ${active ? "active" : ""}`}
            >
              <span className="sidebar-icon-slot" aria-hidden="true">
                {item.icon}
              </span>
              <span className="sidebar-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

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
          title={props.collapsed ? `${props.pendingCount} 个待确认` : undefined}
        >
          <span className="sidebar-icon-slot" aria-hidden="true">
            <ShieldCheck size={15} />
          </span>
          <span className="sidebar-label">{props.pendingCount} 个待确认</span>
        </button>
      )}

      <section className="sidebar-expandable sidebar-recent" aria-label="最近会话">
        <div className="sidebar-list-heading">
          <span>最近会话</span>
          <Clock3 size={13} />
        </div>
        <div className="sidebar-recent-list">
          {visibleConversations.length === 0 ? (
            <p className="sidebar-empty">开始任务后，会话会显示在这里。</p>
          ) : (
            visibleConversations.slice(0, 18).map((conversation) => {
              const active = conversation.conversationId === props.activeConversationId;
              const editing = renamingConversationId === conversation.conversationId;
              return (
              <div
                key={conversation.conversationId}
                className={`sidebar-recent-item ${active ? "active" : ""}`}
              >
                {editing ? (
                  <div className="sidebar-recent-row">
                    <MessageSquareText size={14} />
                    <span>
                      <input
                        value={renamingTitle}
                        autoFocus
                        onChange={(event) => setRenamingTitle(event.target.value)}
                        onBlur={() => commitRename(conversation.conversationId)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename(conversation.conversationId);
                          if (event.key === "Escape") {
                            setRenamingConversationId(undefined);
                            setRenamingTitle("");
                          }
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="sidebar-rename-input"
                      />
                      <small>{conversation.pinned ? "置顶" : relativeTime(conversation.updatedAt) || statusLabel(conversation.status)}</small>
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => props.onOpen(conversation.conversationId)}
                    className="sidebar-recent-row"
                    aria-label={conversation.title}
                  >
                    <MessageSquareText size={14} />
                    <span>
                      <strong>{compact(conversation.title, 34)}</strong>
                      <small>{conversation.pinned ? "置顶" : relativeTime(conversation.updatedAt) || statusLabel(conversation.status)}</small>
                    </span>
                  </button>
                )}
                <div className="sidebar-recent-actions">
                  <button
                    type="button"
                    className="sidebar-recent-more"
                    aria-label="更多"
                    onClick={(event) => toggleConversationMenu(event, conversation.conversationId)}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              </div>
              );
            })
          )}
        </div>
        {openConversationMenu !== undefined && typeof document !== "undefined" && createPortal(
          <div
            className="sidebar-recent-menu"
            style={{ left: openConversationMenu.left, top: openConversationMenu.top } as React.CSSProperties}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                const conversation = visibleConversations.find((item) => item.conversationId === openConversationMenu.conversationId);
                if (conversation !== undefined) startRename(conversation.conversationId, conversation.title);
              }}
            >
              <PencilLine size={14} />
              重命名
            </button>
            <button type="button" onClick={() => togglePinned(openConversationMenu.conversationId)}>
              <Pin size={14} />
              {visibleConversations.find((item) => item.conversationId === openConversationMenu.conversationId)?.pinned === true ? "取消置顶" : "置顶"}
            </button>
            <button type="button" className="danger" onClick={() => deleteConversationLocally(openConversationMenu.conversationId)}>
              <Trash2 size={14} />
              删除
            </button>
          </div>,
          document.body
        )}
      </section>

      <footer className="sidebar-footer">
        <button
          type="button"
          onClick={props.onOpenSettings}
          title={props.collapsed ? "设置" : undefined}
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


function statusLabel(status: string | undefined): string {
  if (status === "completed") return "已完成";
  if (status === "running" || status === "planning") return "进行中";
  if (status === "approval_needed" || status === "needs_input") return "待确认";
  if (status === "failed" || status === "blocked") return "未完成";
  return "";
}
