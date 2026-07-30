import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileOutput,
  Folder,
  FolderPlus,
  Globe2,
  Link2,
  MessagesSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import "./personal-space-surface.css";

/**
 * Presentation projection for a Space-owned object. A reference remains a
 * reference: the panel must never copy a local file, web source, or Ordinary
 * conversation into a second client-side store.
 */
export type PersonalSpaceItemProjection = {
  readonly itemId: string;
  readonly title: string;
  readonly kind:
    | "folder"
    | "local_file"
    | "workspace_folder"
    | "managed_folder"
    | "web_reference"
    | "generated_artifact"
    | "conversation_reference";
  readonly detail?: string;
  readonly updatedAtLabel?: string;
  /** Only references with a host-backed open action are rendered as links. */
  readonly openable?: boolean;
  readonly conversationId?: string;
  readonly openUrl?: string;
  /** Stable reference identity for file-system-backed items; undefined for internal folders and non-fs references. */
  readonly referenceId?: string;
  readonly children?: readonly PersonalSpaceItemProjection[];
};

/** A read-only projection supplied by the Space feature facade. */
export type PersonalSpaceProjection = {
  readonly spaceId: string;
  readonly title: string;
  readonly itemCount?: number;
  readonly description?: string;
  readonly color?: string;
  /** Marks the fixed built-in dataset without changing its original contents. */
  readonly demoDataset?: "learning-workspace";
  readonly items: readonly PersonalSpaceItemProjection[];
};

export type PersonalSpaceActions = {
  /** Creates an app-owned folder backed by a real directory. */
  readonly createManagedFolder?: (spaceId: string, title: string) => void | Promise<void>;
  /** Opens a host-owned local-file picker, then adds the selected file as a reference. */
  readonly addLocalFile?: (spaceId: string) => void | Promise<void>;
  /** Opens a host-owned directory picker, then adds the selection as a reference. */
  readonly addWorkspaceFolder?: (spaceId: string) => void | Promise<void>;
  /** Adds a validated web-page reference without fetching or copying its content. */
  readonly addWebReference?: (spaceId: string, title: string, url: string) => void | Promise<void>;
  /** Adds an explicit reference to the current Ordinary conversation, if one exists. */
  readonly addConversation?: (spaceId: string, conversationId: string, title: string) => void | Promise<void>;
  readonly move?: (
    sourceSpaceId: string,
    target: { readonly kind: "reference"; readonly id: string },
    destinationSpaceId: string,
  ) => void | Promise<void>;
  readonly rename?: (target: PersonalSpaceRenameTarget, title: string) => void | Promise<void>;
  /** Removes non-file references, or physically deletes a linked local file. */
  readonly removeReference?: (itemId: string) => void | Promise<void>;
  /** Deletes an app-owned directory and its contents, then removes its Space reference. */
  readonly deleteManagedFolder?: (itemId: string) => void | Promise<void>;
};

/** Space mutations use its domain distinction, not a display-specific item icon kind. */
export type PersonalSpaceRenameTarget = {
  readonly kind: "space" | "reference";
  readonly id: string;
};

/** The active Ordinary conversation is only eligible for an explicit Space reference. */
export type PersonalSpaceConversationContext = {
  readonly conversationId: string;
  readonly title: string;
};

export type PersonalSpaceSurfaceProps = {
  readonly space: PersonalSpaceProjection;
  /** Invoked by the host when a referenced object has a real open action. */
  readonly onOpenItem?: (spaceId: string, itemId: string) => void;
  /** Commands remain owned by the Space facade; this surface only collects intent. */
  readonly actions?: PersonalSpaceActions;
  /** Omitted when no Ordinary conversation is active; a conversation never becomes a Space member implicitly. */
  readonly currentConversation?: PersonalSpaceConversationContext;
};

type RenameTarget = { readonly itemId: string; readonly title: string; readonly kind: PersonalSpaceRenameTarget["kind"] };

/**
 * A file-system-shaped Space surface. It owns transient disclosure, menus and
 * command feedback only; all tree facts continue to come from SpaceFeature.
 */
export function PersonalSpaceSurface(props: PersonalSpaceSurfaceProps): React.ReactElement {
  const itemCount = countItems(props.space.items);
  const [openActionsFor, setOpenActionsFor] = useState<string | undefined>();
  const [folderTarget, setFolderTarget] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | undefined>();
  const [busyLabel, setBusyLabel] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const actionInFlight = useRef(false);

  const runAction = async (label: string, operation: () => void | Promise<void>): Promise<void> => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyLabel(label);
    setError(undefined);
    try {
      await operation();
      setOpenActionsFor(undefined);
    } catch (reason) {
      setError(actionErrorMessage(reason));
    } finally {
      actionInFlight.current = false;
      setBusyLabel(undefined);
    }
  };

  const canOperate = hasAvailableCreateAction(props.actions, props.currentConversation);

  return (
    <section className="personal-space-surface" aria-label={props.space.title}>
      <header className="personal-space-surface__heading">
        <span className="personal-space-surface__mark" style={{ backgroundColor: props.space.color }} aria-hidden="true" />
        <div>
          <h1>{props.space.title}</h1>
          {props.space.description !== undefined && <p>{props.space.description}</p>}
        </div>
        {canOperate && (
          <SpaceActionMenu
            menuId="space-root-actions"
            spaceId={props.space.spaceId}
            actions={props.actions}
            currentConversation={props.currentConversation}
            open={openActionsFor === "space-root-actions"}
            busy={busyLabel !== undefined}
            onToggle={() => setOpenActionsFor((current) => current === "space-root-actions" ? undefined : "space-root-actions")}
            onCreateFolder={() => { setFolderTarget(true); setOpenActionsFor(undefined); }}
            onRenameSpace={() => { setRenameTarget({ itemId: props.space.spaceId, title: props.space.title, kind: "space" }); setOpenActionsFor(undefined); }}
            onRun={(label, action) => void runAction(label, action)}
          />
        )}
        <span className="personal-space-surface__count">{itemCount} 个对象</span>
      </header>

      {busyLabel !== undefined && <p className="personal-space-surface__feedback" role="status">{busyLabel}</p>}
      {error !== undefined && <p className="personal-space-surface__feedback personal-space-surface__feedback--error" role="alert">{error}</p>}

      {props.space.items.length === 0 ? (
        <div className="personal-space-surface__empty" role="status">这个空间还没有内容。</div>
      ) : (
        <ul className="personal-space-tree" role="tree" aria-label={`${props.space.title}中的内容`}>
          {props.space.items.map((item) => (
            <SpaceTreeItem
              key={item.itemId}
              item={item}
              spaceId={props.space.spaceId}
              onOpenItem={props.onOpenItem}
              actions={props.actions}
              currentConversation={props.currentConversation}
              openActionsFor={openActionsFor}
              busy={busyLabel !== undefined}
              onToggleActions={setOpenActionsFor}
              onRename={(target) => { setRenameTarget(target); setOpenActionsFor(undefined); }}
              onRun={(label, action) => void runAction(label, action)}
            />
          ))}
        </ul>
      )}

      <PersonalSpaceNameDialog
        open={folderTarget}
        title="新建文件夹"
        fieldLabel="名称"
        submitLabel="新建文件夹"
        placeholder="例如：调研材料"
        busy={busyLabel !== undefined}
        error={error}
        onClose={() => setFolderTarget(false)}
        onSubmit={(title) => runAction("正在新建文件夹…", async () => {
          await props.actions?.createManagedFolder?.(props.space.spaceId, title);
          setFolderTarget(false);
        })}
      />
      <PersonalSpaceNameDialog
        open={renameTarget !== undefined}
        title="重命名"
        fieldLabel="名称"
        submitLabel="保存"
        initialValue={renameTarget?.title}
        busy={busyLabel !== undefined}
        error={error}
        onClose={() => setRenameTarget(undefined)}
        onSubmit={(title) => runAction("正在保存名称…", async () => {
          await props.actions?.rename?.({ kind: renameTarget!.kind, id: renameTarget!.itemId }, title);
          setRenameTarget(undefined);
        })}
      />
    </section>
  );
}

function SpaceTreeItem(props: {
  readonly item: PersonalSpaceItemProjection;
  readonly spaceId: string;
  readonly onOpenItem: PersonalSpaceSurfaceProps["onOpenItem"];
  readonly actions: PersonalSpaceActions | undefined;
  readonly currentConversation: PersonalSpaceConversationContext | undefined;
  readonly openActionsFor: string | undefined;
  readonly busy: boolean;
  readonly onToggleActions: (itemId: string | undefined) => void;
  readonly onRename: (target: RenameTarget) => void;
  readonly onRun: (label: string, action: () => void | Promise<void>) => void;
}): React.ReactElement {
  const hasChildren = props.item.children !== undefined && props.item.children.length > 0;
  const [expanded, setExpanded] = useState(true);
  const isFolder = props.item.kind === "workspace_folder" || props.item.kind === "managed_folder";
  const isManagedFolder = props.item.kind === "managed_folder";
  const isLocalFile = props.item.kind === "local_file";
  const canOpen = props.onOpenItem !== undefined && props.item.openable !== false;
  const canOperate = props.actions?.rename !== undefined
    || (isManagedFolder && props.actions?.deleteManagedFolder !== undefined)
    || (!isManagedFolder && props.actions?.removeReference !== undefined);
  const icon = itemIcon(props.item.kind, expanded);
  const itemDetail = props.item.detail ?? itemKindLabel(props.item.kind);
  const menuId = `space-item-actions-${props.item.itemId}`;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div className="personal-space-tree__row" data-folder={isFolder || undefined}>
        <span className="personal-space-tree__indent" aria-hidden="true" />
        {hasChildren ? (
          <button
            type="button"
            className="personal-space-tree__disclosure"
            aria-label={`${expanded ? "收起" : "展开"}${props.item.title}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          </button>
        ) : <span className="personal-space-tree__disclosure" aria-hidden="true" />}
        <span className="personal-space-tree__icon" data-kind={props.item.kind} aria-hidden="true">{icon}</span>
        {canOpen ? (
          <button type="button" className="personal-space-tree__open" onClick={() => props.onOpenItem?.(props.spaceId, props.item.itemId)}>
            {props.item.title}
          </button>
        ) : <span className="personal-space-tree__name">{props.item.title}</span>}
        <span className="personal-space-tree__detail">{itemDetail}</span>
        {props.item.updatedAtLabel !== undefined && <time className="personal-space-tree__time">{props.item.updatedAtLabel}</time>}
        {canOperate && (
          <div className="personal-space-tree__actions">
            <button
              type="button"
              className="personal-space-tree__more"
              aria-label={`${props.item.title}操作`}
              aria-expanded={props.openActionsFor === menuId}
              disabled={props.busy}
              onClick={() => props.onToggleActions(props.openActionsFor === menuId ? undefined : menuId)}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
            {props.openActionsFor === menuId && (
              <div className="personal-space-action-menu personal-space-action-menu--row" role="menu" aria-label={`${props.item.title}操作`}>
                {props.actions?.rename !== undefined && (
                  <button type="button" role="menuitem" onClick={() => props.onRename({ itemId: props.item.itemId, title: props.item.title, kind: "reference" })}>
                    <Pencil size={15} aria-hidden="true" />重命名
                  </button>
                )}
                {isManagedFolder && props.actions?.deleteManagedFolder !== undefined && (
                  <button type="button" role="menuitem" className="personal-space-action-menu__danger" onClick={() => props.onRun("正在删除文件夹…", () => props.actions?.deleteManagedFolder?.(props.item.itemId))}>
                    <Trash2 size={15} aria-hidden="true" />删除文件夹
                  </button>
                )}
                {!isManagedFolder && props.actions?.removeReference !== undefined && (
                  <button type="button" role="menuitem" className="personal-space-action-menu__danger" onClick={() => props.onRun(isLocalFile ? "正在删除文件…" : "正在移除引用…", () => props.actions?.removeReference?.(props.item.itemId))}>
                    <Trash2 size={15} aria-hidden="true" />{isLocalFile ? "删除" : "取消链接"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {hasChildren && expanded && (
        <ul role="group" className="personal-space-tree__children">
          {props.item.children!.map((child) => (
            <SpaceTreeItem key={child.itemId} {...props} item={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function SpaceActionMenu(props: {
  readonly menuId: string;
  readonly spaceId: string;
  readonly actions: PersonalSpaceActions | undefined;
  readonly currentConversation: PersonalSpaceConversationContext | undefined;
  readonly open: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onCreateFolder: () => void;
  readonly onRenameSpace: () => void;
  readonly onRun: (label: string, action: () => void | Promise<void>) => void;
}): React.ReactElement {
  return (
    <div className="personal-space-actions">
      <button
        type="button"
        className="personal-space-actions__trigger"
        aria-label="空间操作"
        aria-expanded={props.open}
        aria-controls={props.menuId}
        disabled={props.busy}
        onClick={props.onToggle}
      >
        <Plus size={16} aria-hidden="true" />添加
      </button>
      {props.open && (
        <div id={props.menuId} className="personal-space-action-menu" role="menu" aria-label="空间操作">
          <SpaceActionMenuItems {...props} />
        </div>
      )}
    </div>
  );
}

function SpaceActionMenuItems(props: {
  readonly spaceId: string;
  readonly actions: PersonalSpaceActions | undefined;
  readonly currentConversation: PersonalSpaceConversationContext | undefined;
  readonly onCreateFolder: () => void;
  readonly onRenameSpace: () => void;
  readonly onRun: (label: string, action: () => void | Promise<void>) => void;
}): React.ReactElement {
  return (
    <>
      {props.actions?.createManagedFolder !== undefined && (
        <button type="button" role="menuitem" onClick={props.onCreateFolder}>
          <FolderPlus size={15} aria-hidden="true" />新建文件夹
        </button>
      )}
      {props.actions?.rename !== undefined && (
        <button type="button" role="menuitem" onClick={props.onRenameSpace}>
          <Pencil size={15} aria-hidden="true" />重命名空间
        </button>
      )}
      {props.actions?.addLocalFile !== undefined && (
        <button type="button" role="menuitem" onClick={() => props.onRun("正在选择本地文件…", () => props.actions?.addLocalFile?.(props.spaceId))}>
          <Paperclip size={15} aria-hidden="true" />添加本地文件
        </button>
      )}
      {props.actions?.addWorkspaceFolder !== undefined && (
        <button type="button" role="menuitem" onClick={() => props.onRun("正在选择工作区文件夹…", () => props.actions?.addWorkspaceFolder?.(props.spaceId))}>
          <Folder size={15} aria-hidden="true" />添加工作区文件夹
        </button>
      )}
      {props.actions?.addConversation !== undefined && props.currentConversation !== undefined && (
        <button type="button" role="menuitem" onClick={() => props.onRun("正在加入当前对话…", () => props.actions?.addConversation?.(props.spaceId, props.currentConversation!.conversationId, props.currentConversation!.title))}>
          <Link2 size={15} aria-hidden="true" />加入当前对话
        </button>
      )}
    </>
  );
}

function PersonalSpaceNameDialog(props: {
  readonly open: boolean;
  readonly title: string;
  readonly fieldLabel: string;
  readonly submitLabel: string;
  readonly placeholder?: string;
  readonly initialValue?: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onSubmit: (title: string) => void | Promise<void>;
}): React.ReactElement | null {
  const [value, setValue] = useState("");
  const labelId = useId();
  const normalizedValue = value.trim();

  useEffect(() => {
    if (props.open) setValue(props.initialValue ?? "");
  }, [props.open, props.initialValue]);

  useEffect(() => {
    if (!props.open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props]);

  if (!props.open) return null;

  return (
    <div className="personal-create-space-dialog" role="presentation">
      <div className="personal-create-space-dialog__backdrop" aria-hidden="true" />
      <form
        className="personal-create-space-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onSubmit={(event) => {
          event.preventDefault();
          if (normalizedValue.length > 0) void props.onSubmit(normalizedValue);
        }}
      >
        <div className="personal-create-space-dialog__heading">
          <h2 id={labelId}>{props.title}</h2>
        </div>
        <label className="personal-create-space-dialog__field">
          <span>{props.fieldLabel}</span>
          <input autoFocus value={value} placeholder={props.placeholder} disabled={props.busy} onChange={(event) => setValue(event.target.value)} />
        </label>
        {props.error !== undefined && <p className="personal-create-space-dialog__error" role="alert">{props.error}</p>}
        <footer className="personal-create-space-dialog__actions">
          <button type="button" disabled={props.busy} onClick={props.onClose}>取消</button>
          <button type="submit" disabled={normalizedValue.length === 0 || props.busy}>{props.submitLabel}</button>
        </footer>
      </form>
    </div>
  );
}

function hasAvailableCreateAction(
  actions: PersonalSpaceActions | undefined,
  currentConversation: PersonalSpaceConversationContext | undefined,
): boolean {
  return actions?.rename !== undefined
    || actions?.createManagedFolder !== undefined
    || actions?.addLocalFile !== undefined
    || actions?.addWorkspaceFolder !== undefined
    || (actions?.addConversation !== undefined && currentConversation !== undefined);
}

function actionErrorMessage(reason: unknown): string {
  return reason instanceof Error && reason.message.trim().length > 0 ? reason.message : "操作没有完成，请重试。";
}

function itemIcon(kind: PersonalSpaceItemProjection["kind"], expanded: boolean): ReactNode {
  switch (kind) {
    case "folder":
    case "workspace_folder":
    case "managed_folder":
      return <Folder size={16} fill={expanded ? "currentColor" : undefined} />;
    case "local_file":
      return <File size={16} />;
    case "web_reference":
      return <Globe2 size={16} />;
    case "generated_artifact":
      return <FileOutput size={16} />;
    case "conversation_reference":
      return <MessagesSquare size={16} />;
    default:
      return <FileCode2 size={16} />;
  }
}

function itemKindLabel(kind: PersonalSpaceItemProjection["kind"]): string {
  switch (kind) {
    case "folder": return "文件夹";
    case "workspace_folder": return "工作区文件夹";
    case "managed_folder": return "软件文件夹";
    case "local_file": return "本地文件";
    case "web_reference": return "网页引用";
    case "generated_artifact": return "生成内容";
    case "conversation_reference": return "对话引用";
  }
}

function countItems(items: readonly PersonalSpaceItemProjection[]): number {
  return items.reduce((total, item) => total + 1 + countItems(item.children ?? []), 0);
}
