import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  consumeStreamingTextFrame,
  createFrozenMarkdownStreamState,
  createInitialStreamingTextState,
  createStreamingTextState,
  markdownStreamViewport,
  settleFrozenMarkdownStreamState,
  updateFrozenMarkdownStreamState,
  updateStreamingTextTarget,
  type FrozenMarkdownStreamState,
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
}: {
  readonly text: string;
  readonly live: boolean;
  readonly animateOnMount?: boolean;
  readonly tone?: StreamingTextTone;
  readonly renderText?: (text: string) => React.ReactNode;
}): React.ReactElement {
  const initialRef = useRef<{
    readonly stream: StreamingTextState;
    readonly markdown: FrozenMarkdownStreamState;
    readonly streamingRender: boolean;
  } | undefined>(undefined);
  if (initialRef.current === undefined) {
    const stream = createInitialStreamingTextState(text, live, animateOnMount, tone);
    const streaming = live || stream.queue.length > 0;
    initialRef.current = {
      stream,
      markdown: streaming
        ? updateFrozenMarkdownStreamState(createFrozenMarkdownStreamState(""), stream.displayed, true)
        : settleFrozenMarkdownStreamState(createFrozenMarkdownStreamState(""), stream.displayed),
      streamingRender: streaming,
    };
  }
  const stateRef = useRef<StreamingTextState>(initialRef.current.stream);
  const markdownStateRef = useRef<FrozenMarkdownStreamState>(initialRef.current.markdown);
  const rafRef = useRef<number | undefined>(undefined);
  const wasLiveRef = useRef(live);
  const latestPropsRef = useRef({ live, text, tone });
  const [displayed, setDisplayed] = useState(initialRef.current.stream.displayed);
  const [markdownState, setMarkdownState] = useState<FrozenMarkdownStreamState>(() => initialRef.current?.markdown ?? createFrozenMarkdownStreamState(""));
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
      wasLiveRef.current = live || hasQueuedText;
      commitDisplayedText(stateRef.current.displayed, live || hasQueuedText);
      if (hasQueuedText) {
        scheduleTick();
      } else {
        cancelTick();
      }
      return;
    }
    if (wasLiveRef.current || stateRef.current.queue.length > 0) {
      wasLiveRef.current = false;
      stateRef.current = updateStreamingTextTarget(stateRef.current, text, true);
      if (stateRef.current.queue.length > 0) {
        scheduleTick();
        return;
      }
      cancelTick();
      commitDisplayedText(stateRef.current.displayed, false);
      return;
    }
    stateRef.current = updateStreamingTextTarget(stateRef.current, text, false);
    if (stateRef.current.queue.length > 0) {
      scheduleTick();
      return;
    }
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
      commitDisplayedText(stateRef.current.displayed, false);
    }
  }

  function commitDisplayedText(value: string, isLive: boolean): void {
    setDisplayed(value);
    const nextMarkdownState = isLive
      ? updateFrozenMarkdownStreamState(markdownStateRef.current, value, true)
      : settleFrozenMarkdownStreamState(markdownStateRef.current, value);
    markdownStateRef.current = nextMarkdownState;
    setMarkdownState(nextMarkdownState);
    setStreamingRender(isLive);
  }

  const viewport = markdownStreamViewport(markdownState);

  return (
    <div
      className={`live-stream-box ${streamingRender ? "streaming" : "settled"} ${tone}`}
      aria-live={streamingRender ? "polite" : "off"}
      aria-atomic="false"
    >
      {renderText === undefined
        ? displayed
        : (
            <>
              {viewport.committedBlocks.map((chunk) => (
                <div className="live-stream-frozen-chunk" key={chunk.key}>
                  {renderText(chunk.text)}
                </div>
              ))}
              {streamingRender && viewport.liveTail.length > 0 && (
                <div className="live-stream-live-tail">
                  <span className="live-stream-live-tail-text">{viewport.liveTail}</span>
                </div>
              )}
              {viewport.committedBlocks.length === 0 && (!streamingRender || viewport.liveTail.length === 0) && renderText(displayed)}
              {streamingRender && viewport.committedBlocks.length === 0 && viewport.liveTail.length === 0 && (
                <span className="live-stream-live-tail-text" aria-hidden="true" />
              )}
            </>
          )}
    </div>
  );
}
