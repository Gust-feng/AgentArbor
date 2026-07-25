import React from "react";
import {
  Bot,
  ChevronRight,
  CircleAlert,
  FileText,
  Files,
  FolderOpen,
  Globe2,
  ListTree,
  Pencil,
  Search,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { TranscriptNode } from "../contracts/run";
import {
  ConfirmationNode,
  type ConfirmationProjection,
} from "./transcript-confirmation";
import type {
  ActivityBadge,
  ActivityLead,
  ActivityToolKind,
  ActivityItem,
} from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import {
  isVisibleOrdinaryActivityItem,
  resolveActivityToolKind,
} from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import type { AgentWorkTimelineView } from "../../../panel-read-model/assistant/panel-agent-work-timeline-view";
import { ActivityEvidencePanel } from "./activity-evidence";

export type { ConfirmationProjection } from "./transcript-confirmation";
export { pendingForTurn } from "../../../panel-read-model/transcript/panel-transcript-confirmation-projection";

type AgentWorkTimelineProps = {
  readonly view: AgentWorkTimelineView<TranscriptNode, ConfirmationProjection>;
  readonly presentation?: "agent_work" | "records";
  readonly collapsed?: boolean;
  readonly lifecycle?: "open" | "settled" | "attention";
  readonly collapseReason?: string;
  readonly selectedItemKey?: string;
  readonly selectableItemKeys?: readonly string[];
  readonly onSelectItem?: (item: ActivityItem) => void;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
};

export function AgentWorkTimeline(props: AgentWorkTimelineProps): React.ReactElement | null {
  return <MemoAgentWorkTimeline {...props} />;
}

const MemoAgentWorkTimeline = React.memo(function AgentWorkTimelineContent(props: AgentWorkTimelineProps): React.ReactElement | null {
  const { confirmation, items } = props.view;
  if (!props.view.hasContent) return null;

  const visibleItems = props.presentation === "agent_work"
    ? items.filter(isVisibleOrdinaryActivityItem)
    : items;
  const reasoningOnly = visibleItems.length > 0 && visibleItems.every(isReasoningActivityItem);
  const autoOpenWorkRecords = props.lifecycle === "open" ||
    props.lifecycle === "attention" ||
    props.collapsed === false ||
    confirmation.current !== undefined;
  const itemActivity = visibleItems.length === 0 ? null : (
    <div className="agent-activity">
      {visibleItems.map((item, index) => {
        const current = props.lifecycle !== "settled" &&
          confirmation.current === undefined &&
          index === visibleItems.length - 1 &&
          isActiveActivityItem(item);
        const toolKind = item.toolKind ?? resolveActivityToolKind(item);
        const selectable = props.onSelectItem !== undefined &&
          (props.selectableItemKeys === undefined || props.selectableItemKeys.includes(item.key));
        const selected = selectable && props.selectedItemKey === item.key;
        if (item.variant === "context_compaction") {
          return <ContextCompactionStatusLine current={current} item={item} key={item.key} />;
        }
        return (
          <ActivityRecord
            current={current}
            item={item}
            key={item.key}
            selectable={selectable}
            selected={selected}
            toolKind={toolKind}
            onSelectItem={props.onSelectItem}
          />
        );
      })}
    </div>
  );

  const confirmationActivity = confirmation.current === undefined ? null : (
    <div className="agent-confirmation-activity">
      <ConfirmationNode
        confirmation={confirmation.current}
        busy={props.confirmationBusy}
        onDecision={props.onDecision}
      />
    </div>
  );

  const worklineProps = {
    className: "agent-workline",
    "aria-label": "运行过程",
    "data-surface": props.presentation === "agent_work" ? "tools" : "records",
    "data-lifecycle": props.lifecycle,
    "data-collapse-reason": props.collapseReason,
  } as const;

  if (props.presentation === "agent_work" && reasoningOnly) {
    return (
      <section {...worklineProps} data-reasoning-only="true">
        <ReasoningDisclosure autoOpen={autoOpenWorkRecords} items={visibleItems} />
        {confirmationActivity}
      </section>
    );
  }

  if (props.presentation === "agent_work" && confirmation.current === undefined) {
    return (
      <section {...worklineProps}>
        {visibleItems.length > 0 && (
          <WorkRecordDisclosure autoOpen={autoOpenWorkRecords}>{itemActivity}</WorkRecordDisclosure>
        )}
      </section>
    );
  }

  if (props.presentation === "agent_work" && confirmation.current !== undefined) {
    return (
      <section {...worklineProps}>
        {visibleItems.length > 0 && (
          <WorkRecordDisclosure autoOpen={autoOpenWorkRecords}>{itemActivity}</WorkRecordDisclosure>
        )}
        {confirmationActivity}
      </section>
    );
  }

  if (props.collapsed === true && confirmation.current === undefined) {
    return (
      <section {...worklineProps}>
        {visibleItems.length > 0 && (
          <WorkRecordDisclosure autoOpen={false}>{itemActivity}</WorkRecordDisclosure>
        )}
      </section>
    );
  }

  return (
    <section {...worklineProps}>
      {itemActivity}
      {confirmationActivity}
    </section>
  );
}, agentWorkTimelinePropsEqual);

function WorkRecordDisclosure(props: {
  readonly autoOpen: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useAutoSynchronizedDisclosure(props.autoOpen);

  return (
    <details
      className="agent-workline-disclosure"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="agent-workline-summary" aria-label={open ? "收起过程" : "展开过程"}>
        <ChevronRight className="agent-workline-summary-chevron" size={14} aria-hidden="true" />
        <span className="agent-workline-summary-text">过程</span>
      </summary>
      {props.children}
    </details>
  );
}

function ReasoningDisclosure(props: {
  readonly autoOpen: boolean;
  readonly items: readonly ActivityItem[];
}): React.ReactElement {
  const [open, setOpen] = useAutoSynchronizedDisclosure(props.autoOpen);
  const active = props.items.some(isActiveActivityItem);

  return (
    <details
      className="agent-reasoning-disclosure"
      open={open}
      data-running={active ? "true" : undefined}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={open ? "收起思考过程" : "展开思考过程"}>
        <ChevronRight className="agent-reasoning-chevron" size={14} aria-hidden="true" />
        <span>{active ? "思考中" : "思考过程"}</span>
      </summary>
      <div className="agent-reasoning-body">
        {props.items.map((item) => <ActivityEvidencePanel item={item} key={item.key} />)}
      </div>
    </details>
  );
}

function useAutoSynchronizedDisclosure(autoOpen: boolean): readonly [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [open, setOpen] = React.useState(autoOpen);
  const previousAutoOpen = React.useRef(autoOpen);
  React.useLayoutEffect(() => {
    if (previousAutoOpen.current === autoOpen) return;
    previousAutoOpen.current = autoOpen;
    // Lifecycle-driven folding must land before paint; otherwise a completed
    // reasoning block remains visibly open for one frame after the dots vanish.
    setOpen(autoOpen);
  }, [autoOpen]);
  return [open, setOpen] as const;
}

function ActivityRecord(props: {
  readonly item: ActivityItem;
  readonly current: boolean;
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly toolKind: ActivityToolKind;
  readonly onSelectItem?: (item: ActivityItem) => void;
}): React.ReactElement {
  const hasChildren = (props.item.children?.length ?? 0) > 0;
  const expandable = shouldRenderExpandedDetail(props.item);
  const recordClass = classNames("agent-record", props.item.tone, props.item.phase);
  const summary = (
    <ActivityRecordSummary
      item={props.item}
      current={props.current}
      expandable={expandable}
      toolKind={props.toolKind}
      asSummary={false}
    />
  );

  if (props.selectable) {
    return (
      <div className="agent-record-group">
        <button
          type="button"
          className={classNames(recordClass, "agent-record-selectable")}
          data-current={props.current ? "true" : undefined}
          data-selected={props.selected ? "true" : undefined}
          data-selectable="true"
          data-tool-kind={props.toolKind}
          data-running={isActiveActivityItem(props.item) ? "true" : undefined}
          aria-current={props.current ? "step" : undefined}
          aria-pressed={props.selected}
          onClick={() => props.onSelectItem?.(props.item)}
        >
          {summary}
        </button>
        {hasChildren && <NestedActivityRecords items={props.item.children!} />}
      </div>
    );
  }

  if (!expandable) {
    const record = (
      <div
        className={recordClass}
        data-current={props.current ? "true" : undefined}
        data-tool-kind={props.toolKind}
        data-running={isActiveActivityItem(props.item) ? "true" : undefined}
        aria-current={props.current ? "step" : undefined}
      >
        {summary}
      </div>
    );
    return hasChildren ? (
      <div className="agent-record-group">
        {record}
        <NestedActivityRecords items={props.item.children!} />
      </div>
    ) : record;
  }

  const record = (
    <ActivityRecordDisclosure
      className={recordClass}
      initiallyOpen={isReasoningActivityItem(props.item)}
      current={props.current}
      toolKind={props.toolKind}
      running={isActiveActivityItem(props.item)}
    >
      <ActivityRecordSummary
        item={props.item}
        current={props.current}
        expandable={expandable}
        toolKind={props.toolKind}
        asSummary
      />
      <div className="agent-record-body">
        <ActivityEvidencePanel item={props.item} />
      </div>
    </ActivityRecordDisclosure>
  );
  return hasChildren ? (
    <div className="agent-record-group">
      {record}
      <NestedActivityRecords items={props.item.children!} />
    </div>
  ) : record;
}

function ActivityRecordDisclosure(props: {
  readonly className: string;
  readonly initiallyOpen: boolean;
  readonly current: boolean;
  readonly toolKind: ActivityToolKind;
  readonly running: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = React.useState(props.initiallyOpen);
  return (
    <details
      className={props.className}
      open={open}
      data-current={props.current ? "true" : undefined}
      data-tool-kind={props.toolKind}
      data-running={props.running ? "true" : undefined}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {props.children}
    </details>
  );
}

function NestedActivityRecords(props: { readonly items: readonly ActivityItem[] }): React.ReactElement {
  return (
    <div className="agent-record-children" aria-label="子 Agent 操作">
      {props.items.map((item, index) => (
        <ActivityRecord
          current={index === props.items.length - 1 && isActiveActivityItem(item)}
          item={item}
          key={item.key}
          selectable={false}
          selected={false}
          toolKind={item.toolKind ?? resolveActivityToolKind(item)}
        />
      ))}
    </div>
  );
}

function ActivityRecordSummary(props: {
  readonly item: ActivityItem;
  readonly current: boolean;
  readonly expandable: boolean;
  readonly toolKind: ActivityToolKind;
  readonly asSummary?: boolean;
}): React.ReactElement {
  const lead = visibleLeadForItem(props.item);
  if (lead === undefined) {
    const Tag = props.asSummary === true ? "summary" : "div";
    return (
      <Tag className="agent-record-summary">
        <ActivityRecordIcon toolKind={props.toolKind} />
        <span className="agent-record-content">
          <span className="agent-record-title">{props.item.copy.detail}</span>
        </span>
        <RecordTrailing
          expandable={props.expandable}
          attention={itemNeedsAttention(props.item)}
          lineDelta={props.item.lineDelta}
          elapsedSince={props.toolKind === "command" && isActiveActivityItem(props.item) ? props.item.startedAt : undefined}
        />
      </Tag>
    );
  }
  const context = lead.context ?? firstAttentionBadge(props.item);
  const Tag = props.asSummary === true ? "summary" : "div";
  return (
    <Tag className="agent-record-summary">
      <ActivityRecordIcon toolKind={props.toolKind} />
      <span className="agent-record-content">
        <span className="agent-record-title" aria-label={`${lead.action} ${lead.subject}`}>
          <span className="agent-record-subject" data-monospace={lead.monospace === true ? "true" : undefined}>
            {lead.subject}
          </span>
        </span>
        {context !== undefined && <span className="agent-record-context">{context}</span>}
      </span>
      <RecordTrailing
        expandable={props.expandable}
        attention={itemNeedsAttention(props.item)}
        lineDelta={props.item.lineDelta}
        elapsedSince={props.toolKind === "command" && isActiveActivityItem(props.item) ? props.item.startedAt : undefined}
      />
    </Tag>
  );
}

function visibleLeadForItem(item: ActivityItem): ActivityLead | undefined {
  if (item.tone !== "tool") return undefined;
  if (item.toolKind === "command") {
    return {
      action: "运行",
      subject: "终端",
      context: item.lead?.context,
    };
  }
  return item.lead ?? { action: item.copy.label ?? "操作", subject: item.copy.detail };
}

function ActivityRecordIcon(props: { readonly toolKind: ActivityToolKind }): React.ReactElement {
  const Icon = toolIconForKind(props.toolKind);
  return (
    <span className="agent-record-icon" aria-hidden="true">
      <Icon size={14} strokeWidth={1.8} />
    </span>
  );
}

function toolIconForKind(kind: ActivityToolKind): LucideIcon {
  if (kind === "command") return Terminal;
  if (kind === "search") return Search;
  if (kind === "read") return FileText;
  if (kind === "directory") return FolderOpen;
  if (kind === "edit") return Pencil;
  if (kind === "web") return Globe2;
  if (kind === "agent") return Bot;
  if (kind === "other") return Files;
  return ListTree;
}

function RecordTrailing(props: {
  readonly expandable: boolean;
  readonly attention: boolean;
  readonly lineDelta?: ActivityItem["lineDelta"];
  readonly elapsedSince?: string;
}): React.ReactElement {
  return (
    <span className="agent-record-trailing">
      {props.attention && <CircleAlert className="agent-record-alert" size={13} aria-label="需要注意" />}
      {props.elapsedSince !== undefined && <ElapsedTime startedAt={props.elapsedSince} />}
      {props.lineDelta !== undefined && (
        <span
          className="agent-record-line-delta"
          aria-label={`新增 ${props.lineDelta.added} 行，删除 ${props.lineDelta.removed} 行`}
        >
          {props.lineDelta.added > 0 && (
            <span className="agent-record-line-delta-add">+{props.lineDelta.added}</span>
          )}
          {props.lineDelta.removed > 0 && (
            <span className="agent-record-line-delta-remove">-{props.lineDelta.removed}</span>
          )}
        </span>
      )}
      {props.expandable
        ? <ChevronRight className="agent-record-chevron" size={14} aria-hidden="true" />
        : <span className="agent-record-chevron-spacer" aria-hidden="true" />}
    </span>
  );
}

function ElapsedTime(props: { readonly startedAt: string }): React.ReactElement | null {
  const startedAt = Date.parse(props.startedAt);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [props.startedAt]);
  if (!Number.isFinite(startedAt)) return null;
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  if (elapsedSeconds < 2) return null;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const text = minutes === 0 ? `${seconds}s` : `${minutes}:${String(seconds).padStart(2, "0")}`;
  return <span className="agent-record-elapsed" aria-label={`已运行 ${elapsedSeconds} 秒`}>{text}</span>;
}

function ContextCompactionStatusLine(props: {
  readonly item: ActivityItem;
  readonly current: boolean;
}): React.ReactElement {
  const status = props.item.phase === "failed" || props.item.phase === "blocked"
    ? "failed"
    : props.item.phase === "completed"
      ? "completed"
      : "running";
  return (
    <div
      className="context-compaction-step"
      data-current={props.current ? "true" : undefined}
      data-status={status}
      aria-current={props.current ? "step" : undefined}
    >
      <span className="context-compaction-rule" aria-hidden="true" />
      <span className="context-compaction-label">{props.item.copy.detail}</span>
      <span className="context-compaction-rule" aria-hidden="true" />
    </div>
  );
}

function shouldRenderExpandedDetail(item: ActivityItem): boolean {
  return (item.expandedSections?.length ?? 0) > 0 || item.copy.expandedDetail !== undefined;
}

function itemNeedsAttention(item: ActivityItem): boolean {
  if (item.phase === "failed" || item.phase === "blocked" || item.phase === "cancelled") return true;
  if (item.statusBadge?.tone === "danger" || item.statusBadge?.tone === "warning") return true;
  return item.badges?.some((badge) => badge.tone === "danger" || badge.tone === "warning") === true;
}

function isActiveActivityItem(item: ActivityItem): boolean {
  return item.phase === "executing" || item.phase === "preparing" || item.phase === "noted";
}

function isReasoningActivityItem(item: ActivityItem): boolean {
  return item.eventType.startsWith("model.reasoning.");
}

function firstAttentionBadge(item: ActivityItem): string | undefined {
  return item.badges?.find((badge) => badge.tone === "danger" || badge.tone === "warning")?.label ??
    (item.statusBadge?.tone === "danger" || item.statusBadge?.tone === "warning"
      ? item.statusBadge.label
      : undefined);
}

function classNames(...values: readonly (string | false | undefined)[]): string {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}

function agentWorkTimelinePropsEqual(left: AgentWorkTimelineProps, right: AgentWorkTimelineProps): boolean {
  return left.presentation === right.presentation &&
    left.collapsed === right.collapsed &&
    left.lifecycle === right.lifecycle &&
    left.collapseReason === right.collapseReason &&
    left.selectedItemKey === right.selectedItemKey &&
    stringListsEqual(left.selectableItemKeys, right.selectableItemKeys) &&
    left.onSelectItem === right.onSelectItem &&
    left.onDecision === right.onDecision &&
    left.confirmationBusy === right.confirmationBusy &&
    timelineViewsEqual(left.view, right.view);
}

function timelineViewsEqual(
  left: AgentWorkTimelineView<TranscriptNode, ConfirmationProjection>,
  right: AgentWorkTimelineView<TranscriptNode, ConfirmationProjection>
): boolean {
  if (left === right) return true;
  return left.hasContent === right.hasContent &&
    activityItemsEqual(left.items, right.items) &&
    left.confirmation.current === right.confirmation.current &&
    left.confirmation.currentNodeId === right.confirmation.currentNodeId;
}

function activityItemsEqual(left: readonly ActivityItem[], right: readonly ActivityItem[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!activityItemEqual(left[index], right[index])) return false;
  }
  return true;
}

function activityItemEqual(left: ActivityItem | undefined, right: ActivityItem | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.nodeId === right.nodeId &&
    left.key === right.key &&
    left.eventType === right.eventType &&
    left.toolCallFactId === right.toolCallFactId &&
    left.parentToolCallFactId === right.parentToolCallFactId &&
    left.variant === right.variant &&
    left.tone === right.tone &&
    left.phase === right.phase &&
    left.startedAt === right.startedAt &&
    left.toolKind === right.toolKind &&
    activityLeadsEqual(left.lead, right.lead) &&
    lineDeltasEqual(left.lineDelta, right.lineDelta) &&
    left.copy.label === right.copy.label &&
    left.copy.detail === right.copy.detail &&
    left.copy.expandedDetail === right.copy.expandedDetail &&
    badgesEqual(left.statusBadge, right.statusBadge) &&
    badgeListsEqual(left.badges, right.badges) &&
    expandedSectionsEqual(left.expandedSections, right.expandedSections) &&
    activityItemsEqual(left.children ?? [], right.children ?? []);
}

function activityLeadsEqual(left: ActivityLead | undefined, right: ActivityLead | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.action === right.action &&
    left.subject === right.subject &&
    left.context === right.context &&
    left.monospace === right.monospace;
}

function lineDeltasEqual(
  left: ActivityItem["lineDelta"],
  right: ActivityItem["lineDelta"],
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.added === right.added && left.removed === right.removed;
}

function badgeListsEqual(
  left: readonly ActivityBadge[] | undefined,
  right: readonly ActivityBadge[] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!badgesEqual(left[index], right[index])) return false;
  }
  return true;
}

function badgesEqual(left: ActivityBadge | undefined, right: ActivityBadge | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.label === right.label &&
    left.tone === right.tone &&
    left.monospace === right.monospace;
}

function expandedSectionsEqual(
  left: ActivityItem["expandedSections"],
  right: ActivityItem["expandedSections"],
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftSection = left[index];
    const rightSection = right[index];
    if (
      leftSection?.title !== rightSection?.title ||
      leftSection?.content !== rightSection?.content ||
      leftSection?.format !== rightSection?.format ||
      leftSection?.href !== rightSection?.href ||
      leftSection?.note !== rightSection?.note ||
      leftSection?.tone !== rightSection?.tone ||
      !sectionMetaEqual(leftSection?.meta, rightSection?.meta) ||
      !expandedItemsEqual(leftSection?.items, rightSection?.items)
    ) {
      return false;
    }
  }
  return true;
}

function expandedItemsEqual(
  left: NonNullable<ActivityItem["expandedSections"]>[number]["items"],
  right: NonNullable<ActivityItem["expandedSections"]>[number]["items"],
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (
      leftItem?.title !== rightItem?.title ||
      leftItem?.detail !== rightItem?.detail ||
      leftItem?.href !== rightItem?.href ||
      leftItem?.monospace !== rightItem?.monospace ||
      !sectionMetaEqual(leftItem?.meta, rightItem?.meta)
    ) {
      return false;
    }
  }
  return true;
}

function sectionMetaEqual(
  left: NonNullable<ActivityItem["expandedSections"]>[number]["meta"],
  right: NonNullable<ActivityItem["expandedSections"]>[number]["meta"],
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.label !== right[index]?.label || left[index]?.value !== right[index]?.value) return false;
  }
  return true;
}

function stringListsEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
