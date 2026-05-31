import React, { useEffect, useLayoutEffect, useRef } from "react";
import {
  consumeStreamingTextFrame,
  createStreamingTextState,
  updateStreamingTextTarget,
  type StreamingTextState,
  type StreamingTextTone,
} from "../../../panel-ui-streaming";

/**
 * 流式输出调度器
 * 将不规律的后端推送转换为固定节奏的前端显示
 */
export function LiveStreamBox({
  text,
  live,
  tone = "formal",
}: {
  readonly text: string;
  readonly live: boolean;
  readonly tone?: StreamingTextTone;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<StreamingTextState>(createStreamingTextState(""));
  const rafRef = useRef<number | undefined>(undefined);
  const latestPropsRef = useRef({ live, text, tone });
  latestPropsRef.current = { live, text, tone };

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    stateRef.current = updateStreamingTextTarget(stateRef.current, text, live);
    if (live) {
      container.textContent = stateRef.current.displayed;
      scheduleTick();
      return;
    }
    cancelTick();
    container.textContent = stateRef.current.displayed;
  }, [text, live]);

  useEffect(() => () => cancelTick(), []);

  function cancelTick(): void {
    if (rafRef.current !== undefined) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
  }

  function scheduleTick(): void {
    if (rafRef.current === undefined && stateRef.current.queue.length > 0) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }

  function tick(): void {
    rafRef.current = undefined;
    const container = containerRef.current;
    if (container === null) return;

    stateRef.current = consumeStreamingTextFrame(stateRef.current, latestPropsRef.current.tone);
    container.textContent = stateRef.current.displayed;

    if (stateRef.current.queue.length > 0) {
      rafRef.current = requestAnimationFrame(tick);
    } else if (!latestPropsRef.current.live && stateRef.current.displayed !== latestPropsRef.current.text) {
      stateRef.current = createStreamingTextState(latestPropsRef.current.text);
      container.textContent = latestPropsRef.current.text;
    }
  }

  return (
    <div
      ref={containerRef}
      className={`live-stream-box ${live ? "streaming" : "settled"} ${tone}`}
      aria-live={live ? "polite" : "off"}
      aria-atomic="false"
    />
  );
}
