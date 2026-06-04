import { sanitizeFailureCopy, userVisibleAnswer } from "./panel-assistant-visible-text.js";

export type AssistantFailureParts = {
  readonly previous: string;
  readonly error: string;
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
