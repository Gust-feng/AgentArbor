import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { ApiError } from "../../../../api";
import {
  deleteMemoryNote,
  deletePathDependency,
  fetchMemorySnapshot,
  fetchPathDependency,
  saveMemoryNote,
  savePathDependency,
} from "../../../../memory-client";
import type {
  MemoryNote,
  MemoryOwner,
  MemoryOwnerSelection,
  MemorySnapshot,
  MemorySourceRef,
  MemoryVerification,
  MemoryVerificationStatus,
  PathDependency,
} from "../../../../contracts/memory";

type NoteScope = "global" | "owner";

type DependencyDraft = {
  readonly scope: "global" | "owner";
  readonly title: string;
  readonly methodology: string;
  readonly tags: string;
  readonly verification: MemoryVerificationStatus;
  readonly evidenceRefs: string;
};

const GLOBAL_OWNER: MemoryOwnerSelection = { kind: "global" };

/**
 * Memory Center is an independent workbench surface.  A conversation may be
 * the place where a memory was created, but it must not lock this management
 * view to the currently open conversation; the owner selector is the explicit
 * authority for global, Space, and Workspace memory.
 */
export function MemoryPage(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | undefined>(undefined);
  const [ownerSelection, setOwnerSelection] = useState<MemoryOwnerSelection>(GLOBAL_OWNER);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [selectedDependencyId, setSelectedDependencyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PathDependency | undefined>(undefined);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | undefined>(undefined);
  const [detailOpen, setDetailOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DependencyDraft | undefined>(undefined);
  const [savingDependency, setSavingDependency] = useState(false);
  const [dependencyConflict, setDependencyConflict] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [noteEditing, setNoteEditing] = useState<NoteScope | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState<NoteScope | null>(null);
  const [noteDeleteArmed, setNoteDeleteArmed] = useState<NoteScope | null>(null);
  const [noteDeleting, setNoteDeleting] = useState<NoteScope | null>(null);
  const [noteError, setNoteError] = useState<string | undefined>(undefined);
  const detailRequestRef = useRef<{ readonly id: number; readonly controller: AbortController } | undefined>(undefined);
  const detailRequestSequenceRef = useRef(0);
  const detailDraftDirtyRef = useRef(false);

  const cancelDetailRequest = useCallback((): void => {
    detailRequestRef.current?.controller.abort();
    detailRequestRef.current = undefined;
    detailRequestSequenceRef.current += 1;
  }, []);

  const reload = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setLoadState("loading");
      setLoadError(undefined);
    try {
      const next = await fetchMemorySnapshot({
        owner: ownerSelection,
        signal,
      });
      setSnapshot(next);
      setLoadState("ready");
      setSelectedDependencyId((current) => {
        if (current === null || next.pathDependencies.some((dependency) => dependency.id === current)) return current;
        return null;
      });
    } catch (error) {
      if (signal?.aborted) return;
      setLoadState("error");
      setLoadError(messageOf(error));
    }
  }, [ownerSelection]);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(undefined);
    setSelectedDependencyId(null);
    setDetail(undefined);
    setDetailOpen(false);
    setCreating(false);
    setDraft(undefined);
    setNoteEditing(null);
    setNoteDraft("");
    setNoteDeleteArmed(null);
    setNoteError(undefined);
    setDependencyConflict(false);
    setDeleteArmed(false);
    detailDraftDirtyRef.current = false;
    void reload(controller.signal);
    return () => {
      controller.abort();
      cancelDetailRequest();
    };
  }, [cancelDetailRequest, reload]);

  const ownerOptions = useMemo(
    () => uniqueOwners([GLOBAL_OWNER, ...(snapshot?.owners ?? []), ...(snapshot?.owner === undefined ? [] : [snapshot.owner])]),
    [snapshot?.owner, snapshot?.owners],
  );
  const owner: MemoryOwner | undefined = snapshot?.owner ?? ownerSelection;
  const scopedOwner = isScopedOwner(owner) ? owner : undefined;
  const dependencies = snapshot?.pathDependencies ?? [];
  const history = snapshot?.history ?? [];

  const openDependency = useCallback((dependency: PathDependency): void => {
    cancelDetailRequest();
    const requestId = detailRequestSequenceRef.current + 1;
    const controller = new AbortController();
    detailRequestRef.current = { id: requestId, controller };
    detailRequestSequenceRef.current = requestId;
    detailDraftDirtyRef.current = false;
    setSelectedDependencyId(dependency.id);
    setDetail(dependency);
    setDetailOpen(true);
    setCreating(false);
    setDraft(draftFromDependency(dependency));
    setDependencyConflict(false);
    setDetailError(undefined);
    setDeleteArmed(false);
    setDetailLoading(true);
    void fetchPathDependency(dependency.id, { owner: ownerSelection, signal: controller.signal })
      .then((fresh) => {
        if (detailRequestRef.current?.id !== requestId) return;
        setDetail((current) => current?.id === fresh.id ? fresh : current);
        if (!detailDraftDirtyRef.current) setDraft(draftFromDependency(fresh));
      })
      .catch((error: unknown) => {
        if (detailRequestRef.current?.id !== requestId || controller.signal.aborted) return;
        setDetailError(messageOf(error));
      })
      .finally(() => {
        if (detailRequestRef.current?.id !== requestId) return;
        detailRequestRef.current = undefined;
        setDetailLoading(false);
      });
  }, [cancelDetailRequest, ownerSelection]);

  const openCreate = useCallback((): void => {
    cancelDetailRequest();
    detailDraftDirtyRef.current = false;
    setSelectedDependencyId(null);
    setDetail(undefined);
    setCreating(true);
    setDetailOpen(true);
    setDraft({
      scope: scopedOwner === undefined ? "global" : "owner",
      title: "",
      methodology: "",
      tags: "",
      verification: "not_recorded",
      evidenceRefs: "",
    });
    setDetailError(undefined);
    setDependencyConflict(false);
    setDeleteArmed(false);
  }, [cancelDetailRequest, scopedOwner]);

  const closeDetail = useCallback((force = false): void => {
    if (!force && (savingDependency || deleting)) return;
    cancelDetailRequest();
    detailDraftDirtyRef.current = false;
    setDetailOpen(false);
    setDetail(undefined);
    setDraft(undefined);
    setCreating(false);
    setDependencyConflict(false);
    setDeleteArmed(false);
    setDetailError(undefined);
  }, [cancelDetailRequest, deleting, savingDependency]);

  const updateSnapshotDependency = useCallback((next: PathDependency, previousId?: string): void => {
    setSnapshot((current) => {
      if (current === undefined) return current;
      const index = current.pathDependencies.findIndex((dependency) => dependency.id === (previousId ?? next.id));
      if (index < 0) return { ...current, pathDependencies: [next, ...current.pathDependencies] };
      const pathDependencies = [...current.pathDependencies];
      pathDependencies[index] = next;
      return { ...current, pathDependencies };
    });
  }, []);

  const saveDependencyDraft = useCallback(async (): Promise<void> => {
    if (draft === undefined || draft.title.trim().length === 0 || draft.methodology.trim().length === 0) return;
    if (draft.scope === "owner" && scopedOwner === undefined) {
      setDetailError("请先在记忆范围中选择一个空间或工作区，才能保存 owner 记忆。");
      return;
    }
    setSavingDependency(true);
    setDetailError(undefined);
    setDependencyConflict(false);
    try {
      const next = await savePathDependency({
        ...memoryMutationContext(ownerSelection),
        scope: draft.scope,
        ...(detail === undefined ? {} : { memoryId: detail.id, expectedRevision: detail.revision }),
        title: draft.title.trim(),
        methodology: draft.methodology,
        tags: splitList(draft.tags),
        verification: {
          status: draft.verification,
        },
        evidenceRefs: splitList(draft.evidenceRefs),
      });
      updateSnapshotDependency(next, detail?.id);
      setSelectedDependencyId(next.id);
      setDetail(next);
      setDraft(draftFromDependency(next));
      detailDraftDirtyRef.current = false;
      setCreating(false);
      setDeleteArmed(false);
    } catch (error) {
      if (isConflict(error)) {
        setDependencyConflict(true);
        setDetailError("这条路径依赖已被其他操作更新。请重新读取后合并，再保存。");
      } else {
        setDetailError(messageOf(error));
      }
    } finally {
      setSavingDependency(false);
    }
  }, [detail, draft, ownerSelection, scopedOwner, updateSnapshotDependency]);

  const deleteDependency = useCallback(async (): Promise<void> => {
    if (detail === undefined || !deleteArmed) return;
    setDeleting(true);
    setDetailError(undefined);
    try {
      await deletePathDependency(detail.id, {
        ...memoryMutationContext(ownerSelection),
        expectedRevision: detail.revision,
      });
      setSnapshot((current) => current === undefined
        ? current
        : { ...current, pathDependencies: current.pathDependencies.filter((dependency) => dependency.id !== detail.id) });
      closeDetail(true);
    } catch (error) {
      if (isConflict(error)) {
        setDependencyConflict(true);
        setDetailError("删除失败：版本已变化。请重新读取后确认删除。");
      } else {
        setDetailError(messageOf(error));
      }
    } finally {
      setDeleting(false);
    }
  }, [closeDetail, deleteArmed, detail, ownerSelection]);

  const beginNoteEdit = useCallback((scope: NoteScope): void => {
    const note = scope === "global" ? snapshot?.globalNote : snapshot?.ownerNote;
    setNoteEditing(scope);
    setNoteDraft(note?.content ?? "");
    setNoteDeleteArmed(null);
    setNoteError(undefined);
  }, [snapshot]);

  const cancelNoteEdit = useCallback((force = false): void => {
    if (!force && noteSaving !== null) return;
    setNoteEditing(null);
    setNoteDraft("");
    setNoteError(undefined);
  }, [noteSaving]);

  const saveNoteDraft = useCallback(async (): Promise<void> => {
    if (noteEditing === null || snapshot === undefined) return;
    const note = noteEditing === "global" ? snapshot.globalNote : snapshot.ownerNote;
    if (note === undefined) {
      setNoteError("当前记忆笔记没有可用版本，暂时无法编辑。");
      return;
    }
    setNoteSaving(noteEditing);
    setNoteError(undefined);
    try {
      const saved = await saveMemoryNote(noteEditing, {
        ...memoryMutationContext(ownerSelection),
        content: noteDraft,
        expectedVersion: note.version,
      });
      setSnapshot((current) => current === undefined
        ? current
        : noteEditing === "global" ? { ...current, globalNote: saved } : { ...current, ownerNote: saved });
      setNoteDeleteArmed(null);
      cancelNoteEdit(true);
    } catch (error) {
      setNoteError(isConflict(error)
        ? "这本笔记已被其他操作更新，请重新读取后合并。"
        : messageOf(error));
    } finally {
      setNoteSaving(null);
    }
  }, [cancelNoteEdit, noteDraft, noteEditing, ownerSelection, snapshot]);

  const deleteNote = useCallback(async (scope: NoteScope): Promise<void> => {
    if (noteDeleteArmed !== scope || snapshot === undefined || noteSaving !== null) return;
    const note = scope === "global" ? snapshot.globalNote : snapshot.ownerNote;
    if (note === undefined) return;
    setNoteDeleting(scope);
    setNoteError(undefined);
    try {
      const deleted = await deleteMemoryNote(scope, {
        ...memoryMutationContext(ownerSelection),
        expectedVersion: note.version,
      });
      setSnapshot((current) => current === undefined
        ? current
        : scope === "global" ? { ...current, globalNote: deleted } : { ...current, ownerNote: deleted });
      setNoteDeleteArmed(null);
      if (noteEditing === scope) cancelNoteEdit(true);
    } catch (error) {
      setNoteError(isConflict(error)
        ? "这本笔记已被其他操作更新，请重新读取后确认删除。"
        : messageOf(error));
    } finally {
      setNoteDeleting(null);
    }
  }, [cancelNoteEdit, noteDeleteArmed, noteEditing, noteSaving, ownerSelection, snapshot]);

  const contextLabel = ownerLabel(owner);

  if (loadState === "loading") {
    return <MemoryPageFrame><MemoryLoadingState /></MemoryPageFrame>;
  }
  if (loadState === "error") {
    return (
      <MemoryPageFrame>
        <div className="memory-center__error" role="alert">
          <span>{loadError ?? "记忆暂时无法加载。"}</span>
          <button
            type="button"
            className="memory-center__text-button"
            onClick={() => void reload()}
            style={{ marginLeft: 10 }}
          >
            重试
          </button>
        </div>
      </MemoryPageFrame>
    );
  }

  return (
    <MemoryPageFrame>
      <div className="memory-center__masthead">
        <div>
          <p className="memory-center__eyebrow">记忆中心 · 可复用事实</p>
          <h1 className="memory-center__title">记忆</h1>
          <p className="memory-center__lede">
            把稳定的工作约定和可复用的方法留在这里。来源、版本和并发状态都按真实事实展示。
          </p>
        </div>
        <div className="memory-center__context" aria-label={`当前记忆范围：${contextLabel}`}>
          <span className="memory-center__context-dot" aria-hidden="true" />
          {ownerOptions.length > 1 ? (
            <select
              className="memory-center__context-select"
              aria-label="记忆范围"
              value={ownerKey(ownerSelection)}
              onChange={(event) => {
                const next = ownerOptions.find((candidate) => ownerKey(candidate) === event.target.value);
                if (next !== undefined) setOwnerSelection(toOwnerSelection(next));
              }}
            >
              {ownerOptions.map((candidate) => (
                <option key={ownerKey(candidate)} value={ownerKey(candidate)}>{ownerOptionLabel(candidate)}</option>
              ))}
            </select>
          ) : contextLabel}
        </div>
      </div>

      {noteError !== undefined && <div className="memory-center__conflict" role="alert">{noteError}</div>}

      <section className="memory-center__section" aria-labelledby="memory-notes-title">
        <div className="memory-center__section-head">
          <div>
            <p className="memory-center__section-label">声明性记忆</p>
            <h2 id="memory-notes-title" className="memory-center__section-title">工作约定与长期事实</h2>
          </div>
        </div>
        <div className="memory-center__notes">
          <NoteCard
            scope="global"
            note={snapshot?.globalNote}
            label="全局记忆"
            editing={noteEditing === "global"}
            draft={noteDraft}
            saving={noteSaving === "global"}
            deleteArmed={noteDeleteArmed === "global"}
            deleting={noteDeleting === "global"}
            onEdit={() => beginNoteEdit("global")}
            onDraftChange={setNoteDraft}
            onSave={() => void saveNoteDraft()}
            onCancel={cancelNoteEdit}
            onArmDelete={() => setNoteDeleteArmed("global")}
            onCancelDelete={() => setNoteDeleteArmed(null)}
            onDelete={() => void deleteNote("global")}
          />
          {scopedOwner !== undefined && (
            <NoteCard
              scope="owner"
              note={snapshot?.ownerNote}
              label={ownerLabel(scopedOwner)}
              editing={noteEditing === "owner"}
              draft={noteDraft}
              saving={noteSaving === "owner"}
              deleteArmed={noteDeleteArmed === "owner"}
              deleting={noteDeleting === "owner"}
              onEdit={() => beginNoteEdit("owner")}
              onDraftChange={setNoteDraft}
              onSave={() => void saveNoteDraft()}
              onCancel={cancelNoteEdit}
              onArmDelete={() => setNoteDeleteArmed("owner")}
              onCancelDelete={() => setNoteDeleteArmed(null)}
              onDelete={() => void deleteNote("owner")}
            />
          )}
        </div>
      </section>

      <section className="memory-center__section" aria-labelledby="memory-dependencies-title">
        <div className="memory-center__section-head">
          <div>
            <p className="memory-center__section-label">程序性记忆</p>
            <h2 id="memory-dependencies-title" className="memory-center__section-title">路径依赖</h2>
          </div>
          <button type="button" className="memory-center__quiet-button" onClick={openCreate}>
            <Plus size={12} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 5 }} />
            新建路径依赖
          </button>
        </div>
        {dependencies.length === 0 ? (
          <div className="memory-center__empty">
            当前范围还没有路径依赖。保存一条经过验证的方法，再回来查看它的来源和版本。
          </div>
        ) : (
          <div className="memory-center__dependencies">
            {dependencies.map((dependency) => (
              <DependencyRow
                key={dependency.id}
                dependency={dependency}
                onClick={() => openDependency(dependency)}
              />
            ))}
          </div>
        )}
        {history.length > 0 && (
          <div className="memory-center__history" aria-label="已删除记忆的历史事实">
            <p className="memory-center__history-label">已删除的历史事实</p>
            <p className="memory-center__history-hint">正文已按删除策略移除；读取和采用记录仍保留，便于追溯。</p>
            {history.map((entry) => (
              <div key={entry.historyKey ?? `${entry.id}:${ownerKey(entry.owner)}`} className="memory-center__history-entry">
                <div className="memory-center__dependency-header">
                  <span className="memory-center__dependency-title">{entry.title}</span>
                  <span className="memory-center__owner-chip">已删除</span>
                </div>
                <div className="memory-center__meta-row">
                  <span>{ownerLabel(entry.owner)}</span>
                  <span>修订 {entry.revision}</span>
                  <span>读取 {entry.readCount}</span>
                  <span>采用 {entry.useCount}</span>
                  <span>正文不可用</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {detailOpen && (
        <DependencyDialog
          owner={scopedOwner}
          dependency={detail}
          creating={creating}
          loading={detailLoading}
          draft={draft}
          error={detailError}
          conflict={dependencyConflict}
          deleteArmed={deleteArmed}
          saving={savingDependency}
          deleting={deleting}
          onClose={closeDetail}
          onDraftChange={(next) => {
            detailDraftDirtyRef.current = true;
            setDraft(next);
          }}
          onSave={() => void saveDependencyDraft()}
          onArmDelete={() => setDeleteArmed(true)}
          onCancelDelete={() => setDeleteArmed(false)}
          onDelete={() => void deleteDependency()}
          onReload={() => {
            if (detail === undefined) return;
            openDependency(detail);
          }}
        />
      )}
    </MemoryPageFrame>
  );
}

function MemoryPageFrame({ children }: { readonly children: ReactNode }): React.ReactElement {
  return (
    <section className="memory-center flex min-h-0 flex-1" aria-label="记忆中心">
      <div className="memory-center__scroll w-full">
        <div className="memory-center__inner">{children}</div>
      </div>
    </section>
  );
}

function MemoryLoadingState(): React.ReactElement {
  return (
    <div role="status" aria-label="正在加载记忆" style={{ paddingTop: 40 }}>
      <div className="memory-center__eyebrow">记忆中心</div>
      <div style={{ height: 34, width: "min(320px, 70%)", marginTop: 14, borderRadius: 7, background: "var(--aa-surface-hover)", opacity: 0.7 }} />
      <div style={{ height: 12, width: "min(520px, 90%)", marginTop: 14, borderRadius: 5, background: "var(--aa-surface-hover)", opacity: 0.55 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 36 }}>
        {[1, 2].map((id) => <div key={id} style={{ height: 150, border: "1px solid var(--aa-border)", borderRadius: 10, background: "var(--aa-surface)", opacity: 0.7 }} />)}
      </div>
    </div>
  );
}

function NoteCard(props: {
  readonly scope: NoteScope;
  readonly note?: MemoryNote;
  readonly label: string;
  readonly editing: boolean;
  readonly draft: string;
  readonly saving: boolean;
  readonly deleteArmed: boolean;
  readonly deleting: boolean;
  readonly onEdit: () => void;
  readonly onDraftChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onArmDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onDelete: () => void;
}): React.ReactElement {
  const hasContent = (props.note?.content.trim().length ?? 0) > 0;
  return (
    <article className="memory-center__note" data-scope={props.scope}>
      <div className="memory-center__note-header">
        <span className="memory-center__note-label">{props.label}</span>
        <span className="memory-center__note-status">{hasContent ? "已记录" : "尚未记录"}</span>
      </div>
      {props.editing ? (
        <div className="memory-center__note-editor">
          <textarea
            className="memory-center__textarea"
            aria-label={`${props.label}正文`}
            value={props.draft}
            onChange={(event) => props.onDraftChange(event.target.value)}
            disabled={props.saving}
          />
          <div className="memory-center__meta-row">
            <button type="button" className="memory-center__primary-button" onClick={props.onSave} disabled={props.saving || props.note === undefined}>
              <Save size={12} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 5 }} />
              {props.saving ? "保存中…" : "保存笔记"}
            </button>
            <button type="button" className="memory-center__secondary-button" onClick={props.onCancel} disabled={props.saving || props.deleting}>取消</button>
          </div>
        </div>
      ) : (
        <>
          <p className={`memory-center__note-preview${hasContent ? "" : " is-empty"}`}>
            {hasContent ? props.note?.content : "还没有内容；模型或你可以在这里留下稳定的工作约定。"}
          </p>
          <div className="memory-center__meta-row">
            <button type="button" className="memory-center__text-button" onClick={props.onEdit} disabled={props.note === undefined || props.deleting}>
               {hasContent ? "编辑笔记" : "开始记录"}
            </button>
            {hasContent && (props.deleteArmed ? (
              <>
                <button type="button" className="memory-center__secondary-button" onClick={props.onCancelDelete} disabled={props.deleting}>保留</button>
                <button type="button" className="memory-center__danger-button" onClick={props.onDelete} disabled={props.deleting}>
                  {props.deleting ? "删除中…" : "确认永久删除"}
                </button>
              </>
            ) : (
              <button type="button" className="memory-center__text-button" onClick={props.onArmDelete} disabled={props.deleting}>删除</button>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

function DependencyRow({ dependency, onClick }: { readonly dependency: PathDependency; readonly onClick: () => void }): React.ReactElement {
  const sourceRefs = dependency.sourceRunRefs ?? [];
  const sourceSummary = sourceRefs.length === 0
    ? "暂无来源记录"
    : `${sourceRefs.slice(0, 2).map(sourceRefLabel).join("、")}${sourceRefs.length > 2 ? ` 等 ${sourceRefs.length} 个来源` : ""}`;
  const stats = dependencyStats(dependency);
  return (
    <button type="button" className="memory-center__dependency" onClick={onClick}>
      <span className="memory-center__dependency-header">
        <span className="memory-center__dependency-title">{dependency.title}</span>
        <span className="memory-center__owner-chip">{ownerLabel(dependency.owner)}</span>
      </span>
      <span className="memory-center__dependency-excerpt">
        {dependency.excerpt ?? dependency.methodology ?? "打开查看完整方法论。"}
      </span>
      <span className="memory-center__meta-row">
        {verificationBadge(dependency.verification)}
        <span>修订 {dependency.revision}</span>
        <span className="memory-center__meta-separator">{sourceSummary}</span>
        {stats}
        {(dependency.tags ?? []).slice(0, 3).map((tag) => <span key={tag} className="memory-center__tag">#{tag}</span>)}
      </span>
      <span aria-hidden="true" style={{ float: "right", marginTop: -17, color: "var(--aa-text-3)" }}><ChevronRight size={13} /></span>
    </button>
  );
}

function DependencyDialog(props: {
  readonly owner?: MemoryOwner;
  readonly dependency?: PathDependency;
  readonly creating: boolean;
  readonly loading: boolean;
  readonly draft?: DependencyDraft;
  readonly error?: string;
  readonly conflict: boolean;
  readonly deleteArmed: boolean;
  readonly saving: boolean;
  readonly deleting: boolean;
  readonly onClose: () => void;
  readonly onDraftChange: (draft: DependencyDraft | undefined) => void;
  readonly onSave: () => void;
  readonly onArmDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onDelete: () => void;
  readonly onReload: () => void;
}): React.ReactElement {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  const draft = props.draft ?? {
    scope: "global" as const,
    title: "",
    methodology: "",
    tags: "",
    verification: "not_recorded" as const,
    evidenceRefs: "",
  };
  const set = <K extends keyof DependencyDraft>(key: K, value: DependencyDraft[K]): void => {
    props.onDraftChange({ ...draft, [key]: value });
  };
  return (
    <div className="memory-center__modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <div className="memory-center__modal" role="dialog" aria-modal="true" aria-labelledby="memory-dependency-dialog-title">
        <header className="memory-center__modal-header">
          <div>
            <p className="memory-center__eyebrow">{props.creating ? "新增条目" : `修订 ${props.dependency?.revision ?? "—"}`}</p>
            <h2 id="memory-dependency-dialog-title" className="memory-center__modal-title">
              {props.creating ? "新建路径依赖" : "路径依赖详情"}
            </h2>
          </div>
          <button type="button" className="memory-center__modal-close" aria-label="关闭详情" onClick={props.onClose} disabled={props.saving || props.deleting}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="memory-center__modal-body">
          {props.loading && <div className="memory-center__meta-row" role="status" style={{ marginBottom: 12 }}><RefreshCw size={12} className="animate-spin" />正在读取最新版本…</div>}
          {props.error !== undefined && (
            <div className={props.conflict ? "memory-center__conflict" : "memory-center__error"} role="alert">
              {props.error}
              {props.conflict && <button type="button" className="memory-center__text-button" onClick={props.onReload} style={{ marginLeft: 8 }}>重新读取</button>}
            </div>
          )}
          <div className="memory-center__form-grid">
            <label className="memory-center__field memory-center__field--wide">
              <span className="memory-center__field-label">标题</span>
              <input className="memory-center__input" value={draft.title} onChange={(event) => set("title", event.target.value)} disabled={props.saving || props.deleting} placeholder="例如：发布前的类型检查顺序" />
            </label>
            <label className="memory-center__field">
              <span className="memory-center__field-label">作用域</span>
              <select className="memory-center__select" value={draft.scope} onChange={(event) => set("scope", event.target.value as DependencyDraft["scope"])} disabled={!props.creating || props.saving || props.deleting}>
                <option value="global">全局</option>
                <option value="owner" disabled={props.owner === undefined}>{props.owner === undefined ? "当前 owner（不可用）" : ownerLabel(props.owner)}</option>
              </select>
            </label>
            <label className="memory-center__field">
              <span className="memory-center__field-label">验证状态</span>
              <select className="memory-center__select" value={draft.verification} onChange={(event) => set("verification", event.target.value as MemoryVerificationStatus)} disabled={props.saving || props.deleting}>
                <option value="not_recorded">未记录</option>
                <option value="observed">已观察</option>
              </select>
            </label>
            <label className="memory-center__field memory-center__field--wide">
              <span className="memory-center__field-label">方法论</span>
              <textarea className="memory-center__textarea" value={draft.methodology} onChange={(event) => set("methodology", event.target.value)} disabled={props.saving || props.deleting} placeholder="描述适用条件、核心思路、验证方式和失败边界。" />
            </label>
            <label className="memory-center__field">
              <span className="memory-center__field-label">标签</span>
              <input className="memory-center__input" value={draft.tags} onChange={(event) => set("tags", event.target.value)} disabled={props.saving || props.deleting} placeholder="用逗号分隔" />
            </label>
            <label className="memory-center__field">
              <span className="memory-center__field-label">证据引用</span>
              <input className="memory-center__input" value={draft.evidenceRefs} onChange={(event) => set("evidenceRefs", event.target.value)} disabled={props.saving || props.deleting} placeholder="可选，用逗号分隔" />
            </label>
          </div>

          {!props.creating && props.dependency !== undefined && (
            <DependencyProvenance dependency={props.dependency} />
          )}

          {!props.creating && props.deleteArmed && (
            <div className="memory-center__warning" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>删除后不可撤销，正文不会进入回收站。历史 Run 只保留来源事实。</span>
            </div>
          )}
        </div>
        <footer className="memory-center__modal-footer">
          {!props.creating && props.dependency !== undefined ? (
            props.deleteArmed ? (
              <div className="memory-center__footer-actions" style={{ marginLeft: 0 }}>
                <button type="button" className="memory-center__secondary-button" onClick={props.onCancelDelete} disabled={props.deleting}>保留</button>
                <button type="button" className="memory-center__danger-button" onClick={props.onDelete} disabled={props.deleting}>
                  <Trash2 size={12} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 5 }} />
                  {props.deleting ? "删除中…" : "确认永久删除"}
                </button>
              </div>
            ) : (
              <button type="button" className="memory-center__danger-button" onClick={props.onArmDelete} disabled={props.saving}>删除</button>
            )
          ) : <span />}
          <div className="memory-center__footer-actions">
            <button type="button" className="memory-center__secondary-button" onClick={props.onClose} disabled={props.saving || props.deleting}>取消</button>
            <button type="button" className="memory-center__primary-button" onClick={props.onSave} disabled={props.saving || props.deleting || draft.title.trim().length === 0 || draft.methodology.trim().length === 0}>
              <Save size={12} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 5 }} />
              {props.saving ? "保存中…" : "保存"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function DependencyProvenance({ dependency }: { readonly dependency: PathDependency }): React.ReactElement {
  const refs = dependency.sourceRunRefs ?? [];
  const evidenceRefs = dependency.evidenceRefs ?? [];
  const references = dependency.references ?? [];
  return (
    <div style={{ marginTop: 18 }}>
      <p className="memory-center__section-label">来源与事实</p>
      <div className="memory-center__meta-row" style={{ marginTop: 8 }}>
        {verificationBadge(dependency.verification)}
        <span>修订 {dependency.revision}</span>
        {dependency.createdBy !== undefined && <span>由 {dependency.createdBy === "agent" ? "模型" : dependency.createdBy === "user" ? "用户" : dependency.createdBy} 创建</span>}
      </div>
      <p style={{ margin: "12px 0 5px", color: "var(--aa-text-2)", fontSize: 11 }}>来源 Run</p>
      {refs.length === 0 ? <p style={{ margin: 0, color: "var(--aa-text-3)", fontSize: 11 }}>暂无来源记录</p> : (
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--aa-text-2)", fontSize: 11, lineHeight: 1.7 }}>
          {refs.map((ref, index) => <li key={`${sourceRefLabel(ref)}-${index}`}>{sourceRefLabel(ref)}</li>)}
        </ul>
      )}
      <p style={{ margin: "12px 0 5px", color: "var(--aa-text-2)", fontSize: 11 }}>验证证据</p>
      {evidenceRefs.length === 0 ? <p style={{ margin: 0, color: "var(--aa-text-3)", fontSize: 11 }}>暂无证据引用</p> : (
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--aa-text-2)", fontSize: 11, lineHeight: 1.7 }}>
          {evidenceRefs.map((ref) => <li key={ref}>{ref}</li>)}
        </ul>
      )}
      {references.length > 0 && (
        <p style={{ margin: "12px 0 0", color: "var(--aa-text-3)", fontSize: 10 }}>
          已记录 {references.filter((reference) => reference.kind === "read").length} 次读取，{references.filter((reference) => reference.kind === "applied").length} 次采用。
        </p>
      )}
    </div>
  );
}

function verificationBadge(value: MemoryVerification | undefined): React.ReactElement | null {
  const status = verificationStatus(value);
  if (status === undefined) return null;
  const label = status === "observed" ? "模型已观察" : "未记录";
  return <span className="memory-center__verification" data-status={status}>{label}</span>;
}

function dependencyStats(dependency: PathDependency): React.ReactNode[] {
  const stats: React.ReactNode[] = [];
  if (typeof dependency.sourceRunCount === "number") stats.push(<span key="sources">来源 {dependency.sourceRunCount}</span>);
  if (typeof dependency.evidenceCount === "number") stats.push(<span key="evidence">证据 {dependency.evidenceCount}</span>);
  if (typeof dependency.readCount === "number") stats.push(<span key="read">读取 {dependency.readCount}</span>);
  if (typeof dependency.useCount === "number") stats.push(<span key="use">采用 {dependency.useCount}</span>);
  return stats;
}

function verificationStatus(value: MemoryVerification | undefined): MemoryVerificationStatus | undefined {
  if (typeof value === "string") return value;
  return value?.status;
}

function draftFromDependency(dependency: PathDependency): DependencyDraft {
  const verification = verificationStatus(dependency.verification) ?? "not_recorded";
  const evidenceRefs = dependency.evidenceRefs ?? [];
  return {
    scope: dependency.owner.kind === "global" ? "global" : "owner",
    title: dependency.title,
    methodology: dependency.methodology ?? dependency.excerpt ?? "",
    tags: (dependency.tags ?? []).join(", "),
    verification,
    evidenceRefs: evidenceRefs.join(", "),
  };
}

function splitList(value: string): readonly string[] {
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function memoryMutationContext(
  owner: MemoryOwnerSelection,
): { readonly ownerKind: "space" | "workspace"; readonly ownerId: string } | Record<never, never> {
  if (owner.kind === "global") return {};
  return { ownerKind: owner.kind, ownerId: owner.id };
}

function uniqueOwners(owners: readonly MemoryOwner[]): readonly MemoryOwner[] {
  const seen = new Set<string>();
  return owners.filter((owner) => {
    const key = ownerKey(owner);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ownerKey(owner: MemoryOwner | MemoryOwnerSelection): string {
  return owner.kind === "global" ? "global" : `${owner.kind}:${owner.id}`;
}

function toOwnerSelection(owner: MemoryOwner): MemoryOwnerSelection {
  return owner.kind === "global" ? GLOBAL_OWNER : { kind: owner.kind, id: owner.id };
}

function isScopedOwner(owner: MemoryOwner | undefined): owner is Extract<MemoryOwner, { readonly kind: "space" | "workspace" }> {
  return owner?.kind === "space" || owner?.kind === "workspace";
}

function ownerLabel(owner: MemoryOwner | undefined): string {
  if (owner === undefined || owner.kind === "global") return "全局";
  return owner.title ?? (owner.kind === "space" ? "当前空间" : "当前工作区");
}

function ownerOptionLabel(owner: MemoryOwner): string {
  if (owner.kind === "global") return "全局记忆";
  const prefix = owner.kind === "space" ? "空间" : "工作区";
  return owner.title === undefined || owner.title.trim().length === 0 ? `${prefix} · ${owner.id}` : `${prefix} · ${owner.title}`;
}

function sourceRefLabel(ref: MemorySourceRef): string {
  if (typeof ref === "string") return ref;
  return ref.title ?? ref.runId;
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.code?.includes("conflict") === true);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "记忆请求失败。";
}
