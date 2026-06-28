import React from "react";
import {
  ChevronDown,
  ChevronUp,
  Check,
  EllipsisVertical,
  Folder,
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
import type { DeepRunStatus, DeepRunSummary } from "../contracts/deep";

const DEFAULT_FOLDER_CONVERSATION_LIMIT = 5;

export type Screen = "chat-empty" | "chat-active";

export function Sidebar(props: {
  readonly currentScreen: Screen;
  readonly conversations: readonly ConversationSummary[];
  readonly deepRuns: readonly DeepRunSummary[];
  readonly activeConversationId?: string;
  readonly activeDeepRunId?: string;
  readonly pendingCount: number;
  readonly collapsed: boolean;
  readonly agentClusterActive: boolean;
  readonly onNew: () => void;
  readonly onOpenDeepRun: (runId: string) => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onRename: (conversationId: string, title: string) => void;
  readonly onTogglePinned: (conversationId: string, pinned: boolean) => void;
  readonly onDelete: (conversationId: string) => void;
  readonly onOpenSettings: () => void;
}): React.ReactElement {
  const [editingConversationId, setEditingConversationId] = React.useState<string | undefined>();
  const [editingTitle, setEditingTitle] = React.useState("");
  const [openMenuConversationId, setOpenMenuConversationId] = React.useState<string | undefined>();
  const [expandedConversationGroupKeys, setExpandedConversationGroupKeys] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  const newTaskActive = props.agentClusterActive
    ? props.currentScreen === "chat-empty" && props.activeDeepRunId === undefined
    : props.currentScreen === "chat-empty" && props.activeConversationId === undefined;
  const pendingConversations = props.conversations.filter(isConversationWaitingForUser);
  const visibleConversations = [...props.conversations].sort(
    compareSidebarConversations
  );
  const pinnedConversations = visibleConversations.filter((conversation) => conversation.pinnedAt !== undefined);
  const recentConversations = visibleConversations.filter((conversation) => conversation.pinnedAt === undefined);
  const recentConversationGroups = groupSidebarItemsByWorkspaceFolder(
    recentConversations,
    sidebarConversationTime
  );

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

  React.useEffect(() => {
    if (!props.collapsed) {
      return;
    }
    setEditingConversationId(undefined);
    setEditingTitle("");
    setOpenMenuConversationId(undefined);
  }, [props.collapsed]);

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

  function toggleConversationGroupExpanded(groupKey: string): void {
    setExpandedConversationGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }

  return (
    <aside
      className="app-sidebar"
      data-collapsed={props.collapsed ? "true" : "false"}
      aria-label="工作入口"
    >
      <div className="sidebar-new-wrap">
        <button
          type="button"
          onClick={props.onNew}
          aria-label="新任务"
          aria-current={newTaskActive ? "page" : undefined}
          className={`sidebar-action sidebar-rail-button sidebar-new-button sidebar-collapsed-button ${newTaskActive ? "active" : ""}`}
        >
          <span className="sidebar-icon-slot" aria-hidden="true">
            <Plus size={16} />
          </span>
          <span className="sidebar-label">新任务</span>
        </button>
      </div>

      {!props.agentClusterActive && props.pendingCount > 0 && (
        <button
          type="button"
          className="sidebar-action sidebar-rail-button sidebar-pending-reminder sidebar-collapsed-button"
          aria-label={`${props.pendingCount} 个待处理`}
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
          <span className="sidebar-pending-count" aria-hidden="true">{props.pendingCount}</span>
        </button>
      )}

      <section
        className="sidebar-expandable sidebar-recent"
        aria-label={props.agentClusterActive ? "多 Agent 历史" : "会话列表"}
        aria-hidden={props.collapsed}
      >
        <div className="sidebar-recent-list">
          {props.agentClusterActive ? (
            <DeepRunGroup
              runs={props.deepRuns}
              activeDeepRunId={props.activeDeepRunId}
              collapsed={props.collapsed}
              onOpen={props.onOpenDeepRun}
            />
          ) : visibleConversations.length === 0 ? (
            <SidebarEmptyState />
          ) : (
            <>
              {pinnedConversations.length > 0 && (
                <ConversationGroup
                  title="置顶"
                  hideTitle={false}
                  conversations={pinnedConversations}
                  activeConversationId={props.activeConversationId}
                  collapsed={props.collapsed}
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
              {recentConversationGroups.map((group) => (
                <ConversationGroup
                  key={group.key}
                  groupKey={group.key}
                  title={group.label}
                  titlePath={group.path}
                  folderHeading
                  conversations={group.items}
                  defaultVisibleCount={DEFAULT_FOLDER_CONVERSATION_LIMIT}
                  expanded={expandedConversationGroupKeys.has(group.key)}
                  activeConversationId={props.activeConversationId}
                  collapsed={props.collapsed}
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
                  onToggleExpanded={toggleConversationGroupExpanded}
                />
              ))}
            </>
          )}
        </div>
      </section>

      <footer className="sidebar-footer">
        <button
          type="button"
          onClick={props.onOpenSettings}
          className="sidebar-action sidebar-rail-button sidebar-nav-button sidebar-settings-button sidebar-collapsed-button"
          aria-label="设置"
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

function DeepRunGroup(props: {
  readonly runs: readonly DeepRunSummary[];
  readonly activeDeepRunId?: string;
  readonly collapsed: boolean;
  readonly onOpen: (runId: string) => void;
}): React.ReactElement {
  const visibleRuns = props.runs.slice(0, 24);
  if (visibleRuns.length === 0) {
    return <SidebarEmptyState label="暂无多 Agent 任务" />;
  }
  const groups = groupSidebarItemsByWorkspaceFolder(visibleRuns, sidebarDeepRunTime);
  return (
    <>
      {groups.map((group) => (
        <div className="sidebar-conversation-group sidebar-deep-run-group" key={group.key}>
          <SidebarFolderHeading title={group.label} titlePath={group.path} />
          {group.items.map((run) => (
            <DeepRunListItem
              key={run.runId}
              run={run}
              active={run.runId === props.activeDeepRunId}
              collapsed={props.collapsed}
              onOpen={props.onOpen}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function DeepRunListItem(props: {
  readonly run: DeepRunSummary;
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly onOpen: (runId: string) => void;
}): React.ReactElement {
  return (
    <div className={`sidebar-recent-item sidebar-deep-run-item ${props.active ? "active" : ""}`}>
      <button
        type="button"
        onClick={() => props.onOpen(props.run.runId)}
        className="sidebar-recent-row sidebar-deep-run-row"
        aria-label={props.run.goal}
        tabIndex={props.collapsed ? -1 : 0}
      >
        <span className={`sidebar-deep-run-status sidebar-deep-run-status-${props.run.status}`} aria-hidden="true" />
        <span className="sidebar-conversation-copy sidebar-deep-run-copy">
          <strong>{compact(props.run.goal, 34)}</strong>
          <small>{deepRunStatusLabel(props.run.status)} · {sidebarDeepRunTimeLabel(props.run.updatedAt)}</small>
        </span>
      </button>
    </div>
  );
}

function SidebarEmptyState(props: { readonly label?: string }): React.ReactElement {
  const label = props.label ?? "暂无会话";
  return (
    <div className="sidebar-empty-state" aria-label={label}>
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

function SidebarFolderHeading(props: {
  readonly title: string;
  readonly titlePath?: string;
}): React.ReactElement {
  return (
    <div className="sidebar-list-heading sidebar-folder-heading">
      <Folder size={15} aria-hidden="true" />
      <span>{props.title}</span>
    </div>
  );
}

function ConversationGroup(props: {
  readonly groupKey?: string;
  readonly title: string;
  readonly titlePath?: string;
  readonly folderHeading?: boolean;
  readonly hideTitle?: boolean;
  readonly conversations: readonly ConversationSummary[];
  readonly defaultVisibleCount?: number;
  readonly expanded?: boolean;
  readonly activeConversationId?: string;
  readonly collapsed: boolean;
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
  readonly onToggleExpanded?: (groupKey: string) => void;
}): React.ReactElement | null {
  if (props.conversations.length === 0) {
    return null;
  }
  const defaultVisibleCount = props.defaultVisibleCount ?? props.conversations.length;
  const canExpand = props.groupKey !== undefined
    && props.onToggleExpanded !== undefined
    && props.conversations.length > defaultVisibleCount;
  const visibleConversations = canExpand && !props.expanded
    ? props.conversations.slice(0, defaultVisibleCount)
    : props.conversations;
  const hiddenCount = props.conversations.length - visibleConversations.length;
  return (
    <div className="sidebar-conversation-group">
      {!props.hideTitle && (
        props.folderHeading
          ? <SidebarFolderHeading title={props.title} titlePath={props.titlePath} />
          : (
              <div className="sidebar-list-heading">
                <span>{props.title}</span>
              </div>
            )
      )}
      {visibleConversations.map((conversation) => (
        <ConversationListItem
          key={conversation.conversationId}
          conversation={conversation}
          active={conversation.conversationId === props.activeConversationId}
          collapsed={props.collapsed}
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
      {canExpand && (
        <button
          type="button"
          className="sidebar-folder-more-button"
          aria-expanded={props.expanded === true}
          tabIndex={props.collapsed ? -1 : 0}
          onClick={() => {
            if (props.groupKey !== undefined) {
              props.onToggleExpanded?.(props.groupKey);
            }
          }}
        >
          {props.expanded === true ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          <span>{props.expanded === true ? "收起" : `展开 ${hiddenCount} 个`}</span>
        </button>
      )}
    </div>
  );
}

function ConversationListItem(props: {
  readonly conversation: ConversationSummary;
  readonly active: boolean;
  readonly collapsed: boolean;
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
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
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
          <button type="submit" className="sidebar-icon-button" aria-label="保存重命名">
            <Check size={14} />
          </button>
          <button type="button" className="sidebar-icon-button" aria-label="取消" onClick={props.onRenameCancel}>
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
            tabIndex={props.collapsed ? -1 : 0}
          >
            <span className="sidebar-conversation-copy">
              <strong>{compact(props.conversation.title, 34)}</strong>
            </span>
          </button>
          {!props.collapsed && (
            <div className="sidebar-menu-wrap" data-sidebar-menu-owner={props.conversation.conversationId}>
              <button
                ref={menuButtonRef}
                type="button"
                className="sidebar-kebab-button"
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
          )}
        </>
      )}
    </div>
  );
}

function sidebarConversationTime(conversation: ConversationSummary): number {
  const time = Date.parse(conversation.updatedAt ?? "");
  return Number.isFinite(time) ? time : 0;
}

function sidebarDeepRunTime(run: DeepRunSummary): number {
  const time = Date.parse(run.updatedAt);
  return Number.isFinite(time) ? time : 0;
}

type SidebarWorkspaceItem = {
  readonly workspaceFolder?: {
    readonly label: string;
    readonly path?: string;
  };
};

type SidebarWorkspaceGroup<T> = {
  readonly key: string;
  readonly label: string;
  readonly path?: string;
  readonly items: readonly T[];
};

function groupSidebarItemsByWorkspaceFolder<T extends SidebarWorkspaceItem>(
  items: readonly T[],
  itemTime: (item: T) => number
): readonly SidebarWorkspaceGroup<T>[] {
  const groups = new Map<string, { label: string; path?: string; items: T[]; latestTime: number }>();
  for (const item of items) {
    const folder = item.workspaceFolder;
    const key = folder?.path ?? folder?.label ?? "__ungrouped__";
    const label = folder?.label ?? "未归类";
    const current = groups.get(key);
    const latestTime = itemTime(item);
    if (current === undefined) {
      groups.set(key, {
        label,
        path: folder?.path,
        items: [item],
        latestTime,
      });
      continue;
    }
    current.items.push(item);
    current.latestTime = Math.max(current.latestTime, latestTime);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: group.label,
      path: group.path,
      items: group.items,
      latestTime: group.latestTime,
    }))
    .sort((left, right) => right.latestTime - left.latestTime || left.label.localeCompare(right.label));
}

function compareSidebarConversations(left: ConversationSummary, right: ConversationSummary): number {
  const pinned = (right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? "");
  return pinned === 0 ? sidebarConversationTime(right) - sidebarConversationTime(left) : pinned;
}

function deepRunStatusLabel(status: DeepRunStatus): string {
  switch (status) {
    case "pending":
      return "待启动";
    case "running":
      return "运行中";
    case "interrupted":
      return "已打断";
    case "corrected":
      return "已修正";
    case "stopped":
      return "已停止";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return status;
  }
}

function sidebarDeepRunTimeLabel(timestamp: string): string {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return "未知";
  }
  const diff = Date.now() - time;
  if (diff < 60_000) {
    return "刚刚";
  }
  if (diff < 60 * 60_000) {
    return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  }
  if (diff < 24 * 60 * 60_000) {
    return `${Math.floor(diff / (60 * 60_000))} 小时前`;
  }
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
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
