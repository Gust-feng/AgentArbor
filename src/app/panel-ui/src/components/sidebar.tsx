import React from "react";
import {
  ChevronDown,
  ChevronUp,
  Check,
  EllipsisVertical,
  Folder,
  Network,
  Plus,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { isDeepConversationActive } from "../deep-sidebar-selection";
import {
  isConversationWaitingForUser,
} from "../conversation-state";
import { compact } from "../text";
import type { ConversationSummary } from "../contracts/conversation";
import type {
  DeepConversationSummary,
  DeepIntakeStatus,
  DeepRunRuntimeHealthState,
  DeepRunStatus,
  DeepRunSummary,
} from "../contracts/deep";

const DEFAULT_FOLDER_CONVERSATION_LIMIT = 5;

export type Screen = "chat-empty" | "chat-active";

export function Sidebar(props: {
  readonly currentScreen: Screen;
  readonly conversations: readonly ConversationSummary[];
  readonly deepConversations: readonly DeepConversationSummary[];
  readonly deepRuns: readonly DeepRunSummary[];
  readonly activeConversationId?: string;
  readonly activeDeepConversationId?: string;
  readonly activeDeepRunId?: string;
  readonly pendingCount: number;
  readonly collapsed: boolean;
  readonly agentClusterActive: boolean;
  readonly agentClusterEnabled: boolean;
  readonly pinningConversationIds: ReadonlySet<string>;
  readonly onNew: () => void;
  readonly onOpenAgentCluster: () => void;
  readonly onOpenDeepConversation: (conversationId: string) => void;
  readonly onOpenDeepRun: (runId: string) => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onRename: (conversationId: string, title: string) => void;
  readonly onRenameDeep: (conversationId: string, title: string) => void;
  readonly onTogglePinned: (conversationId: string, pinned: boolean) => void;
  readonly onToggleDeepPinned: (conversationId: string, pinned: boolean) => void;
  readonly onDelete: (conversationId: string) => void;
  readonly onDeleteDeep: (conversationId: string) => void;
  readonly onOpenSettings: () => void;
}): React.ReactElement {
  const [editingConversationId, setEditingConversationId] = React.useState<string | undefined>();
  const [editingTitle, setEditingTitle] = React.useState("");
  const [openMenuConversationId, setOpenMenuConversationId] = React.useState<string | undefined>();
  const [expandedConversationGroupKeys, setExpandedConversationGroupKeys] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  const newTaskActive = !props.agentClusterActive &&
    props.currentScreen === "chat-empty" &&
    props.activeConversationId === undefined;
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

  function beginRename(conversation: { readonly conversationId: string; readonly title: string }): void {
    setOpenMenuConversationId(undefined);
    setEditingConversationId(conversation.conversationId);
    setEditingTitle(conversation.title);
  }

  function cancelRename(): void {
    setEditingConversationId(undefined);
    setEditingTitle("");
  }

  function commitRename(
    conversation: { readonly conversationId: string; readonly title: string },
    onRename: (conversationId: string, title: string) => void,
  ): void {
    const nextTitle = editingTitle.trim();
    if (nextTitle.length === 0 || nextTitle === conversation.title) {
      cancelRename();
      return;
    }
    onRename(conversation.conversationId, nextTitle);
    cancelRename();
  }

  function submitRename(
    event: React.FormEvent<HTMLFormElement>,
    conversation: { readonly conversationId: string; readonly title: string },
    onRename: (conversationId: string, title: string) => void,
  ): void {
    event.preventDefault();
    commitRename(conversation, onRename);
  }

  function toggleMenu(conversationId: string): void {
    setOpenMenuConversationId((current) => current === conversationId ? undefined : conversationId);
  }

  function togglePinned(conversation: ConversationSummary): void {
    if (props.pinningConversationIds.has(conversation.conversationId)) return;
    setOpenMenuConversationId(undefined);
    props.onTogglePinned(conversation.conversationId, conversation.pinnedAt === undefined);
  }

  function deleteConversation(conversation: ConversationSummary): void {
    setOpenMenuConversationId(undefined);
    props.onDelete(conversation.conversationId);
  }

  function toggleDeepPinned(conversation: DeepConversationSummary): void {
    if (props.pinningConversationIds.has(conversation.conversationId)) return;
    setOpenMenuConversationId(undefined);
    props.onToggleDeepPinned(conversation.conversationId, conversation.pinnedAt === undefined);
  }

  function deleteDeepConversation(conversation: DeepConversationSummary): void {
    setOpenMenuConversationId(undefined);
    props.onDeleteDeep(conversation.conversationId);
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
        {props.agentClusterEnabled && (
          <button
            type="button"
            onClick={props.onOpenAgentCluster}
            aria-label="Agent 集群"
            aria-current={props.agentClusterActive ? "page" : undefined}
            className={`sidebar-action sidebar-rail-button sidebar-agent-cluster-button sidebar-collapsed-button ${props.agentClusterActive ? "active" : ""}`}
          >
            <span className="sidebar-icon-slot" aria-hidden="true">
              <Network size={15} />
            </span>
            <span className="sidebar-label">Agent 集群</span>
          </button>
        )}
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
        aria-label={props.agentClusterActive ? "Agent 集群历史" : "会话列表"}
        aria-hidden={props.collapsed}
      >
        <div className="sidebar-recent-list">
          {props.agentClusterActive ? (
            <DeepConversationGroup
              conversations={props.deepConversations}
              fallbackRuns={props.deepRuns}
              activeDeepConversationId={props.activeDeepConversationId}
              activeDeepRunId={props.activeDeepRunId}
              collapsed={props.collapsed}
              editingConversationId={editingConversationId}
              editingTitle={editingTitle}
              openMenuConversationId={openMenuConversationId}
              pinningConversationIds={props.pinningConversationIds}
              setEditingTitle={setEditingTitle}
              onOpenConversation={props.onOpenDeepConversation}
              onOpenRun={props.onOpenDeepRun}
              onRenameStart={beginRename}
              onRenameCancel={cancelRename}
              onRenameCommit={(conversation) => commitRename(conversation, props.onRenameDeep)}
              onRenameSubmit={(event, conversation) => submitRename(event, conversation, props.onRenameDeep)}
              onMenuToggle={toggleMenu}
              onTogglePinned={toggleDeepPinned}
              onDelete={deleteDeepConversation}
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
                  pinningConversationIds={props.pinningConversationIds}
                  setEditingTitle={setEditingTitle}
                  onOpen={props.onOpen}
                  onRenameStart={beginRename}
                  onRenameCancel={cancelRename}
                  onRenameCommit={(conversation) => commitRename(conversation, props.onRename)}
                  onRenameSubmit={(event, conversation) => submitRename(event, conversation, props.onRename)}
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
                  pinningConversationIds={props.pinningConversationIds}
                  setEditingTitle={setEditingTitle}
                  onOpen={props.onOpen}
                  onRenameStart={beginRename}
                  onRenameCancel={cancelRename}
                  onRenameCommit={(conversation) => commitRename(conversation, props.onRename)}
                  onRenameSubmit={(event, conversation) => submitRename(event, conversation, props.onRename)}
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

function DeepConversationGroup(props: {
  readonly conversations: readonly DeepConversationSummary[];
  readonly fallbackRuns: readonly DeepRunSummary[];
  readonly activeDeepConversationId?: string;
  readonly activeDeepRunId?: string;
  readonly collapsed: boolean;
  readonly editingConversationId?: string;
  readonly editingTitle: string;
  readonly openMenuConversationId?: string;
  readonly pinningConversationIds: ReadonlySet<string>;
  readonly setEditingTitle: (title: string) => void;
  readonly onOpenConversation: (conversationId: string) => void;
  readonly onOpenRun: (runId: string) => void;
  readonly onRenameStart: (conversation: DeepConversationSummary) => void;
  readonly onRenameCancel: () => void;
  readonly onRenameCommit: (conversation: DeepConversationSummary) => void;
  readonly onRenameSubmit: (event: React.FormEvent<HTMLFormElement>, conversation: DeepConversationSummary) => void;
  readonly onMenuToggle: (conversationId: string) => void;
  readonly onTogglePinned: (conversation: DeepConversationSummary) => void;
  readonly onDelete: (conversation: DeepConversationSummary) => void;
}): React.ReactElement {
  const [expandedRunGroupKeys, setExpandedRunGroupKeys] = React.useState<ReadonlySet<string>>(() => new Set());
  const conversations = [...(props.conversations.length > 0
    ? props.conversations
    : props.fallbackRuns.map(deepConversationSummaryFromRun))]
    .sort(compareSidebarDeepConversations);
  if (conversations.length === 0) {
    return <SidebarEmptyState label="暂无 Agent 集群任务" />;
  }
  const pinnedConversations = conversations.filter((conversation) => conversation.pinnedAt !== undefined);
  const recentConversations = conversations.filter((conversation) => conversation.pinnedAt === undefined);
  function toggleRunGroupExpanded(groupKey: string): void {
    setExpandedRunGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }
  const groups = groupSidebarItemsByWorkspaceFolder(recentConversations, sidebarDeepConversationTime);
  return (
    <>
      {pinnedConversations.length > 0 && (
        <DeepConversationFolderGroup
          groupKey="__pinned__"
          label="置顶"
          conversations={pinnedConversations}
          expanded
          activeDeepConversationId={props.activeDeepConversationId}
          activeDeepRunId={props.activeDeepRunId}
          collapsed={props.collapsed}
          editingConversationId={props.editingConversationId}
          editingTitle={props.editingTitle}
          openMenuConversationId={props.openMenuConversationId}
          pinningConversationIds={props.pinningConversationIds}
          setEditingTitle={props.setEditingTitle}
          onOpenConversation={props.onOpenConversation}
          onOpenRun={props.onOpenRun}
          onRenameStart={props.onRenameStart}
          onRenameCancel={props.onRenameCancel}
          onRenameCommit={props.onRenameCommit}
          onRenameSubmit={props.onRenameSubmit}
          onMenuToggle={props.onMenuToggle}
          onTogglePinned={props.onTogglePinned}
          onDelete={props.onDelete}
          onToggleExpanded={toggleRunGroupExpanded}
        />
      )}
      {groups.map((group) => (
        <DeepConversationFolderGroup
          key={group.key}
          groupKey={group.key}
          label={group.label}
          path={group.path}
          conversations={group.items}
          expanded={expandedRunGroupKeys.has(group.key)}
          activeDeepConversationId={props.activeDeepConversationId}
          activeDeepRunId={props.activeDeepRunId}
          collapsed={props.collapsed}
          editingConversationId={props.editingConversationId}
          editingTitle={props.editingTitle}
          openMenuConversationId={props.openMenuConversationId}
          pinningConversationIds={props.pinningConversationIds}
          setEditingTitle={props.setEditingTitle}
          onOpenConversation={props.onOpenConversation}
          onOpenRun={props.onOpenRun}
          onRenameStart={props.onRenameStart}
          onRenameCancel={props.onRenameCancel}
          onRenameCommit={props.onRenameCommit}
          onRenameSubmit={props.onRenameSubmit}
          onMenuToggle={props.onMenuToggle}
          onTogglePinned={props.onTogglePinned}
          onDelete={props.onDelete}
          onToggleExpanded={toggleRunGroupExpanded}
        />
      ))}
    </>
  );
}

function DeepConversationFolderGroup(props: {
  readonly groupKey: string;
  readonly label: string;
  readonly path?: string;
  readonly conversations: readonly DeepConversationSummary[];
  readonly expanded: boolean;
  readonly activeDeepConversationId?: string;
  readonly activeDeepRunId?: string;
  readonly collapsed: boolean;
  readonly editingConversationId?: string;
  readonly editingTitle: string;
  readonly openMenuConversationId?: string;
  readonly pinningConversationIds: ReadonlySet<string>;
  readonly setEditingTitle: (title: string) => void;
  readonly onOpenConversation: (conversationId: string) => void;
  readonly onOpenRun: (runId: string) => void;
  readonly onRenameStart: (conversation: DeepConversationSummary) => void;
  readonly onRenameCancel: () => void;
  readonly onRenameCommit: (conversation: DeepConversationSummary) => void;
  readonly onRenameSubmit: (event: React.FormEvent<HTMLFormElement>, conversation: DeepConversationSummary) => void;
  readonly onMenuToggle: (conversationId: string) => void;
  readonly onTogglePinned: (conversation: DeepConversationSummary) => void;
  readonly onDelete: (conversation: DeepConversationSummary) => void;
  readonly onToggleExpanded: (groupKey: string) => void;
}): React.ReactElement {
  const canExpand = props.groupKey !== "__pinned__" && props.conversations.length > DEFAULT_FOLDER_CONVERSATION_LIMIT;
  const visibleConversations = canExpand && !props.expanded
    ? props.conversations.slice(0, DEFAULT_FOLDER_CONVERSATION_LIMIT)
    : props.conversations;
  const hiddenCount = props.conversations.length - visibleConversations.length;
  return (
    <div className="sidebar-conversation-group sidebar-deep-run-group">
      <SidebarFolderHeading title={props.label} titlePath={props.path} />
      {visibleConversations.map((conversation) => (
        <DeepConversationListItem
          key={conversation.conversationId}
          conversation={conversation}
          active={isDeepConversationActive(conversation, {
            activeConversationId: props.activeDeepConversationId,
            activeRunId: props.activeDeepRunId,
          })}
          collapsed={props.collapsed}
          editing={conversation.conversationId === props.editingConversationId}
          editingTitle={props.editingTitle}
          menuOpen={conversation.conversationId === props.openMenuConversationId}
          pinning={props.pinningConversationIds.has(conversation.conversationId)}
          setEditingTitle={props.setEditingTitle}
          onOpenConversation={props.onOpenConversation}
          onOpenRun={props.onOpenRun}
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
          aria-expanded={props.expanded}
          tabIndex={props.collapsed ? -1 : 0}
          onClick={() => props.onToggleExpanded(props.groupKey)}
        >
          {props.expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          <span>{props.expanded ? "收起" : `展开 ${hiddenCount} 个`}</span>
        </button>
      )}
    </div>
  );
}

function DeepConversationListItem(props: {
  readonly conversation: DeepConversationSummary;
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly editing: boolean;
  readonly editingTitle: string;
  readonly menuOpen: boolean;
  readonly pinning: boolean;
  readonly setEditingTitle: (title: string) => void;
  readonly onOpenConversation: (conversationId: string) => void;
  readonly onOpenRun: (runId: string) => void;
  readonly onRenameStart: (conversation: DeepConversationSummary) => void;
  readonly onRenameCancel: () => void;
  readonly onRenameCommit: (conversation: DeepConversationSummary) => void;
  readonly onRenameSubmit: (event: React.FormEvent<HTMLFormElement>, conversation: DeepConversationSummary) => void;
  readonly onMenuToggle: (conversationId: string) => void;
  readonly onTogglePinned: (conversation: DeepConversationSummary) => void;
  readonly onDelete: (conversation: DeepConversationSummary) => void;
}): React.ReactElement {
  const latestRun = props.conversation.latestRun;
  const statusClass = deepConversationStatusClass(props.conversation);
  const title = props.conversation.titleEditedAt === undefined
    ? props.conversation.currentObjective ?? props.conversation.title
    : props.conversation.title;
  const label = deepConversationStatusLabel(props.conversation);
  const timestamp = latestRun?.updatedAt ?? props.conversation.updatedAt;
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const [menuPosition, setMenuPosition] = React.useState<React.CSSProperties | undefined>();
  const pinned = props.conversation.pinnedAt !== undefined;
  const deleteDisabled = conversationHasActiveDeepWork(props.conversation);

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
    <div className={`sidebar-recent-item sidebar-deep-run-item ${props.active ? "active" : ""} ${props.editing ? "editing" : ""} ${props.menuOpen ? "menu-open" : ""}`}>
      {props.editing ? (
        <SidebarRenameForm
          inputRef={renameInputRef}
          editingTitle={props.editingTitle}
          setEditingTitle={props.setEditingTitle}
          onRenameCancel={props.onRenameCancel}
          onRenameCommit={() => props.onRenameCommit(props.conversation)}
          onRenameSubmit={(event) => props.onRenameSubmit(event, props.conversation)}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              if (latestRun !== undefined) {
                props.onOpenRun(latestRun.runId);
              } else {
                props.onOpenConversation(props.conversation.conversationId);
              }
            }}
            className="sidebar-recent-row sidebar-deep-run-row"
            aria-label={title}
            tabIndex={props.collapsed ? -1 : 0}
          >
            <span className={`sidebar-deep-run-status sidebar-deep-run-status-${statusClass}`} aria-hidden="true" />
            <span className="sidebar-conversation-copy sidebar-deep-run-copy">
              <strong>{compact(title, 34)}</strong>
              <small>{label} · {sidebarDeepRunTimeLabel(timestamp)}</small>
            </span>
          </button>
          {!props.collapsed && (
            <SidebarConversationMenu
              ownerId={props.conversation.conversationId}
              menuButtonRef={menuButtonRef}
              menuOpen={props.menuOpen}
              menuPosition={menuPosition}
              pinned={pinned}
              pinning={props.pinning}
              deleteDisabled={deleteDisabled}
              onMenuToggle={props.onMenuToggle}
              onRenameStart={() => props.onRenameStart(props.conversation)}
              onTogglePinned={() => props.onTogglePinned(props.conversation)}
              onDelete={() => props.onDelete(props.conversation)}
            />
          )}
        </>
      )}
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
  readonly pinningConversationIds: ReadonlySet<string>;
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
          pinning={props.pinningConversationIds.has(conversation.conversationId)}
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
  readonly pinning: boolean;
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
        <SidebarRenameForm
          inputRef={renameInputRef}
          editingTitle={props.editingTitle}
          setEditingTitle={props.setEditingTitle}
          onRenameCancel={props.onRenameCancel}
          onRenameCommit={() => props.onRenameCommit(props.conversation)}
          onRenameSubmit={(event) => props.onRenameSubmit(event, props.conversation)}
        />
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
            <SidebarConversationMenu
              ownerId={props.conversation.conversationId}
              menuButtonRef={menuButtonRef}
              menuOpen={props.menuOpen}
              menuPosition={menuPosition}
              pinned={pinned}
              pinning={props.pinning}
              deleteDisabled={deleteDisabled}
              onMenuToggle={props.onMenuToggle}
              onRenameStart={() => props.onRenameStart(props.conversation)}
              onTogglePinned={() => props.onTogglePinned(props.conversation)}
              onDelete={() => props.onDelete(props.conversation)}
            />
          )}
        </>
      )}
    </div>
  );
}

function SidebarRenameForm(props: {
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly editingTitle: string;
  readonly setEditingTitle: (title: string) => void;
  readonly onRenameCancel: () => void;
  readonly onRenameCommit: () => void;
  readonly onRenameSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}): React.ReactElement {
  return (
    <form
      className="sidebar-rename-form"
      onSubmit={props.onRenameSubmit}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        props.onRenameCommit();
      }}
    >
      <input
        ref={props.inputRef}
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
  );
}

function SidebarConversationMenu(props: {
  readonly ownerId: string;
  readonly menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly menuOpen: boolean;
  readonly menuPosition?: React.CSSProperties;
  readonly pinned: boolean;
  readonly pinning: boolean;
  readonly deleteDisabled: boolean;
  readonly onMenuToggle: (conversationId: string) => void;
  readonly onRenameStart: () => void;
  readonly onTogglePinned: () => void;
  readonly onDelete: () => void;
}): React.ReactElement {
  return (
    <div className="sidebar-menu-wrap" data-sidebar-menu-owner={props.ownerId}>
      <button
        ref={props.menuButtonRef}
        type="button"
        className="sidebar-kebab-button"
        aria-label="会话操作"
        aria-haspopup="menu"
        aria-expanded={props.menuOpen}
        onClick={() => props.onMenuToggle(props.ownerId)}
      >
        <EllipsisVertical size={17} />
      </button>
      {props.menuOpen && (
        <div className="sidebar-conversation-menu" role="menu" style={props.menuPosition}>
          <button type="button" role="menuitem" onClick={props.onRenameStart}>
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={props.pinning}
            onClick={props.onTogglePinned}
          >
            {props.pinning ? "更新中" : props.pinned ? "取消置顶" : "置顶"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={props.deleteDisabled}
            onClick={props.onDelete}
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}

function sidebarConversationTime(conversation: ConversationSummary): number {
  const time = Date.parse(conversation.updatedAt ?? "");
  return Number.isFinite(time) ? time : 0;
}

function sidebarDeepConversationTime(conversation: DeepConversationSummary): number {
  const time = Date.parse(conversation.updatedAt);
  return Number.isFinite(time) ? time : 0;
}

function deepConversationSummaryFromRun(run: DeepRunSummary): DeepConversationSummary {
  return {
    conversationId: run.conversationId,
    title: run.goal,
    goal: run.goal,
    createdAt: run.startedAt,
    updatedAt: run.updatedAt,
    workspaceFolder: run.workspaceFolder,
    latestRun: run,
  };
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

function compareSidebarDeepConversations(left: DeepConversationSummary, right: DeepConversationSummary): number {
  const pinned = (right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? "");
  return pinned === 0 ? sidebarDeepConversationDisplayTime(right) - sidebarDeepConversationDisplayTime(left) : pinned;
}

function deepRunRuntimeHealthLabel(state: DeepRunRuntimeHealthState): string {
  switch (state) {
    case "active":
      return "运行中";
    case "stalled":
      return "暂无新进展";
    case "orphaned":
      return "已失联";
    case "terminal":
      return "已结束";
    default:
      return state;
  }
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

function deepIntakeStatusLabel(status: DeepIntakeStatus): string {
  switch (status) {
    case "needs_input":
      return "待补充";
    case "answered":
      return "已回答";
    case "plan_ready":
      return "计划待确认";
    case "running":
      return "运行中";
    default:
      return status;
  }
}

function deepConversationStatusLabel(conversation: DeepConversationSummary): string {
  const latestRun = conversation.latestRun;
  if (latestRun !== undefined) {
    const health = latestRun.runtimeHealth?.state;
    if (health !== undefined && health !== "terminal") {
      return deepRunRuntimeHealthLabel(health);
    }
    return deepRunStatusLabel(latestRun.status);
  }
  return deepIntakeStatusLabel(conversation.intakeStatus ?? "needs_input");
}

function deepConversationStatusClass(conversation: DeepConversationSummary): string {
  const latestRun = conversation.latestRun;
  if (latestRun !== undefined) {
    const health = latestRun.runtimeHealth?.state;
    if (health !== undefined && health !== "terminal") {
      return health;
    }
    return latestRun.status;
  }
  return conversation.intakeStatus ?? "needs_input";
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

function conversationHasActiveDeepWork(conversation: DeepConversationSummary): boolean {
  if (conversation.intakeStatus === "running") {
    return true;
  }
  const latestRun = conversation.latestRun;
  if (latestRun === undefined || isTerminalDeepConversationStatus(latestRun.status)) {
    return false;
  }
  const health = latestRun.runtimeHealth?.state;
  return health === undefined || health === "active" || health === "stalled";
}

function sidebarDeepConversationDisplayTime(conversation: DeepConversationSummary): number {
  return Math.max(
    sidebarDeepConversationTime(conversation),
    timestampValue(conversation.titleEditedAt),
    timestampValue(conversation.pinnedAt),
  );
}

function timestampValue(timestamp: string | undefined): number {
  if (timestamp === undefined) {
    return 0;
  }
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : 0;
}

function isTerminalDeepConversationStatus(status: DeepRunStatus): boolean {
  return status === "completed" ||
    status === "failed" ||
    status === "interrupted" ||
    status === "stopped" ||
    status === "corrected";
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
