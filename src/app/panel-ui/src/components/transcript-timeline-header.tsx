import React from "react";
import { ChevronDown } from "lucide-react";
import { compact } from "../text";
import type { TranscriptNode } from "../contracts/run";
import { LiveStreamBox } from "./live-stream-text";
import { isModelSideOutputNode } from "./transcript-node-visibility";
import {
  timelineRowMeta,
  timelineRowPrimary,
  timelineRowSecondary,
  timelineToolTarget,
  timelineToolVerb,
} from "./transcript-timeline-copy";

export function TimelineEventHeader(props: {
  readonly node: TranscriptNode;
  readonly expandable: boolean;
  readonly open: boolean;
  readonly toggleOpen: () => void;
}): React.ReactElement {
  if (props.node.kind === "thinking") {
    return <ThinkingHeader node={props.node} />;
  }
  if (isModelSideOutputNode(props.node)) {
    return <ModelSideOutputHeader node={props.node} />;
  }
  if (props.node.kind === "tool") {
    return <ToolHeader {...props} node={props.node} />;
  }

  const body = (
    <>
      <span className="agent-timeline-event-main">
        <strong>{timelineRowPrimary(props.node)}</strong>
        {timelineRowSecondary(props.node) !== undefined && <span>{timelineRowSecondary(props.node)}</span>}
      </span>
      {timelineRowMeta(props.node) !== undefined && <small>{timelineRowMeta(props.node)}</small>}
      {props.expandable && <ChevronDown size={15} aria-hidden="true" />}
    </>
  );
  if (!props.expandable) {
    return <div className="agent-timeline-event static">{body}</div>;
  }
  return (
    <button
      type="button"
      className="agent-timeline-event"
      aria-expanded={props.open}
      onClick={props.toggleOpen}
    >
      {body}
    </button>
  );
}

function ThinkingHeader(props: { readonly node: TranscriptNode }): React.ReactElement {
  const rawText = (props.node.text ?? props.node.summary ?? "").trim();
  const live = props.node.eventType === "model.reasoning.delta" && props.node.phase !== "completed";
  const text = live ? rawText : compact(rawText, 360);
  return (
    <div className="agent-thinking-line" data-live={live ? "true" : "false"}>
      <LiveStreamBox text={text} live={live} tone="thinking" />
    </div>
  );
}

function ModelSideOutputHeader(props: { readonly node: TranscriptNode }): React.ReactElement {
  const rawText = (props.node.text ?? props.node.summary ?? "").trim();
  const live = props.node.eventType === "model.output.side";
  const text = live ? rawText : compact(rawText, 260);
  return (
    <div className="agent-model-output-line" data-live={live ? "true" : "false"}>
      <LiveStreamBox text={text} live={live} tone="process" />
    </div>
  );
}

function ToolHeader(props: {
  readonly node: TranscriptNode;
  readonly expandable: boolean;
  readonly open: boolean;
  readonly toggleOpen: () => void;
}): React.ReactElement {
  const target = timelineToolTarget(props.node);
  const body = (
    <>
      <span className="agent-tool-line-main">
        <span className="agent-tool-action">{timelineToolVerb(props.node)}</span>
        {target !== undefined && <span className="agent-tool-target">{target}</span>}
      </span>
      {timelineRowMeta(props.node) !== undefined && <small>{timelineRowMeta(props.node)}</small>}
      {props.expandable && <ChevronDown size={14} aria-hidden="true" />}
    </>
  );
  if (!props.expandable) {
    return <div className="agent-timeline-event agent-tool-line static">{body}</div>;
  }
  return (
    <button
      type="button"
      className="agent-timeline-event agent-tool-line"
      aria-expanded={props.open}
      onClick={props.toggleOpen}
    >
      {body}
    </button>
  );
}
