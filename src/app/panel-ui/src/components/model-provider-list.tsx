import React, { useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Search, Trash2 } from "lucide-react";
import type { ModelProviderListItem } from "./model-settings-projection";
import { ProviderLogo } from "./model-settings-icons";
import { sameStringList } from "./model-settings-list-equality";

const SETTLE_DURATION_MS = 320;

export function ModelProviderList(props: {
  readonly items: readonly ModelProviderListItem[];
  readonly addableItems: readonly ModelProviderListItem[];
  readonly selectedItem: ModelProviderListItem;
  readonly query: string;
  readonly saving?: boolean;
  readonly adding: boolean;
  readonly reorderEnabled: boolean;
  readonly onQueryChange: (value: string) => void;
  readonly onSelect: (item: ModelProviderListItem) => void;
  readonly onToggleAdding: () => void;
  readonly onCloseAdding: () => void;
  readonly onAddProvider: (item: ModelProviderListItem) => void;
  readonly onAddCustomProvider: () => void;
  readonly onReorder: (order: readonly string[]) => Promise<void>;
  readonly onDeleteProvider: (item: ModelProviderListItem) => Promise<void>;
}): React.ReactElement {
  const [draggingKey, setDraggingKey] = useState<string | undefined>(undefined);
  const [insertIndex, setInsertIndex] = useState<number | undefined>(undefined);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dragRowStep, setDragRowStep] = useState(0);
  const [settlingDrag, setSettlingDrag] = useState<{ readonly key: string; readonly offsetY: number } | undefined>(undefined);
  const [deleteZoneActive, setDeleteZoneActiveState] = useState(false);
  const deleteZoneRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<{
    readonly key: string;
    readonly pointerId: number;
    readonly startY: number;
    readonly startIndex: number;
    readonly active: boolean;
    readonly rowStep: number;
    readonly suppressSelectOnEnd: boolean;
  } | undefined>(undefined);
  const insertIndexRef = useRef<number | undefined>(undefined);
  const deleteZoneActiveRef = useRef(false);
  const suppressSelectRef = useRef(false);
  const settleFrameRef = useRef<number | undefined>(undefined);
  const settleTimerRef = useRef<number | undefined>(undefined);
  const draggingIndex = draggingKey === undefined ? -1 : props.items.findIndex((item) => item.key === draggingKey);
  const draggingItem = draggingKey === undefined ? undefined : props.items.find((item) => item.key === draggingKey);
  const deleteMode = draggingItem !== undefined;
  const deleteAvailable = draggingItem?.profileId !== undefined;

  useEffect(() => {
    return () => {
      clearSettleTimers();
    };
  }, []);

  function updateInsertIndex(clientY: number): void {
    const dragState = dragStateRef.current;
    if (dragState === undefined || dragState.rowStep <= 0) return;
    const offsetY = clientY - dragState.startY;
    const nextIndex = clampIndex(
      dragState.startIndex + Math.round(offsetY / dragState.rowStep),
      props.items.length
    );
    setActiveInsertIndex(nextIndex);
  }

  function finishDrag(item: ModelProviderListItem): void {
    const nextIndex = insertIndexRef.current;
    const shouldDelete = deleteZoneActiveRef.current && item.profileId !== undefined;
    const currentKeys = props.items.map((provider) => provider.key);
    const nextOrder = nextIndex === undefined
      ? undefined
      : reorderedProviderKeys(currentKeys, item.key, nextIndex);
    const settleOffsetY =
      nextOrder === undefined
        ? 0
        : dragOffsetY - (nextOrder.indexOf(item.key) - currentKeys.indexOf(item.key)) * dragRowStep;
    dragStateRef.current = undefined;
    setDraggingKey(undefined);
    setDragOffsetY(0);
    setDragRowStep(0);
    setActiveInsertIndex(undefined);
    setDeleteZoneActive(false);
    if (shouldDelete) {
      cancelSettleAnimation();
      void props.onDeleteProvider(item);
      return;
    }
    if (nextOrder !== undefined) {
      startSettleAnimation(item.key, settleOffsetY);
      void props.onReorder(nextOrder);
    }
  }

  function cancelReorder(): void {
    dragStateRef.current = undefined;
    setDraggingKey(undefined);
    setDragOffsetY(0);
    setDragRowStep(0);
    setActiveInsertIndex(undefined);
    setDeleteZoneActive(false);
  }

  function setActiveInsertIndex(value: number | undefined): void {
    if (insertIndexRef.current === value) return;
    insertIndexRef.current = value;
    setInsertIndex(value);
  }

  function setDeleteZoneActive(value: boolean): void {
    if (deleteZoneActiveRef.current === value) return;
    deleteZoneActiveRef.current = value;
    setDeleteZoneActiveState(value);
  }

  function cancelSettleAnimation(): void {
    clearSettleTimers();
    setSettlingDrag(undefined);
  }

  function clearSettleTimers(): void {
    if (settleFrameRef.current !== undefined) {
      window.cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = undefined;
    }
    if (settleTimerRef.current !== undefined) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = undefined;
    }
  }

  function startSettleAnimation(key: string, offsetY: number): void {
    cancelSettleAnimation();
    if (Math.abs(offsetY) < 0.5) {
      return;
    }
    setSettlingDrag({ key, offsetY });
    settleFrameRef.current = window.requestAnimationFrame(() => {
      settleFrameRef.current = window.requestAnimationFrame(() => {
        settleFrameRef.current = undefined;
        setSettlingDrag((current) => current?.key === key ? { key, offsetY: 0 } : current);
      });
    });
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = undefined;
      setSettlingDrag((current) => current?.key === key ? undefined : current);
    }, SETTLE_DURATION_MS + 80);
  }

  function updateDeleteZone(clientX: number, clientY: number, item: ModelProviderListItem): boolean {
    const zone = deleteZoneRef.current;
    if (zone === null) {
      setDeleteZoneActive(false);
      return false;
    }
    const rect = zone.getBoundingClientRect();
    const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    setDeleteZoneActive(inside && item.profileId !== undefined);
    return inside;
  }

  function beginPointerReorder(
    item: ModelProviderListItem,
    index: number,
    pointerId: number,
    clientY: number,
    active: boolean,
    suppressSelectOnEnd: boolean,
    rowStep: number
  ): void {
    dragStateRef.current = { key: item.key, pointerId, startY: clientY, startIndex: index, active, rowStep, suppressSelectOnEnd };
    setDragRowStep(rowStep);
    if (active) {
      cancelSettleAnimation();
      props.onCloseAdding();
      setDraggingKey(item.key);
      setDragOffsetY(0);
      setDeleteZoneActive(false);
      setActiveInsertIndex(index);
      updateInsertIndex(clientY);
    }
  }

  function movePointerReorder(item: ModelProviderListItem, pointerId: number, clientX: number, clientY: number): void {
    const dragState = dragStateRef.current;
    if (dragState?.key !== item.key || dragState.pointerId !== pointerId) return;
    const offsetY = clientY - dragState.startY;
    if (!dragState.active) {
      if (Math.abs(offsetY) < 5) return;
      dragStateRef.current = { ...dragState, active: true };
      cancelSettleAnimation();
      props.onCloseAdding();
      setDraggingKey(item.key);
      setDragRowStep(dragState.rowStep);
      setActiveInsertIndex(dragState.startIndex);
    }
    setDragOffsetY(offsetY);
    if (updateDeleteZone(clientX, clientY, item)) {
      setActiveInsertIndex(undefined);
      return;
    }
    updateInsertIndex(clientY);
  }

  function endPointerReorder(item: ModelProviderListItem, pointerId: number): void {
    const dragState = dragStateRef.current;
    if (dragState?.key !== item.key || dragState.pointerId !== pointerId) return;
    if (dragState.active) {
      suppressSelectRef.current = dragState.suppressSelectOnEnd;
      finishDrag(item);
      if (dragState.suppressSelectOnEnd) {
        window.setTimeout(() => {
          suppressSelectRef.current = false;
        }, 0);
      }
      return;
    }
    dragStateRef.current = undefined;
    setDragRowStep(0);
    setDeleteZoneActive(false);
  }

  return (
    <aside className="provider-list-pane" aria-label="模型服务">
      <div className="provider-list-header">
        <span>模型服务</span>
        <label className="provider-search">
          <Search size={14} />
          <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索" />
        </label>
      </div>
      <div className={`provider-list ${draggingKey === undefined ? "" : "reordering"}`}>
        {props.items.map((item, index) => {
          const selected = item.key === props.selectedItem.key;
          const dragging = item.key === draggingKey;
          const settling = item.key === settlingDrag?.key;
          const rowShiftY = dragging
            ? dragOffsetY
            : settling
              ? settlingDrag.offsetY
            : providerRowShift(index, draggingIndex, insertIndex, dragRowStep);
          return (
            <article
              className={`provider-row ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${settling ? "settling" : ""}`}
              data-provider-key={item.key}
              key={item.key}
              style={rowShiftY === 0 ? undefined : { transform: `translate3d(0, ${rowShiftY}px, 0)` }}
            >
              <button
                type="button"
                className="provider-row-main"
                onClick={() => {
                  if (suppressSelectRef.current) {
                    suppressSelectRef.current = false;
                    return;
                  }
                  props.onSelect(item);
                }}
                onPointerDown={(event) => {
                  if (!props.reorderEnabled || event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  beginPointerReorder(item, index, event.pointerId, event.clientY, false, true, providerRowStep(event.currentTarget));
                }}
                onPointerMove={(event) => movePointerReorder(item, event.pointerId, event.clientX, event.clientY)}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  endPointerReorder(item, event.pointerId);
                }}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  cancelReorder();
                }}
              >
                <ProviderLogo item={item} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{providerRowMeta(item)}</small>
                </span>
              </button>
              <button
                type="button"
                className="provider-row-drag"
                disabled={!props.reorderEnabled}
                aria-label="拖动排序"
                onPointerDown={(event) => {
                  if (!props.reorderEnabled || event.button !== 0) {
                    event.preventDefault();
                    return;
                  }
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  beginPointerReorder(item, index, event.pointerId, event.clientY, true, false, providerRowStep(event.currentTarget));
                }}
                onPointerMove={(event) => movePointerReorder(item, event.pointerId, event.clientX, event.clientY)}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  endPointerReorder(item, event.pointerId);
                }}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  cancelReorder();
                }}
              >
                <GripVertical size={15} />
              </button>
            </article>
          );
        })}
      </div>
      {props.adding && !deleteMode && (
        <div className="provider-add-menu" aria-label="添加模型提供商">
          {props.addableItems.length === 0 && (
            <div className="provider-add-empty">内置模型提供商已全部添加</div>
          )}
          {props.addableItems.map((item) => (
            <button type="button" key={item.key} onClick={() => props.onAddProvider(item)} disabled={props.saving}>
              <ProviderLogo item={item} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.baseUrl}</small>
              </span>
            </button>
          ))}
          <button type="button" onClick={props.onAddCustomProvider} disabled={props.saving}>
            <Plus size={16} />
            <span>
              <strong>自定义厂商</strong>
              <small>OpenAI Chat 兼容接口</small>
            </span>
          </button>
        </div>
      )}
      <button
        ref={deleteZoneRef}
        type="button"
        className={`provider-add-button ${deleteMode ? "delete-drop" : ""} ${deleteZoneActive ? "active" : ""}`}
        onClick={() => {
          if (deleteMode) return;
          props.onToggleAdding();
        }}
        disabled={deleteMode ? !deleteAvailable : props.saving}
        aria-label={deleteMode ? "删除模型提供商" : "添加模型提供商"}
      >
        {deleteMode ? <Trash2 size={16} /> : <Plus size={16} />}
        {deleteMode ? (deleteAvailable ? "删除模型提供商" : "无法删除") : "添加模型提供商"}
      </button>
    </aside>
  );
}

function providerRowMeta(item: ModelProviderListItem): string {
  const model = item.model.trim();
  if (model.length > 0) return model;
  const baseUrl = item.baseUrl.trim();
  if (baseUrl.length > 0) return baseUrl;
  return item.vendor ?? "未设置模型";
}

function reorderedProviderKeys(
  currentKeys: readonly string[],
  fromKey: string,
  insertIndex: number
): readonly string[] | undefined {
  const fromIndex = currentKeys.indexOf(fromKey);
  if (fromIndex < 0) return undefined;
  const nextKeys = currentKeys.filter((key) => key !== fromKey);
  const nextIndex = Math.min(Math.max(insertIndex, 0), nextKeys.length);
  nextKeys.splice(nextIndex, 0, fromKey);
  if (sameStringList(currentKeys, nextKeys)) {
    return undefined;
  }
  return nextKeys;
}

function providerRowShift(
  index: number,
  draggingIndex: number,
  insertIndex: number | undefined,
  rowStep: number
): number {
  if (draggingIndex < 0 || insertIndex === undefined || rowStep <= 0 || insertIndex === draggingIndex) {
    return 0;
  }
  if (insertIndex < draggingIndex) {
    return index >= insertIndex && index < draggingIndex ? rowStep : 0;
  }
  return index > draggingIndex && index <= insertIndex ? -rowStep : 0;
}

function providerRowStep(node: HTMLElement): number {
  const row = node.closest("[data-provider-key]");
  if (!(row instanceof HTMLElement)) return 58;
  const rowHeight = row.getBoundingClientRect().height;
  const list = row.parentElement;
  if (list === null) return rowHeight;
  const styles = window.getComputedStyle(list);
  const gap = Number.parseFloat(styles.rowGap || styles.gap || "0");
  return rowHeight + (Number.isFinite(gap) ? gap : 0);
}

function clampIndex(value: number, itemCount: number): number {
  return Math.min(Math.max(value, 0), Math.max(0, itemCount - 1));
}
