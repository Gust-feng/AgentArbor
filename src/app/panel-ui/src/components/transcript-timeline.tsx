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
import type { TranscriptNode } from "../contracts/run";
import {
  ConfirmationNode,
  type ConfirmationProjection,
} from "./transcript-confirmation";
import {
  type AgentWorkTimelineView,
} from "../../../panel-agent-work-timeline-view";
import type {
  ActivityBadge,
  ActivityItem,
  ActivityExpandedSection,
} from "../../../panel-transcript-activity-copy";
import { resolveActivityToolKind } from "../../../panel-transcript-activity-copy";
import { collapsedTimelineSummary } from "../../../panel-ui-timeline-collapse";

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
  other: Wand2,
};

type AgentWorkTimelineProps = {
  readonly view: AgentWorkTimelineView<TranscriptNode, ConfirmationProjection>;
  readonly collapsed?: boolean;
  readonly lifecycle?: "open" | "settled" | "attention";
  readonly collapseReason?: string;
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
        return (
          <div
            className={`agent-activity-step ${item.tone} ${item.phase}`}
            data-current={current ? "true" : undefined}
            data-tool-kind={toolKind}
            aria-current={current ? "step" : undefined}
            key={item.key}
          >
            <span className="agent-activity-marker" aria-hidden="true" />
            <ActivityLine item={item} />
          </div>
        );
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

type ActivityMetricKind = "web" | "read" | "edit" | "command" | "other";

type ActivityMetric = {
  readonly kind: ActivityMetricKind;
  readonly count: number;
  readonly label: string;
  readonly icon: LucideIcon;
};

function activityMetrics(items: readonly ActivityItem[]): readonly ActivityMetric[] {
  const counts = new Map<ActivityMetricKind, number>();
  for (const item of items) {
    const kind = activityMetricKind(item);
    if (kind === undefined) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (counts.size === 0 && items.length > 0) {
    counts.set("other", items.length);
  }
  return ACTIVITY_METRIC_ORDER
    .map((kind) => {
      const count = counts.get(kind);
      if (count === undefined || count <= 0) return undefined;
      return { ...ACTIVITY_METRIC_DEFS[kind], kind, count };
    })
    .filter((metric): metric is ActivityMetric => metric !== undefined);
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

function ActivityLine({ item }: { readonly item: ActivityItem }): React.ReactElement {
  const toolKind = item.toolKind ?? resolveActivityToolKind(item);
  const Icon = TOOL_KIND_ICON[toolKind] ?? Sparkles;
  const hasExpandedDetail = (item.expandedSections?.length ?? 0) > 0 || item.copy.expandedDetail !== undefined;
  const line = (
    <>
      <span className="agent-activity-label" aria-hidden="true">
        <Icon size={12} strokeWidth={2.25} />
      </span>
      <span className="agent-activity-body">
        {(item.copy.label !== undefined || item.statusBadge !== undefined || (item.badges?.length ?? 0) > 0) && (
          <span className="agent-activity-meta">
            {item.copy.label !== undefined && (
              <ActivityBadgeChip badge={{ label: item.copy.label, tone: badgeToneForKind(toolKind) }} variant="kind" />
            )}
            {item.statusBadge !== undefined && <ActivityBadgeChip badge={item.statusBadge} variant="status" />}
            {item.badges?.map((badge, index) => (
              <ActivityBadgeChip key={`${badge.label}-${index}`} badge={badge} variant="meta" />
            ))}
          </span>
        )}
        <span className="agent-activity-detail">{item.copy.detail}</span>
      </span>
    </>
  );
  if (hasExpandedDetail) {
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

function ExpandedDetailPanel({ item }: { readonly item: ActivityItem }): React.ReactElement {
  const sections = item.expandedSections;
  if (sections !== undefined && sections.length > 0) {
    return (
      <div className="agent-activity-expanded-detail">
        {sections.map((section: ActivityExpandedSection, index: number) => (
          <div
            className="agent-activity-expanded-section"
            data-tone={section.tone}
            key={index}
          >
            <div className="agent-activity-expanded-section-title">{section.title}</div>
            <ExpandedSectionContent section={section} />
          </div>
        ))}
      </div>
    );
  }
  return <p className="agent-activity-expanded-detail">{item.copy.expandedDetail}</p>;
}

function ExpandedSectionContent(props: {
  readonly section: ActivityExpandedSection;
}): React.ReactElement {
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

function ActivityBadgeChip(props: {
  readonly badge: ActivityBadge;
  readonly variant: "kind" | "status" | "meta";
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

function badgeToneForKind(kind: string): ActivityBadge["tone"] {
  if (kind === "command") return "accent";
  if (kind === "search" || kind === "web") return "accent";
  if (kind === "read") return "success";
  if (kind === "edit") return "warning";
  if (kind === 'confirmation') return "warning";
  if (kind === "decision") return "accent";
  return "neutral";
}

function agentWorkTimelinePropsEqual(left: AgentWorkTimelineProps, right: AgentWorkTimelineProps): boolean {
  return left.collapsed === right.collapsed &&
    left.lifecycle === right.lifecycle &&
    left.collapseReason === right.collapseReason &&
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
    left.tone === right.tone &&
    left.phase === right.phase &&
    left.toolKind === right.toolKind &&
    left.copy.label === right.copy.label &&
    left.copy.detail === right.copy.detail &&
    left.copy.expandedDetail === right.copy.expandedDetail &&
    badgesEqual(left.statusBadge, right.statusBadge) &&
    badgeListsEqual(left.badges, right.badges) &&
    expandedSectionsEqual(left.expandedSections, right.expandedSections);
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
      left[i]?.tone !== right[i]?.tone
    ) {
      return false;
    }
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
