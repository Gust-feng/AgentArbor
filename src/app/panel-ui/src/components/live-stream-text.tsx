import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  consumeStreamingTextFrame,
  createFrozenMarkdownStreamState,
  createStreamingTextState,
  markdownStreamViewport,
  updateFrozenMarkdownStreamState,
  type FrozenMarkdownStreamState,
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
  renderText,
}: {
  readonly text: string;
  readonly live: boolean;
  readonly tone?: StreamingTextTone;
  readonly renderText?: (text: string) => React.ReactNode;
}): React.ReactElement {
  const stateRef = useRef<StreamingTextState>(createStreamingTextState(""));
  const markdownStateRef = useRef<FrozenMarkdownStreamState>(createFrozenMarkdownStreamState(""));
  const rafRef = useRef<number | undefined>(undefined);
  const latestPropsRef = useRef({ live, text, tone });
  const [displayed, setDisplayed] = useState("");
  const [markdownState, setMarkdownState] = useState<FrozenMarkdownStreamState>(() => createFrozenMarkdownStreamState(""));
  latestPropsRef.current = { live, text, tone };

  useLayoutEffect(() => {
    stateRef.current = updateStreamingTextTarget(stateRef.current, text, live);
    if (live) {
      commitDisplayedText(stateRef.current.displayed, true);
      scheduleTick();
      return;
    }
    cancelTick();
    commitDisplayedText(stateRef.current.displayed, false);
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

    stateRef.current = consumeStreamingTextFrame(stateRef.current, latestPropsRef.current.tone);
    commitDisplayedText(stateRef.current.displayed, true);

    if (stateRef.current.queue.length > 0) {
      rafRef.current = requestAnimationFrame(tick);
    } else if (!latestPropsRef.current.live && stateRef.current.displayed !== latestPropsRef.current.text) {
      stateRef.current = createStreamingTextState(latestPropsRef.current.text);
      commitDisplayedText(latestPropsRef.current.text, false);
    }
  }

  function commitDisplayedText(value: string, isLive: boolean): void {
    setDisplayed(value);
    const nextMarkdownState = updateFrozenMarkdownStreamState(markdownStateRef.current, value, isLive);
    markdownStateRef.current = nextMarkdownState;
    setMarkdownState(nextMarkdownState);
  }

  const viewport = markdownStreamViewport(markdownState);

  return (
    <div
      className={`live-stream-box ${live ? "streaming" : "settled"} ${tone}`}
      aria-live={live ? "polite" : "off"}
      aria-atomic="false"
    >
      {renderText === undefined ? displayed : (
        <>
          {viewport.committedBlocks.map((chunk) => (
            <div className="live-stream-frozen-chunk" key={chunk.key}>
              {renderText(chunk.text)}
            </div>
          ))}
          {viewport.liveTail.length > 0 && (
            <span className="live-stream-live-tail">{viewport.liveTail}</span>
          )}
        </>
      )}
    </div>
  );
}
