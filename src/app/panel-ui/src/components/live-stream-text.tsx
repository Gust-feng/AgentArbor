import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  consumeStreamingTextFrame,
  createInitialStreamingTextState,
  streamingTextHasPendingDisplay,
  updateStreamingTextTarget,
  type StreamingTextState,
  type StreamingTextTone,
} from "../streaming-text";

/**
 * 流式输出调度器
 * 将不规律的后端推送转换为固定节奏的前端显示
 */
export function LiveStreamBox({
  text,
  live,
  animateOnMount = false,
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
  const reduceMotionRef = useRef(prefersReducedMotion());
  const initialRef = useRef<StreamingTextState | undefined>(undefined);
  if (initialRef.current === undefined) {
    initialRef.current = createInitialStreamingTextState(
      text,
      live,
      animateOnMount && !reduceMotionRef.current,
      animationNow(),
    );
  }
  const stateRef = useRef(initialRef.current);
  const frameRef = useRef<number | undefined>(undefined);
  const latestRef = useRef({ live, text });
  const [displayed, setDisplayed] = useState(initialRef.current.displayed);
  latestRef.current = { live, text };

  useLayoutEffect(() => {
    const now = animationNow();
    const smooth = live && !reduceMotionRef.current;
    stateRef.current = updateStreamingTextTarget(stateRef.current, text, smooth, now);
    stateRef.current = smooth
      ? consumeStreamingTextFrame(stateRef.current, now)
      : stateRef.current;
    commitDisplayed(stateRef.current.displayed);
    if (smooth && streamingTextHasPendingDisplay(stateRef.current)) {
      scheduleFrame();
    } else {
      cancelFrame();
    }
  }, [text, live]);

  useEffect(() => () => cancelFrame(), []);

  function commitDisplayed(value: string): void {
    setDisplayed((current) => current === value ? current : value);
  }

  function cancelFrame(): void {
    if (frameRef.current === undefined) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = undefined;
  }

  function scheduleFrame(): void {
    if (frameRef.current !== undefined) return;
    frameRef.current = requestAnimationFrame(tick);
  }

  function tick(now: number): void {
    frameRef.current = undefined;
    const latest = latestRef.current;
    const smooth = latest.live && !reduceMotionRef.current;
    stateRef.current = updateStreamingTextTarget(stateRef.current, latest.text, smooth, now);
    stateRef.current = smooth
      ? consumeStreamingTextFrame(stateRef.current, now)
      : stateRef.current;
    commitDisplayed(stateRef.current.displayed);
    if (smooth && streamingTextHasPendingDisplay(stateRef.current)) {
      scheduleFrame();
    }
  }

  const rendered = live && renderStreamingText !== undefined
    ? renderStreamingText(displayed)
    : renderText === undefined ? displayed : renderText(displayed);

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

function animationNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
