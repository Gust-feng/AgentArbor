import React from "react";
import {
  Check,
  EllipsisVertical,
  Plus,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  isConversationWaitingForUser,
} from "../conversation-state";
import { compact } from "../text";
import type { ConversationSummary } from "../contracts/conversation";

export type Screen = "chat-empty" | "chat-active";

export function Sidebar(props: {
  readonly currentScreen: Screen;
  readonly conversations: readonly ConversationSummary[];
  readonly activeConversationId?: string;
  readonly pendingCount: number;
  readonly onNew: () => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onRename: (conversationId: string, title: string) => void;
  readonly onTogglePinned: (conversationId: string, pinned: boolean) => void;
  readonly onDelete: (conversationId: string) => void;
  readonly onOpenSettings: () => void;
}): React.ReactElement {
  const [editingConversationId, setEditingConversationId] = React.useState<string | undefined>();
  const [editingTitle, setEditingTitle] = React.useState("");
  const [openMenuConversationId, setOpenMenuConversationId] = React.useState<string | undefined>();
  const newTaskActive = props.currentScreen === "chat-empty" && props.activeConversationId === undefined;
  const pendingConversations = props.conversations.filter(isConversationWaitingForUser);
  const visibleConversations = [...props.conversations].sort(
    compareSidebarConversations
  ).slice(0, 24);
  const pinnedConversations = visibleConversations.filter((conversation) => conversation.pinnedAt !== undefined);
  const recentConversations = visibleConversations.filter((conversation) => conversation.pinnedAt === undefined);

  React.useEffect(() => {
    if (openMenuConversationId === undefined) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent): void {
      if (menuOwnerFromTarget(event.target) !== openMenuConversationId) {
        setOpenMenuConversationId(undefined);
      }
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpenMenuConversationId(undefined);
      }
    }

    function closeOnScroll(): void {
      setOpenMenuConversationId(undefined);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [openMenuConversationId]);

  function beginRename(conversation: ConversationSummary): void {
    setOpenMenuConversationId(undefined);
    setEditingConversationId(conversation.conversationId);
    setEditingTitle(conversation.title);
  }

  function cancelRename(): void {
    setEditingConversationId(undefined);
    setEditingTitle("");
  }

  function commitRename(conversation: ConversationSummary): void {
    const nextTitle = editingTitle.trim();
    if (nextTitle.length === 0 || nextTitle === conversation.title) {
      cancelRename();
      return;
    }
    props.onRename(conversation.conversationId, nextTitle);
    cancelRename();
  }

  function submitRename(event: React.FormEvent<HTMLFormElement>, conversation: ConversationSummary): void {
    event.preventDefault();
    commitRename(conversation);
  }

  function toggleMenu(conversationId: string): void {
    setOpenMenuConversationId((current) => current === conversationId ? undefined : conversationId);
  }

  function togglePinned(conversation: ConversationSummary): void {
    setOpenMenuConversationId(undefined);
    props.onTogglePinned(conversation.conversationId, conversation.pinnedAt === undefined);
  }

  function deleteConversation(conversation: ConversationSummary): void {
    setOpenMenuConversationId(undefined);
    props.onDelete(conversation.conversationId);
  }

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
            <Plus size={16} />
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

      <section className="sidebar-expandable sidebar-recent" aria-label="会话列表">
        <div className="sidebar-recent-list">
          {visibleConversations.length === 0 ? (
            <SidebarEmptyState />
          ) : (
            <>
              {pinnedConversations.length > 0 && (
                <ConversationGroup
                  title="置顶"
                  conversations={pinnedConversations}
                  activeConversationId={props.activeConversationId}
                  editingConversationId={editingConversationId}
                  editingTitle={editingTitle}
                  openMenuConversationId={openMenuConversationId}
                  setEditingTitle={setEditingTitle}
                  onOpen={props.onOpen}
                  onRenameStart={beginRename}
                  onRenameCancel={cancelRename}
                  onRenameCommit={commitRename}
                  onRenameSubmit={submitRename}
                  onMenuToggle={toggleMenu}
                  onTogglePinned={togglePinned}
                  onDelete={deleteConversation}
                />
              )}
              <ConversationGroup
                title="最近会话"
                conversations={recentConversations}
                activeConversationId={props.activeConversationId}
                editingConversationId={editingConversationId}
                editingTitle={editingTitle}
                openMenuConversationId={openMenuConversationId}
                setEditingTitle={setEditingTitle}
                onOpen={props.onOpen}
                onRenameStart={beginRename}
                onRenameCancel={cancelRename}
                onRenameCommit={commitRename}
                onRenameSubmit={submitRename}
                onMenuToggle={toggleMenu}
                onTogglePinned={togglePinned}
                onDelete={deleteConversation}
              />
            </>
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

function SidebarEmptyState(): React.ReactElement {
  return (
    <div className="sidebar-empty-state" aria-label="暂无会话">
      <div className="sidebar-empty-rail" aria-hidden="true">
        <span className="sidebar-empty-rail-dot active" />
        <span className="sidebar-empty-rail-line" />
        <span className="sidebar-empty-rail-dot" />
      </div>
      <div className="sidebar-empty-stack" aria-hidden="true">
        <span className="sidebar-empty-row wide" />
        <span className="sidebar-empty-row" />
        <span className="sidebar-empty-row short" />
      </div>
    </div>
  );
}

function ConversationGroup(props: {
  readonly title: string;
  readonly conversations: readonly ConversationSummary[];
  readonly activeConversationId?: string;
  readonly editingConversationId?: string;
  readonly editingTitle: string;
  readonly openMenuConversationId?: string;
  readonly setEditingTitle: (title: string) => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onRenameStart: (conversation: ConversationSummary) => void;
  readonly onRenameCancel: () => void;
  readonly onRenameCommit: (conversation: ConversationSummary) => void;
  readonly onRenameSubmit: (event: React.FormEvent<HTMLFormElement>, conversation: ConversationSummary) => void;
  readonly onMenuToggle: (conversationId: string) => void;
  readonly onTogglePinned: (conversation: ConversationSummary) => void;
  readonly onDelete: (conversation: ConversationSummary) => void;
}): React.ReactElement | null {
  if (props.conversations.length === 0) {
    return null;
  }
  return (
    <div className="sidebar-conversation-group">
      <div className="sidebar-list-heading">
        <span>{props.title}</span>
      </div>
              {props.conversations.map((conversation) => (
                <ConversationListItem
                  key={conversation.conversationId}
                  conversation={conversation}
          active={conversation.conversationId === props.activeConversationId}
          editing={conversation.conversationId === props.editingConversationId}
          editingTitle={props.editingTitle}
          menuOpen={conversation.conversationId === props.openMenuConversationId}
          setEditingTitle={props.setEditingTitle}
          onOpen={props.onOpen}
          onRenameStart={props.onRenameStart}
          onRenameCancel={props.onRenameCancel}
          onRenameCommit={props.onRenameCommit}
          onRenameSubmit={props.onRenameSubmit}
          onMenuToggle={props.onMenuToggle}
          onTogglePinned={props.onTogglePinned}
          onDelete={props.onDelete}
        />
      ))}
    </div>
  );
}

function ConversationListItem(props: {
  readonly conversation: ConversationSummary;
  readonly active: boolean;
  readonly editing: boolean;
  readonly editingTitle: string;
  readonly menuOpen: boolean;
  readonly setEditingTitle: (title: string) => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onRenameStart: (conversation: ConversationSummary) => void;
  readonly onRenameCancel: () => void;
  readonly onRenameCommit: (conversation: ConversationSummary) => void;
  readonly onRenameSubmit: (event: React.FormEvent<HTMLFormElement>, conversation: ConversationSummary) => void;
  readonly onMenuToggle: (conversationId: string) => void;
  readonly onTogglePinned: (conversation: ConversationSummary) => void;
  readonly onDelete: (conversation: ConversationSummary) => void;
}): React.ReactElement {
  const pinned = props.conversation.pinnedAt !== undefined;
  const deleteDisabled = conversationHasActiveWork(props.conversation);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const [menuPosition, setMenuPosition] = React.useState<React.CSSProperties | undefined>();

  React.useLayoutEffect(() => {
    if (!props.menuOpen) {
      setMenuPosition(undefined);
      return;
    }
    setMenuPosition(positionConversationMenu(menuButtonRef.current));
  }, [props.menuOpen]);

  React.useLayoutEffect(() => {
    if (!props.editing) return;
    const input = renameInputRef.current;
    if (input === null) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [props.editing]);

  return (
    <div
      className={`sidebar-recent-item ${props.active ? "active" : ""} ${props.editing ? "editing" : ""} ${props.menuOpen ? "menu-open" : ""}`}
    >
      {props.editing ? (
        <form
          className="sidebar-rename-form"
          onSubmit={(event) => props.onRenameSubmit(event, props.conversation)}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget;
            if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
            props.onRenameCommit(props.conversation);
          }}
        >
          <input
            ref={renameInputRef}
            value={props.editingTitle}
            onChange={(event) => props.setEditingTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                props.onRenameCancel();
              }
            }}
            aria-label="会话标题"
            maxLength={80}
            autoFocus
          />
          <button type="submit" className="sidebar-icon-button" title="保存重命名" aria-label="保存重命名">
            <Check size={14} />
          </button>
          <button type="button" className="sidebar-icon-button" title="取消" aria-label="取消" onClick={props.onRenameCancel}>
            <X size={14} />
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => props.onOpen(props.conversation.conversationId)}
            className="sidebar-recent-row"
            aria-label={props.conversation.title}
          >
            <span className="sidebar-conversation-copy">
              <strong>{compact(props.conversation.title, 34)}</strong>
            </span>
          </button>
          <div className="sidebar-menu-wrap" data-sidebar-menu-owner={props.conversation.conversationId}>
            <button
              ref={menuButtonRef}
              type="button"
              className="sidebar-kebab-button"
              title="会话操作"
              aria-label="会话操作"
              aria-haspopup="menu"
              aria-expanded={props.menuOpen}
              onClick={() => props.onMenuToggle(props.conversation.conversationId)}
            >
              <EllipsisVertical size={17} />
            </button>
            {props.menuOpen && (
              <div className="sidebar-conversation-menu" role="menu" style={menuPosition}>
                <button type="button" role="menuitem" onClick={() => props.onRenameStart(props.conversation)}>
                  重命名
                </button>
                <button type="button" role="menuitem" onClick={() => props.onTogglePinned(props.conversation)}>
                  {pinned ? "取消置顶" : "置顶"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  disabled={deleteDisabled}
                  onClick={() => props.onDelete(props.conversation)}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function sidebarConversationTime(conversation: ConversationSummary): number {
  const time = Date.parse(conversation.updatedAt ?? "");
  return Number.isFinite(time) ? time : 0;
}

function compareSidebarConversations(left: ConversationSummary, right: ConversationSummary): number {
  const pinned = (right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? "");
  return pinned === 0 ? sidebarConversationTime(right) - sidebarConversationTime(left) : pinned;
}

function conversationHasActiveWork(conversation: ConversationSummary): boolean {
  return conversation.activeRunId !== undefined || (conversation.queuedRunCount ?? conversation.queuedRunIds?.length ?? 0) > 0;
}

function positionConversationMenu(anchor: HTMLElement | null): React.CSSProperties {
  const menuWidth = 118;
  const menuHeight = 104;
  const viewportGap = 8;
  if (anchor === null) {
    return {
      left: viewportGap,
      top: viewportGap,
    };
  }
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(
    viewportGap,
    Math.min(window.innerWidth - menuWidth - viewportGap, rect.right - menuWidth + 4)
  );
  const belowTop = rect.bottom + 2;
  const aboveTop = rect.top - menuHeight - 2;
  const top = belowTop + menuHeight > window.innerHeight - viewportGap
    ? Math.max(viewportGap, aboveTop)
    : belowTop;
  return { left, top };
}

function menuOwnerFromTarget(target: EventTarget | null): string | undefined {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : undefined;
  return element?.closest("[data-sidebar-menu-owner]")?.getAttribute("data-sidebar-menu-owner") ?? undefined;
}
