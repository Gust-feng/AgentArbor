import React from "react";
import type { StreamingTextTone } from "../streaming-text";

/**
 * 流式输出调度器
 * 将不规律的后端推送转换为固定节奏的前端显示
 */
export function LiveStreamBox({
  text,
  live,
  tone = "formal",
  renderText,
  renderStreamingText,
}: {
  readonly text: string;
  readonly live: boolean;
  readonly animateOnMount?: boolean;
  readonly tone?: StreamingTextTone;
  readonly renderText?: (text: string) => React.ReactNode;
  readonly renderStreamingText?: (text: string) => React.ReactNode;
}): React.ReactElement {
  const rendered = live && renderStreamingText !== undefined
    ? renderStreamingText(text)
    : renderText === undefined ? text : renderText(text);

  return (
    <div
      className={`live-stream-box ${live ? "streaming" : "settled"} ${tone}`}
      aria-live={live ? "polite" : "off"}
      aria-atomic="false"
    >
      {rendered}
    </div>
  );
}
