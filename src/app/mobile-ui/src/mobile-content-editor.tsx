import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleAlert,
  ChevronRight,
  Copy,
  Ellipsis,
  Trash2,
  X,
} from "lucide-react";

import type { ContentVaultResource } from "../../content-vault/contracts";
import type { MobileVaultConflict } from "./storage";
import {
  conflictPresentation,
  contentContext,
  contentFromResource,
  updatedTextPayload,
  type VaultContentItem,
} from "./vault-projection";
import { errorMessage } from "./mobile-error";
import { formatRelativeTime } from "./mobile-format";
import { IconButton, Notice } from "./mobile-ui-primitives";
import { useModalFocus } from "./use-modal-focus";
import type { MobileRemoteState, RemoteMobileClient } from "./remote-client";

type EditorDraft = { readonly title: string; readonly text: string };
type EditorConflictResolution = { readonly draft?: EditorDraft; readonly revision?: number; readonly close?: boolean };
type EditorOperation = "save" | "delete" | "conflict";
type EditorOperationError = { readonly kind: EditorOperation; readonly message: string };
type EditorActionLayer = "menu" | "confirm_delete" | "conflict" | "deleted_draft";
type EditorStatusIndicator = {
  readonly label: "已删除" | "保存失败" | "删除失败" | "同步失败" | "正在保存" | "正在删除" | "正在同步" | "已保存" | "已同步";
  readonly tone: "attention" | "error" | "progress" | "quiet";
};

function editorStatusIndicator(input: {
  readonly deleted: boolean;
  readonly errorKind?: EditorOperationError["kind"];
  readonly operation?: EditorOperation;
  readonly savedStatus?: "saved" | "synced";
}): EditorStatusIndicator | undefined {
  if (input.deleted) return { label: "已删除", tone: "attention" };
  if (input.errorKind !== undefined) {
    const label = input.errorKind === "save" ? "保存失败" : input.errorKind === "delete" ? "删除失败" : "同步失败";
    return { label, tone: "error" };
  }
  if (input.operation !== undefined) {
    const label = input.operation === "save" ? "正在保存" : input.operation === "delete" ? "正在删除" : "正在同步";
    return { label, tone: "progress" };
  }
  if (input.savedStatus === "synced") return { label: "已同步", tone: "quiet" };
  if (input.savedStatus === "saved") return { label: "已保存", tone: "quiet" };
  return undefined;
}

export function MobileContentEditorHost(props: {
  readonly client: RemoteMobileClient;
  readonly state: MobileRemoteState;
  readonly item?: VaultContentItem;
  readonly onClose: () => void;
}) {
  const latestResource = props.item?.resource === undefined
    ? undefined
    : props.state.vaultResources.find((resource) =>
      resource.kind === props.item?.resource?.kind
      && resource.resourceId === props.item?.resource.resourceId);
  const pendingMutation = props.item?.resource === undefined
    ? undefined
    : props.state.vaultOutbox?.find((entry) =>
      entry.mutation.kind === props.item?.resource?.kind
      && entry.mutation.resourceId === props.item?.resource.resourceId,
    );
  const synchronizedItem = props.item === undefined || latestResource === undefined
    ? props.item
    : latestResource.deleted
      ? { ...props.item, resource: latestResource }
      : pendingMutation === undefined
        ? contentFromResource(latestResource)
        : { ...props.item, resource: latestResource, pending: true };
  const conflict = synchronizedItem?.resource === undefined
    ? undefined
    : props.state.vaultConflicts.find((candidate) => candidate.mutation.kind === synchronizedItem.resource?.kind
      && candidate.mutation.resourceId === synchronizedItem.resource.resourceId);

  if (synchronizedItem === undefined || synchronizedItem.resource === undefined || synchronizedItem.value === undefined) return null;
  const editableItem = synchronizedItem as VaultContentItem & { readonly resource: ContentVaultResource; readonly value: string };
  const conflictState = conflict === undefined ? undefined : conflictPresentation(conflict);
  const conflictDraft = conflict?.mutation.operation === "upsert" && conflictState?.localContent !== undefined
    ? { title: conflictState.title, text: conflictState.localContent }
    : undefined;

  const saveItem = async (
    item: VaultContentItem & { readonly resource: ContentVaultResource },
    draft: EditorDraft,
    baseRevision: number,
  ): Promise<number> => {
    if (item.resource.payload === undefined) return baseRevision;
    await props.client.submitVaultMutation({
      kind: item.resource.kind,
      resourceId: item.resource.resourceId,
      baseRevision,
      operation: "upsert",
      payloadSchemaVersion: 1,
      payload: updatedTextPayload(item.resource, draft.text, baseRevision, draft.title),
    });
    return baseRevision + 1;
  };
  const save = (draft: EditorDraft, baseRevision: number): Promise<number> => saveItem(editableItem, draft, baseRevision);

  const remove = async (baseRevision: number): Promise<void> => {
    await props.client.submitVaultMutation({
      kind: editableItem.resource.kind,
      resourceId: editableItem.resource.resourceId,
      baseRevision,
      operation: "delete",
    });
  };

  const resolveConflict = async (
    currentConflict: MobileVaultConflict,
    resolution: "accept_remote" | "retry_local",
    draft: EditorDraft,
  ): Promise<EditorConflictResolution> => {
    if (resolution === "accept_remote") {
      await props.client.resolveVaultConflict(currentConflict.mutationId, "accept_remote");
      if (currentConflict.current === undefined || currentConflict.current.deleted) return { close: true };
      const currentItem = contentFromResource(currentConflict.current);
      return {
        draft: { title: currentItem.title, text: currentItem.value ?? "" },
        revision: currentConflict.current.revision,
      };
    }
    if (currentConflict.current === undefined || currentConflict.current.deleted) {
      throw new Error("电脑端已删除这项内容，无法直接覆盖");
    }
    await props.client.resolveVaultConflict(currentConflict.mutationId, "accept_remote");
    const currentItem = contentFromResource(currentConflict.current) as VaultContentItem & { readonly resource: ContentVaultResource };
    const revision = await saveItem(currentItem, draft, currentConflict.current.revision);
    return { draft, revision };
  };

  return (
    <VaultEditorSheet
      item={editableItem}
      context={contentContext(props.state, editableItem)}
      conflict={conflict}
      {...(conflictDraft === undefined ? {} : { initialDraft: conflictDraft })}
      onClose={props.onClose}
      onSave={save}
      onResolveConflict={resolveConflict}
      {...(editableItem.resource.kind === "workbench_asset" || editableItem.resource.deleted
        ? {}
        : { onDelete: remove })}
    />
  );
}

function VaultEditorSheet(props: {
  readonly item: VaultContentItem & { readonly resource: ContentVaultResource; readonly value: string };
  readonly context: ReturnType<typeof contentContext>;
  readonly conflict?: MobileVaultConflict;
  readonly initialDraft?: EditorDraft;
  readonly onClose: () => void;
  readonly onSave: (draft: EditorDraft, baseRevision: number) => Promise<number>;
  readonly onResolveConflict: (
    conflict: MobileVaultConflict,
    resolution: "accept_remote" | "retry_local",
    draft: EditorDraft,
  ) => Promise<EditorConflictResolution>;
  readonly onDelete?: (baseRevision: number) => Promise<void>;
}) {
  const [title, setTitle] = useState(props.initialDraft?.title ?? props.item.title);
  const [savedTitle, setSavedTitle] = useState(props.initialDraft?.title ?? props.item.title);
  const [text, setText] = useState(props.initialDraft?.text ?? props.item.value);
  const [savedText, setSavedText] = useState(props.initialDraft?.text ?? props.item.value);
  const [revision, setRevision] = useState(props.item.resource.revision);
  const [activeOperation, setActiveOperation] = useState<EditorOperation>();
  const [savedStatus, setSavedStatus] = useState<"saved" | "synced">();
  const [remoteAttention, setRemoteAttention] = useState<string>();
  const [operationError, setOperationError] = useState<EditorOperationError>();
  const [actionLayer, setActionLayer] = useState<EditorActionLayer>();
  const saveRef = useRef(props.onSave);
  const activeOperationRef = useRef<EditorOperation | undefined>(undefined);
  const dirty = title !== savedTitle || text !== savedText;
  const statusIndicator = editorStatusIndicator({
    deleted: props.item.resource.deleted,
    ...(operationError === undefined ? {} : { errorKind: operationError.kind }),
    ...(activeOperation === undefined ? {} : { operation: activeOperation }),
    ...(savedStatus === undefined ? {} : { savedStatus }),
  });
  const dialogRef = useModalFocus<HTMLElement>(() => {
    if (activeOperationRef.current === undefined) void close();
  });

  useEffect(() => {
    saveRef.current = props.onSave;
  }, [props.onSave]);

  useEffect(() => {
    if (props.item.resource.deleted || props.conflict !== undefined) return;
    const incomingRevision = props.item.resource.revision;
    if (incomingRevision <= revision || activeOperation !== undefined) return;
    const incomingDraft = { title: props.item.title, text: props.item.value };
    if (!dirty) {
      setTitle(incomingDraft.title);
      setSavedTitle(incomingDraft.title);
      setText(incomingDraft.text);
      setSavedText(incomingDraft.text);
      setRevision(incomingRevision);
      setSavedStatus("synced");
      setRemoteAttention(undefined);
      setOperationError(undefined);
    } else {
      setRemoteAttention("另一台设备有更新，已保留当前编辑");
    }
  }, [activeOperation, dirty, props.conflict, props.item.resource.deleted, props.item.resource.revision, props.item.title, props.item.value, revision]);

  useEffect(() => {
    if (savedStatus === undefined) return;
    const timer = window.setTimeout(() => setSavedStatus(undefined), 1_200);
    return () => window.clearTimeout(timer);
  }, [savedStatus]);

  useEffect(() => {
    if (props.item.resource.deleted || props.conflict !== undefined || !dirty || activeOperation !== undefined || operationError !== undefined) return;
    const timer = window.setTimeout(() => {
      const draft = { title, text };
      activeOperationRef.current = "save";
      setActiveOperation("save");
      setOperationError(undefined);
      void saveRef.current(draft, revision).then((nextRevision) => {
        setRevision(nextRevision);
        setSavedTitle(draft.title);
        setSavedText(draft.text);
        setSavedStatus("saved");
      }).catch((cause: unknown) => {
        setOperationError({ kind: "save", message: errorMessage(cause, "无法保存修改") });
      }).finally(() => {
        activeOperationRef.current = undefined;
        setActiveOperation(undefined);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeOperation, dirty, operationError, props.conflict, props.item.resource.deleted, revision, text, title]);

  const close = async (): Promise<void> => {
    if (activeOperationRef.current !== undefined) return;
    if (props.item.resource.deleted && dirty) {
      setOperationError(undefined);
      setActionLayer("deleted_draft");
      return;
    }
    if (props.conflict !== undefined && dirty) {
      setOperationError(undefined);
      setActionLayer("conflict");
      return;
    }
    if (props.item.resource.deleted || !dirty) {
      props.onClose();
      return;
    }
    activeOperationRef.current = "save";
    setActiveOperation("save");
    setOperationError(undefined);
    try {
      await saveRef.current({ title, text }, revision);
      props.onClose();
    } catch (cause) {
      setOperationError({ kind: "save", message: errorMessage(cause, "无法保存修改") });
      activeOperationRef.current = undefined;
      setActiveOperation(undefined);
    }
  };

  const remove = async (): Promise<void> => {
    if (activeOperationRef.current !== undefined || props.onDelete === undefined) return;
    activeOperationRef.current = "delete";
    setActiveOperation("delete");
    setOperationError(undefined);
    try {
      await props.onDelete(revision);
      props.onClose();
    } catch (cause) {
      setOperationError({ kind: "delete", message: errorMessage(cause, "无法删除内容") });
      activeOperationRef.current = undefined;
      setActiveOperation(undefined);
    }
  };

  const resolveConflict = async (resolution: "accept_remote" | "retry_local"): Promise<void> => {
    if (props.conflict === undefined || activeOperationRef.current !== undefined) return;
    activeOperationRef.current = "conflict";
    setActiveOperation("conflict");
    setOperationError(undefined);
    try {
      const resolved = await props.onResolveConflict(props.conflict, resolution, { title, text });
      if (resolved.close) {
        props.onClose();
        return;
      }
      const nextDraft = resolved.draft ?? { title, text };
      setTitle(nextDraft.title);
      setSavedTitle(nextDraft.title);
      setText(nextDraft.text);
      setSavedText(nextDraft.text);
      if (resolved.revision !== undefined) setRevision(resolved.revision);
      setRemoteAttention(undefined);
      setSavedStatus("synced");
      setActionLayer(undefined);
    } catch (cause) {
      setOperationError({ kind: "conflict", message: errorMessage(cause, "无法处理同步冲突") });
    } finally {
      activeOperationRef.current = undefined;
      setActiveOperation(undefined);
    }
  };

  const closeEditorActions = (): void => {
    setOperationError((current) => current?.kind === "delete" ? undefined : current);
    setActionLayer((current) => current === "confirm_delete" ? "menu" : undefined);
  };

  return (
    <div className="aa-mobile-editor-backdrop">
      <section ref={dialogRef} className="aa-mobile-editor" data-content-kind={props.item.kind} role="dialog" aria-modal="true" aria-label={title || "未命名笔记"}>
        <header>
          <IconButton label="返回" disabled={activeOperation !== undefined} onClick={() => void close()}><ArrowLeft /></IconButton>
          <div>
            <strong>{props.item.kind === "note" ? "笔记" : props.item.title}</strong>
            <span className="aa-mobile-editor-context">
              <span>{[props.item.kind === "note" ? undefined : props.context.typeLabel, props.context.ownerLabel, props.context.locationLabel].filter(Boolean).join(" · ")}</span>
              {statusIndicator !== undefined && <i data-tone={statusIndicator.tone} role="status">{statusIndicator.label}</i>}
            </span>
          </div>
          {props.onDelete === undefined
            ? <span className="aa-mobile-header-spacer" aria-hidden="true" />
            : <IconButton label="更多" disabled={activeOperation !== undefined} onClick={() => setActionLayer("menu")}><Ellipsis /></IconButton>}
        </header>
        <div className="aa-mobile-editor-document">
          {props.item.resource.deleted && <Notice>此内容已在另一台设备删除，当前编辑未上传</Notice>}
          {!props.item.resource.deleted && props.conflict !== undefined && (
            <EditorConflictSummary conflict={props.conflict} onOpen={() => setActionLayer("conflict")} />
          )}
          {!props.item.resource.deleted && props.conflict === undefined && remoteAttention && <Notice tone="warning">{remoteAttention}</Notice>}
          {operationError?.kind === "save" && <div className="aa-mobile-editor-error"><Notice>{operationError.message}</Notice><button type="button" onClick={() => setOperationError(undefined)}>重试</button></div>}
          {props.item.kind === "note" && (
            <input
              className="aa-mobile-editor-title-field"
              aria-label="笔记名称"
              placeholder="无标题"
              value={title}
              spellCheck={false}
              readOnly={props.item.resource.deleted}
              onChange={(event) => {
                setTitle(event.target.value);
                setOperationError(undefined);
              }}
            />
          )}
          <textarea
            aria-label="正文"
            placeholder={props.item.resource.deleted ? undefined : props.item.kind === "note" ? "从这里开始写…" : "输入内容"}
            value={text}
            spellCheck={false}
            readOnly={props.item.resource.deleted}
            onChange={(event) => {
              setText(event.target.value);
              setOperationError(undefined);
            }}
          />
        </div>
        {actionLayer === "conflict" && props.conflict !== undefined && (
          <EditorConflictSheet
            conflict={props.conflict}
            draft={{ title, text }}
            disabled={activeOperation !== undefined}
            error={operationError?.kind === "conflict" ? operationError.message : undefined}
            onClose={() => {
              setOperationError(undefined);
              setActionLayer(undefined);
            }}
            onResolve={resolveConflict}
          />
        )}
        {actionLayer === "deleted_draft" && (
          <DeletedDraftRecoverySheet
            draft={{ title, text }}
            onClose={() => setActionLayer(undefined)}
            onDiscard={props.onClose}
            onRecovered={props.onClose}
          />
        )}
        {(actionLayer === "menu" || actionLayer === "confirm_delete") && (
          <EditorActionsSheet
            key={actionLayer}
            layer={actionLayer}
            title={title || props.item.title}
            disabled={activeOperation !== undefined}
            error={operationError?.kind === "delete" ? operationError.message : undefined}
            onClose={closeEditorActions}
            onRequestDelete={() => {
              setOperationError(undefined);
              setActionLayer("confirm_delete");
            }}
            onConfirmDelete={() => void remove()}
          />
        )}
      </section>
    </div>
  );
}

function DeletedDraftRecoverySheet(props: {
  readonly draft: EditorDraft;
  readonly onClose: () => void;
  readonly onDiscard: () => void;
  readonly onRecovered: () => void;
}) {
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string>();
  const dialogRef = useModalFocus<HTMLElement>(() => {
    if (!copying) props.onClose();
  }, 200);

  const copyDraft = async (): Promise<void> => {
    setCopying(true);
    setError(undefined);
    try {
      if (navigator.clipboard === undefined) throw new Error("当前设备无法访问剪贴板");
      await navigator.clipboard.writeText(draftClipboardText(props.draft));
      props.onRecovered();
    } catch (cause) {
      setError(errorMessage(cause, "无法复制草稿，请稍后重试"));
      setCopying(false);
    }
  };

  return (
    <div className="aa-mobile-sheet-backdrop aa-mobile-editor-actions-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.currentTarget === event.target && !copying) props.onClose();
    }}>
      <section ref={dialogRef} className="aa-mobile-editor-actions" role="dialog" aria-modal="true" aria-label="保留本地草稿">
        <div className="aa-mobile-editor-delete-copy">
          <strong>这项内容已在另一台设备删除</strong>
          <small>复制后将关闭此内容，你可以在其他位置继续编辑。</small>
        </div>
        {error !== undefined && <Notice>{error}</Notice>}
        <button type="button" disabled={copying} onClick={() => void copyDraft()}><Copy />复制草稿</button>
        <button type="button" className="danger" disabled={copying} onClick={props.onDiscard}>放弃草稿</button>
        <button type="button" disabled={copying} onClick={props.onClose}>返回</button>
      </section>
    </div>
  );
}

function draftClipboardText(draft: EditorDraft): string {
  if (draft.title.trim().length === 0) return draft.text;
  if (draft.text.length === 0) return draft.title;
  return `${draft.title}\n\n${draft.text}`;
}

function EditorActionsSheet(props: {
  readonly layer: "menu" | "confirm_delete";
  readonly title: string;
  readonly disabled: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onRequestDelete: () => void;
  readonly onConfirmDelete: () => void;
}) {
  const dialogRef = useModalFocus<HTMLElement>(props.onClose, 200);
  return (
    <div className="aa-mobile-sheet-backdrop aa-mobile-editor-actions-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.currentTarget === event.target) props.onClose();
    }}>
      <section ref={dialogRef} className="aa-mobile-editor-actions" role="dialog" aria-modal="true" aria-label={props.layer === "menu" ? "内容操作" : "确认删除"}>
        {props.layer === "menu" ? (
          <>
            <button type="button" className="danger" onClick={props.onRequestDelete}><Trash2 />删除</button>
            <button type="button" onClick={props.onClose}>取消</button>
          </>
        ) : (
          <>
            <div className="aa-mobile-editor-delete-copy"><strong>删除“{props.title}”？</strong><small>删除后会同步到已连接设备。</small></div>
            {props.error !== undefined && <Notice>{props.error}</Notice>}
            <button type="button" className="danger" disabled={props.disabled} onClick={props.onConfirmDelete}><Trash2 />删除</button>
            <button type="button" disabled={props.disabled} onClick={props.onClose}>返回</button>
          </>
        )}
      </section>
    </div>
  );
}

function EditorConflictSummary(props: {
  readonly conflict: MobileVaultConflict;
  readonly onOpen: () => void;
}) {
  const presentation = conflictPresentation(props.conflict);
  return (
    <button type="button" className="aa-mobile-editor-conflict-summary" aria-label={`比较“${presentation.title}”的同步版本`} onClick={props.onOpen}>
      <CircleAlert />
      <span><strong>另一台设备也修改了此内容</strong><small>{formatRelativeTime(presentation.detectedAt)}</small></span>
      <ChevronRight />
    </button>
  );
}

function EditorConflictSheet(props: {
  readonly conflict: MobileVaultConflict;
  readonly draft: EditorDraft;
  readonly disabled: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onResolve: (resolution: "accept_remote" | "retry_local") => Promise<void>;
}) {
  const presentation = conflictPresentation(props.conflict);
  const dialogRef = useModalFocus<HTMLElement>(props.onClose, 200);
  return (
    <div className="aa-mobile-sheet-backdrop aa-mobile-editor-actions-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.currentTarget === event.target) props.onClose();
    }}>
      <section ref={dialogRef} className="aa-mobile-editor-conflict-sheet" role="dialog" aria-modal="true" aria-label="比较同步版本">
        <header>
          <div><small>同步冲突</small><strong>{props.draft.title || presentation.title}</strong><span>{formatRelativeTime(presentation.detectedAt)}</span></div>
          <IconButton label="关闭" disabled={props.disabled} onClick={props.onClose}><X /></IconButton>
        </header>
        <div className="aa-mobile-editor-conflict-comparison">
          <article><span>手机版本</span><pre>{props.draft.text}</pre></article>
          <article><span>电脑版本</span><pre>{presentation.remoteContent ?? "电脑端已删除或不再提供此内容"}</pre></article>
        </div>
        {props.error !== undefined && <Notice>{props.error}</Notice>}
        <footer>
          <button type="button" disabled={props.disabled} onClick={() => void props.onResolve("accept_remote")}>使用电脑版本</button>
          {presentation.canKeepLocal && <button type="button" className="primary" disabled={props.disabled} onClick={() => void props.onResolve("retry_local")}>保留手机版本</button>}
        </footer>
      </section>
    </div>
  );
}
