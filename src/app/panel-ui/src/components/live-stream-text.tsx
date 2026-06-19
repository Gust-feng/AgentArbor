import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  consumeStreamingTextFrame,
  createInitialStreamingTextState,
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
  const initialRef = useRef<{
    readonly stream: StreamingTextState;
    readonly streamingRender: boolean;
  } | undefined>(undefined);
  if (initialRef.current === undefined) {
    const stream = createInitialStreamingTextState(text, animateOnMount, tone);
    const streaming = live || stream.queue.length > 0;
    initialRef.current = {
      stream,
      streamingRender: streaming,
    };
  }
  const stateRef = useRef<StreamingTextState>(initialRef.current.stream);
  const rafRef = useRef<number | undefined>(undefined);
  const latestPropsRef = useRef({ live, text, tone });
  const [displayed, setDisplayed] = useState(initialRef.current.stream.displayed);
  const [streamingRender, setStreamingRender] = useState(initialRef.current.streamingRender);
  latestPropsRef.current = { live, text, tone };

  useLayoutEffect(() => {
    const shouldAnimateSettledText =
      !live &&
      animateOnMount &&
      text.length > 0 &&
      stateRef.current.displayed.length === 0;

    if (live || shouldAnimateSettledText) {
      stateRef.current = updateStreamingTextTarget(stateRef.current, text, true);
      stateRef.current = consumeStreamingTextFrame(stateRef.current, tone);
      const hasQueuedText = stateRef.current.queue.length > 0;
      commitDisplayedText(stateRef.current.displayed, live || hasQueuedText);
      if (hasQueuedText) {
        scheduleTick();
      } else {
        cancelTick();
      }
      return;
    }

    // Once the backend has settled this segment, the UI should snap to the
    // final text instead of replaying buffered characters after the user
    // returns to the view.
    stateRef.current = updateStreamingTextTarget(stateRef.current, text, false);
    cancelTick();
    commitDisplayedText(stateRef.current.displayed, false);
  }, [text, live, animateOnMount, tone]);

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

    stateRef.current = consumeStreamingTextFrame(stateRef.current, latestPropsRef.current.tone);
    commitDisplayedText(stateRef.current.displayed, true);

    if (stateRef.current.queue.length > 0) {
      rafRef.current = requestAnimationFrame(tick);
    } else if (!latestPropsRef.current.live) {
      stateRef.current = updateStreamingTextTarget(stateRef.current, latestPropsRef.current.text, false);
      commitDisplayedText(stateRef.current.displayed, false);
    }
  }

  function commitDisplayedText(value: string, isLive: boolean): void {
    setDisplayed(value);
    setStreamingRender(isLive);
  }

  const rendered = streamingRender && renderStreamingText !== undefined
    ? renderStreamingText(displayed)
    : renderText === undefined ? displayed : renderText(displayed);

  return (
    <div
      className={`live-stream-box ${streamingRender ? "streaming" : "settled"} ${tone}`}
      aria-live={streamingRender ? "polite" : "off"}
      aria-atomic="false"
    >
      {rendered}
    </div>
  );
}
