import React from "react";
import {
  ChevronRight,
  CircleCheck,
  Cog,
  Compass,
  Eye,
  FileText,
  Globe2,
  PencilLine,
  Scale,
  Search,
  Sparkles,
  Terminal,
  Wand2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { SubAgentRunView, TranscriptNode } from "../contracts/run";
import {
  ConfirmationNode,
  type ConfirmationProjection,
} from "./transcript-confirmation";
import {
  type AgentWorkTimelineView,
} from "../../../panel-agent-work-timeline-view";
import type {
  ActivityBadge,
  ActivityToolKind,
  ActivityItem,
  ActivityExpandedSection,
  ActivityLineDelta,
} from "../../../panel-transcript-activity-copy";
import { resolveActivityToolKind } from "../../../panel-transcript-activity-copy";
import { collapsedTimelineSummary } from "../../../panel-ui-timeline-collapse";
import { SubAgentInlineCard } from "./sub-agent-run-viewer";

export type { ConfirmationProjection } from "./transcript-confirmation";
export { pendingForTurn } from "../../../panel-transcript-confirmation-projection";

const TOOL_KIND_ICON: Record<string, LucideIcon> = {
  command: Terminal,
  search: Search,
  read: Eye,
  edit: PencilLine,
  web: Compass,
  thinking: Zap,
  confirmation: CircleCheck,
  decision: Scale,
  system: Cog,
  sub_agent: Sparkles,
  other: Wand2,
};

type AgentWorkTimelineProps = {
  readonly view: AgentWorkTimelineView<TranscriptNode, ConfirmationProjection>;
  readonly collapsed?: boolean;
  readonly lifecycle?: "open" | "settled" | "attention";
  readonly collapseReason?: string;
  readonly selectedItemKey?: string;
  readonly selectedSubAgentRunId?: string;
  readonly selectedSubAgentBatchId?: string;
  readonly selectableItemKeys?: readonly string[];
  readonly subAgentRuns?: readonly SubAgentRunView[];
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

  const activity = (
    <div className="agent-activity">
      {items.map((item, index) => {
        const current = props.lifecycle !== "settled" && confirmation.current === undefined && index === items.length - 1;
        const toolKind = item.toolKind ?? resolveActivityToolKind(item);
        const selectable = props.onSelectItem !== undefined &&
          (props.selectableItemKeys === undefined || props.selectableItemKeys.includes(item.key));
        const selected = selectable && (
          props.selectedItemKey === item.key ||
          (item.subAgentRunId !== undefined && item.subAgentRunId === props.selectedSubAgentRunId) ||
          (item.subAgentBatchId !== undefined && item.subAgentBatchId === props.selectedSubAgentBatchId)
        );
        if (item.variant === "context_compaction") {
          return (
            <ContextCompactionStatusLine
              current={current}
              item={item}
              key={item.key}
            />
          );
        }
        if (item.variant === "sub_agent") {
          const run = item.subAgentRunId === undefined
            ? undefined
            : props.subAgentRuns?.find((candidate) => candidate.subRunId === item.subAgentRunId);
          const batchRuns = item.subAgentBatchId === undefined
            ? undefined
            : props.subAgentRuns?.filter((candidate) => candidate.batchId === item.subAgentBatchId);
          return timelineStep({
            item,
            current,
            selectable,
            selected,
            toolKind,
            onSelectItem: props.onSelectItem,
            content: (
              <>
                <span className="agent-activity-marker" aria-hidden="true" />
                <SubAgentInlineCard
                  run={run}
                  batchRuns={batchRuns}
                  batchStats={{
                    total: item.subAgentTotalCount,
                    completed: item.subAgentSuccessCount,
                    failed: item.subAgentFailedCount,
                    cancelled: item.subAgentCancelledCount,
                    approvalRequired: item.subAgentApprovalRequiredCount,
                    notStarted: item.subAgentNotStartedCount,
                  }}
                  fallbackTitle={item.copy.label ?? "子 Agent"}
                  fallbackSummary={item.copy.detail}
                />
              </>
            ),
          });
        }
        const content = (
          <>
            <span className="agent-activity-marker" aria-hidden="true" />
            <ActivityLine item={item} />
          </>
        );
        return timelineStep({ item, current, selectable, selected, toolKind, onSelectItem: props.onSelectItem, content });
      })}
      {confirmation.current !== undefined && (
        <div className="agent-activity-step confirmation waiting_approval" data-current="true" aria-current="step">
          <span className="agent-activity-marker" aria-hidden="true" />
          <ConfirmationNode
            confirmation={confirmation.current}
            busy={props.confirmationBusy}
            onDecision={props.onDecision}
          />
        </div>
      )}
    </div>
  );

  if (props.collapsed === true && confirmation.current === undefined) {
    const metrics = activityMetrics(items);
    const summary = collapsedTimelineSummary({
      items,
      hasCurrentConfirmation: false,
    });
    return (
      <section
        className="agent-workline"
        aria-label="工作进度"
        data-lifecycle={props.lifecycle}
        data-collapse-reason={props.collapseReason}
      >
        <details className="agent-workline-disclosure">
          <summary className="agent-workline-summary" aria-label={`展开过程，${summary}`}>
            <span className="agent-workline-summary-status" aria-hidden="true" />
            <span className="agent-workline-summary-text">{summary}</span>
            <span className="agent-workline-summary-metrics" aria-hidden="true">
              {metrics.map((metric) => {
                const Icon = metric.icon;
                return (
                  <span className={`agent-workline-summary-chip ${metric.kind}`} key={metric.kind}>
                    <span className="agent-workline-summary-icon">
                      <Icon size={13} strokeWidth={2.25} />
                    </span>
                    {metric.lineDelta !== undefined && (
                      <LineDeltaIndicator delta={metric.lineDelta} running={metric.lineDeltaRunning === true} />
                    )}
                    <strong>{metric.count}</strong>
                  </span>
                );
              })}
            </span>
            <ChevronRight className="agent-workline-summary-chevron" size={16} aria-hidden="true" />
          </summary>
          {activity}
        </details>
      </section>
    );
  }

  return (
    <section
      className="agent-workline"
      aria-label="工作进度"
      data-lifecycle={props.lifecycle}
      data-collapse-reason={props.collapseReason}
    >
      {activity}
    </section>
  );
}, agentWorkTimelinePropsEqual);

function timelineStep(input: {
  readonly item: ActivityItem;
  readonly current: boolean;
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly toolKind: ActivityToolKind;
  readonly onSelectItem?: (item: ActivityItem) => void;
  readonly content: React.ReactNode;
}): React.ReactElement {
  if (input.selectable) {
    return (
      <button
        type="button"
        className={`agent-activity-step ${input.item.tone} ${input.item.phase}`}
        data-current={input.current ? "true" : undefined}
        data-selected={input.selected ? "true" : undefined}
        data-selectable="true"
        data-tool-kind={input.toolKind}
        aria-current={input.current ? "step" : undefined}
        aria-pressed={input.selected}
        onClick={() => input.onSelectItem?.(input.item)}
        key={input.item.key}
      >
        {input.content}
      </button>
    );
  }
  return (
    <div
      className={`agent-activity-step ${input.item.tone} ${input.item.phase}`}
      data-current={input.current ? "true" : undefined}
      data-selected={input.selected ? "true" : undefined}
      data-tool-kind={input.toolKind}
      aria-current={input.current ? "step" : undefined}
      key={input.item.key}
    >
      {input.content}
    </div>
  );
}

type ActivityMetricKind = "web" | "read" | "edit" | "command" | "other";

type ActivityMetric = {
  readonly kind: ActivityMetricKind;
  readonly count: number;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly lineDelta?: ActivityLineDelta;
  readonly lineDeltaRunning?: boolean;
};

function activityMetrics(items: readonly ActivityItem[]): readonly ActivityMetric[] {
  const counts = new Map<ActivityMetricKind, number>();
  let latestEditDeltaItem: ActivityItem | undefined;
  for (const item of items) {
    const kind = activityMetricKind(item);
    if (kind === undefined) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (kind === "edit" && visibleLineDeltaForItem(item) !== undefined) {
      latestEditDeltaItem = item;
    }
  }
  if (counts.size === 0 && items.length > 0) {
    counts.set("other", items.length);
  }
  const metrics: ActivityMetric[] = [];
  for (const kind of ACTIVITY_METRIC_ORDER) {
    const count = counts.get(kind);
    if (count === undefined || count <= 0) continue;
    const metric: ActivityMetric = { ...ACTIVITY_METRIC_DEFS[kind], kind, count };
    if (kind === "edit" && latestEditDeltaItem !== undefined) {
      const lineDelta = visibleLineDeltaForItem(latestEditDeltaItem);
      if (lineDelta !== undefined) {
        metrics.push({
          ...metric,
          lineDelta,
          lineDeltaRunning: isLineDeltaRunning(latestEditDeltaItem),
        });
        continue;
      }
    }
    metrics.push(metric);
  }
  return metrics;
}

function activityMetricKind(item: ActivityItem): ActivityMetricKind | undefined {
  const label = item.copy.label;
  if (label === "网页" || label === "搜索") return "web";
  if (label === "读取" || label === "查看") return "read";
  if (label === "编辑" || label === "写入" || label === "创建" || label === "删除" || label === "生成") return "edit";
  if (label === "命令") return "command";
  if (item.tone === "tool") return "other";
  return undefined;
}

function ActivityLine(props: {
  readonly item: ActivityItem;
  readonly expandable?: boolean;
}): React.ReactElement {
  const { item } = props;
  const toolKind = item.toolKind ?? resolveActivityToolKind(item);
  const Icon = TOOL_KIND_ICON[toolKind] ?? Sparkles;
  const visibleBadges = visibleBadgesForItem(item);
  const lineDelta = visibleLineDeltaForItem(item);
  const line = (
    <>
      <span className="agent-activity-line-prefix">
        <span className="agent-activity-label" aria-hidden="true">
          <Icon size={12} strokeWidth={2.25} />
        </span>
        {lineDelta !== undefined && (
          <LineDeltaIndicator
            delta={lineDelta}
            running={isLineDeltaRunning(item)}
          />
        )}
      </span>
      <span className="agent-activity-body">
        {visibleBadges.length > 0 && (
          <span className="agent-activity-meta">
            {visibleBadges.map((entry, index) => (
              <ActivityBadgeChip key={`${entry.badge.label}-${index}`} badge={entry.badge} variant={entry.variant} />
            ))}
          </span>
        )}
        <span className="agent-activity-detail">{item.copy.detail}</span>
      </span>
    </>
  );
  if (props.expandable !== false && shouldRenderExpandedDetail(item)) {
    return (
      <details className="agent-activity-disclosure" data-tone={item.tone}>
        <summary className="agent-activity-line">{line}</summary>
        <ExpandedDetailPanel item={item} />
      </details>
    );
  }
  return (
    <p className="agent-activity-line">
      {line}
    </p>
  );
}

function visibleLineDeltaForItem(item: ActivityItem): ActivityLineDelta | undefined {
  if ((item.toolKind ?? resolveActivityToolKind(item)) !== "edit") {
    return undefined;
  }
  const delta = item.lineDelta;
  if (delta === undefined || (delta.added <= 0 && delta.removed <= 0)) {
    return undefined;
  }
  return delta;
}

function isLineDeltaRunning(item: ActivityItem): boolean {
  return item.phase === "executing" || item.phase === "preparing" || item.phase === "noted";
}

function LineDeltaIndicator(props: {
  readonly delta: ActivityLineDelta;
  readonly running: boolean;
}): React.ReactElement {
  return (
    <span
      className="agent-activity-line-delta"
      data-running={props.running ? "true" : undefined}
      aria-label={`新增 ${props.delta.added} 行，删除 ${props.delta.removed} 行`}
    >
      {props.delta.added > 0 && (
        <span className="agent-activity-line-delta-add">+{props.delta.added}</span>
      )}
      {props.delta.removed > 0 && (
        <span className="agent-activity-line-delta-remove">-{props.delta.removed}</span>
      )}
    </span>
  );
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
      <span className="context-compaction-label">
        {props.item.copy.detail}
      </span>
      <span className="context-compaction-rule" aria-hidden="true" />
    </div>
  );
}

function shouldRenderExpandedDetail(item: ActivityItem): boolean {
  const sections = item.expandedSections ?? [];
  if (item.tone === "tool" || item.tone === 'confirmation' || item.tone === "decision") {
    return sections.length > 0 || item.copy.expandedDetail !== undefined;
  }
  const hasStructuredSections = sections.some((section) => section.title !== "详情");
  if (!itemNeedsAttention(item)) return false;
  if (hasStructuredSections) return true;
  if (item.tone === "thinking" || item.tone === "narration" || item.tone === "system") {
    return false;
  }
  return sections.length > 0 || item.copy.expandedDetail !== undefined;
}

function itemNeedsAttention(item: ActivityItem): boolean {
  if (item.tone === 'confirmation' || item.tone === "decision") {
    return true;
  }
  if (item.phase === "failed" || item.phase === "blocked" || item.phase === "cancelled") {
    return true;
  }
  if (item.statusBadge?.tone === "danger" || item.statusBadge?.tone === "warning") {
    return true;
  }
  if (item.badges?.some((badge) => badge.tone === "danger" || badge.tone === "warning")) {
    return true;
  }
  return item.tone === "tool" && item.phase !== "completed";
}

function ExpandedDetailPanel({ item }: { readonly item: ActivityItem }): React.ReactElement {
  const sections = item.expandedSections;
  if (sections !== undefined && sections.length > 0) {
    return (
      <div className="agent-activity-expanded-detail">
        {sections.map((section: ActivityExpandedSection, index: number) => (
          <div
            className="agent-activity-expanded-section"
            data-tone={section.tone}
            data-title-hidden={shouldHideExpandedSectionTitle(section, sections) ? "true" : undefined}
            key={index}
          >
            {!shouldHideExpandedSectionTitle(section, sections) && (
              <div className="agent-activity-expanded-section-title">{section.title}</div>
            )}
            <ExpandedSectionContent section={section} />
          </div>
        ))}
      </div>
    );
  }
  return <p className="agent-activity-expanded-detail">{item.copy.expandedDetail}</p>;
}

function shouldHideExpandedSectionTitle(
  section: ActivityExpandedSection,
  sections: readonly ActivityExpandedSection[],
): boolean {
  if (sections.length !== 1) {
    return false;
  }
  return section.format === "diff" ||
    section.format === "code" ||
    section.format === "quote" ||
    section.format === "list";
}

function ExpandedSectionContent(props: {
  readonly section: ActivityExpandedSection;
}): React.ReactElement {
  if (props.section.format === "source") {
    const showHref = props.section.href !== undefined && props.section.href !== props.section.content;
    return (
      <div className="agent-activity-expanded-section-content agent-activity-source">
        <div className="agent-activity-source-title">{props.section.content}</div>
        {(props.section.meta?.length ?? 0) > 0 && (
          <div className="agent-activity-source-meta">
            {props.section.meta?.map((item, index) => (
              <span
                className="agent-activity-source-meta-item"
                aria-label={item.label === undefined ? undefined : `${item.label}：${item.value}`}
                key={`${index}-${item.value}`}
              >
                {item.value}
              </span>
            ))}
          </div>
        )}
        {showHref && (
          <a
            className="agent-activity-source-url"
            href={props.section.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {props.section.href}
          </a>
        )}
      </div>
    );
  }
  if (props.section.format === "quote") {
    return (
      <blockquote className="agent-activity-expanded-section-content agent-activity-quote">
        {props.section.content}
      </blockquote>
    );
  }
  if (props.section.format === "diff") {
    return (
      <pre className="agent-activity-expanded-section-content agent-activity-diff" aria-label={props.section.title}>
        {props.section.content.split("\n").map((line, index) => {
          const parts = diffLineParts(line);
          return (
            <span
              className="agent-activity-diff-line"
              data-kind={parts.kind}
              key={`${index}-${line}`}
            >
              <span className="agent-activity-diff-marker" aria-hidden="true">{parts.marker}</span>
              <code>{parts.text.length === 0 ? " " : parts.text}</code>
            </span>
          );
        })}
      </pre>
    );
  }
  if (props.section.format === "code") {
    return (
      <pre className="agent-activity-expanded-section-content agent-activity-expanded-code">
        <code>{props.section.content}</code>
      </pre>
    );
  }
  if (props.section.format === "list") {
    return (
      <ul className="agent-activity-expanded-section-content agent-activity-expanded-list">
        {props.section.content
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
      </ul>
    );
  }
  return <div className="agent-activity-expanded-section-content">{props.section.content}</div>;
}

type DiffLineKind = "add" | "delete" | "hunk" | "file" | "context";

function diffLineParts(line: string): {
  readonly kind: DiffLineKind;
  readonly marker: string;
  readonly text: string;
} {
  if (line.startsWith("@@")) {
    return { kind: "hunk", marker: "@", text: line };
  }
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---")) {
    return { kind: "file", marker: "", text: line };
  }
  if (line.startsWith("+")) {
    return { kind: "add", marker: "+", text: line.slice(1) };
  }
  if (line.startsWith("-")) {
    return { kind: "delete", marker: "-", text: line.slice(1) };
  }
  if (line.startsWith(" ")) {
    return { kind: "context", marker: "", text: line.slice(1) };
  }
  return { kind: "context", marker: "", text: line };
}

type VisibleBadgeEntry = {
  readonly badge: ActivityBadge;
  readonly variant: "status" | "meta";
};

function visibleBadgesForItem(item: ActivityItem): readonly VisibleBadgeEntry[] {
  const badges: VisibleBadgeEntry[] = [];
  if (item.statusBadge !== undefined && shouldShowStatusBadge(item.statusBadge)) {
    badges.push({ badge: item.statusBadge, variant: "status" });
  }
  for (const badge of item.badges ?? []) {
    if (shouldShowMetaBadge(badge)) {
      badges.push({ badge, variant: "meta" });
    }
  }
  return badges;
}

function shouldShowStatusBadge(badge: ActivityBadge): boolean {
  if (badge.tone === "danger" || badge.tone === "warning") {
    return true;
  }
  return badge.label !== "已完成" && badge.label !== "压缩完成";
}

function shouldShowMetaBadge(badge: ActivityBadge): boolean {
  return badge.tone === "danger" || badge.tone === "warning";
}

function ActivityBadgeChip(props: {
  readonly badge: ActivityBadge;
  readonly variant: "status" | "meta";
}): React.ReactElement {
  return (
    <span
      className={`agent-activity-chip ${props.variant}`}
      data-tone={props.badge.tone ?? "neutral"}
      data-monospace={props.badge.monospace === true ? "true" : undefined}
    >
      {props.badge.label}
    </span>
  );
}

function agentWorkTimelinePropsEqual(left: AgentWorkTimelineProps, right: AgentWorkTimelineProps): boolean {
  return left.collapsed === right.collapsed &&
    left.lifecycle === right.lifecycle &&
    left.collapseReason === right.collapseReason &&
    left.selectedItemKey === right.selectedItemKey &&
    left.selectedSubAgentRunId === right.selectedSubAgentRunId &&
    left.selectedSubAgentBatchId === right.selectedSubAgentBatchId &&
    left.subAgentRuns === right.subAgentRuns &&
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
    left.variant === right.variant &&
    left.tone === right.tone &&
    left.phase === right.phase &&
    left.toolKind === right.toolKind &&
    left.subAgentRunId === right.subAgentRunId &&
    left.subAgentBatchId === right.subAgentBatchId &&
    left.subAgentTotalCount === right.subAgentTotalCount &&
    left.subAgentSuccessCount === right.subAgentSuccessCount &&
    left.subAgentFailedCount === right.subAgentFailedCount &&
    left.subAgentCancelledCount === right.subAgentCancelledCount &&
    left.subAgentApprovalRequiredCount === right.subAgentApprovalRequiredCount &&
    left.subAgentNotStartedCount === right.subAgentNotStartedCount &&
    lineDeltasEqual(left.lineDelta, right.lineDelta) &&
    left.copy.label === right.copy.label &&
    left.copy.detail === right.copy.detail &&
    left.copy.expandedDetail === right.copy.expandedDetail &&
    badgesEqual(left.statusBadge, right.statusBadge) &&
    badgeListsEqual(left.badges, right.badges) &&
    expandedSectionsEqual(left.expandedSections, right.expandedSections);
}

function lineDeltasEqual(left: ActivityLineDelta | undefined, right: ActivityLineDelta | undefined): boolean {
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
  left: readonly ActivityExpandedSection[] | undefined,
  right: readonly ActivityExpandedSection[] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (
      left[i]?.title !== right[i]?.title ||
      left[i]?.content !== right[i]?.content ||
      left[i]?.format !== right[i]?.format ||
      left[i]?.href !== right[i]?.href ||
      !sectionMetaEqual(left[i]?.meta, right[i]?.meta) ||
      left[i]?.tone !== right[i]?.tone
    ) {
      return false;
    }
  }
  return true;
}

function sectionMetaEqual(
  left: ActivityExpandedSection["meta"],
  right: ActivityExpandedSection["meta"],
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.label !== right[index]?.label || left[index]?.value !== right[index]?.value) {
      return false;
    }
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

const ACTIVITY_METRIC_ORDER: readonly ActivityMetricKind[] = ["web", "read", "edit", "command", "other"];

const ACTIVITY_METRIC_DEFS: Record<ActivityMetricKind, Omit<ActivityMetric, "kind" | "count">> = {
  web: { label: "网页", icon: Globe2 },
  read: { label: "读取", icon: FileText },
  edit: { label: "编辑", icon: PencilLine },
  command: { label: "命令", icon: Terminal },
  other: { label: "动作", icon: Sparkles },
};
