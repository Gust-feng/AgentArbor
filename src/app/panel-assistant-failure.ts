import { sanitizeFailureCopy, userVisibleAnswer } from "./panel-assistant-visible-text.js";

export type AssistantFailureParts = {
  readonly previous: string;
  readonly error: string;
};

export type FailureEchoTranscriptNode = {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly kind: "thinking" | "tool" | "confirmation" | "user_decision" | "answer" | "body" | "system";
  readonly phase:
    | "noted"
    | "preparing"
    | "waiting_approval"
    | "approved"
    | "denied"
    | "guidance"
    | "executing"
    | "completed"
    | "failed"
    | "blocked"
    | "cancelled";
  readonly text?: string;
  readonly summary?: string;
  readonly title: string;
  readonly timestamp: string;
  readonly refs: readonly {
    readonly kind: string;
    readonly id: string;
    readonly label?: string;
  }[];
};

export function assistantFailureParts(content: string): AssistantFailureParts {
  const visible = userVisibleAnswer(content).trim();
  const marker = "\n\n错误信息：";
  const markerIndex = visible.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return {
      previous: visible.slice(0, markerIndex).trim(),
      error: `错误信息：${sanitizeFailureCopy(visible.slice(markerIndex + marker.length))}`,
    };
  }
  return {
    previous: "",
    error: sanitizeFailureCopy(visible),
  };
}

export function transcriptNodesWithoutFailureEcho<TNode extends FailureEchoTranscriptNode>(
  nodes: readonly TNode[] | undefined,
  failure: AssistantFailureParts | undefined,
): readonly TNode[] | undefined {
  if (nodes === undefined || failure === undefined) {
    return nodes;
  }
  const comparableError = comparableFailureText(failure.error);
  if (comparableError.length === 0) {
    return nodes;
  }
  const filtered = nodes.filter((node) => !isFailureEchoNode(node, comparableError));
  return filtered.length === nodes.length ? nodes : filtered;
}

function isFailureEchoNode(node: FailureEchoTranscriptNode, comparableError: string): boolean {
  if (node.kind === "body" || node.kind === "answer") {
    return false;
  }
  const comparableNodeText = comparableFailureText(node.text ?? node.summary ?? node.title);
  return comparableNodeText.length > 0 && comparableNodeText === comparableError;
}

function comparableFailureText(value: string): string {
  return sanitizeFailureCopy(userVisibleAnswer(value).replace(/^错误信息[:：]\s*/u, ""))
    .replace(/\s+/g, " ")
    .trim();
}
