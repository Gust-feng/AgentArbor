import React from "react";
import {
  ChevronRight,
  FileText,
  Globe2,
  PencilLine,
  Sparkles,
  Terminal,
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
import type { ActivityItem } from "../../../panel-transcript-activity-copy";
import { collapsedTimelineSummary } from "../../../panel-ui-timeline-collapse";

export type { ConfirmationProjection } from "./transcript-confirmation";
export { pendingForTurn } from "../../../panel-transcript-confirmation-projection";

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
        return (
          <div
            className={`agent-activity-step ${item.tone} ${item.phase}`}
            data-current={current ? "true" : undefined}
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
  const label = item.copy.label;
  const line = (
    <>
      {label !== undefined && <span className="agent-activity-label">{label}</span>}
      <span className="agent-activity-detail">{item.copy.detail}</span>
    </>
  );
  if (item.copy.expandedDetail !== undefined) {
    return (
      <details className="agent-activity-disclosure" data-tone={item.tone}>
        <summary className="agent-activity-line">{line}</summary>
        <p className="agent-activity-expanded-detail">{item.copy.expandedDetail}</p>
      </details>
    );
  }
  return (
    <p className="agent-activity-line">
      {line}
    </p>
  );
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
    left.copy.label === right.copy.label &&
    left.copy.detail === right.copy.detail &&
    left.copy.expandedDetail === right.copy.expandedDetail;
}

const ACTIVITY_METRIC_ORDER: readonly ActivityMetricKind[] = ["web", "read", "edit", "command", "other"];

const ACTIVITY_METRIC_DEFS: Record<ActivityMetricKind, Omit<ActivityMetric, "kind" | "count">> = {
  web: { label: "网页", icon: Globe2 },
  read: { label: "读取", icon: FileText },
  edit: { label: "编辑", icon: PencilLine },
  command: { label: "命令", icon: Terminal },
  other: { label: "动作", icon: Sparkles },
};
