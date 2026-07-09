/**
 * Panel stream text state keeps backend target text separate from painted text.
 * New deltas are compared against the previous target, not the lagging display,
 * so fast model chunks do not enqueue duplicate characters.
 */
export type StreamingTextTone = "formal" | "process" | "thinking";

export type StreamingTextState = {
  readonly target: string;
  readonly displayed: string;
  readonly queue: readonly string[];
};

export function createStreamingTextState(text = ""): StreamingTextState {
  return {
    target: text,
    displayed: text,
    queue: [],
  };
}

export function createInitialStreamingTextState(
  text: string,
  animateOnMount: boolean,
  tone: StreamingTextTone
): StreamingTextState {
  if (text.length === 0 || !animateOnMount) {
    return createStreamingTextState(text);
  }
  return consumeStreamingTextFrame(
    updateStreamingTextTarget(createStreamingTextState(""), text, true),
    tone
  );
}

export function updateStreamingTextTarget(
  state: StreamingTextState,
  target: string,
  live: boolean
): StreamingTextState {
  if (!live) {
    return createStreamingTextState(target);
  }

  if (target === state.target) {
    return state;
  }

  if (target.startsWith(state.target)) {
    return {
      ...state,
      target,
      queue: [...state.queue, ...Array.from(target.slice(state.target.length))],
    };
  }

  if (target.startsWith(state.displayed)) {
    return {
      target,
      displayed: state.displayed,
      queue: Array.from(target.slice(state.displayed.length)),
    };
  }

  if (state.displayed.startsWith(target)) {
    return {
      target: state.displayed,
      displayed: state.displayed,
      queue: [],
    };
  }

  const stablePrefix = sharedPrefix(state.target, target);
  const appendOnlySuffix = target.slice(stablePrefix.length);
  return {
    target: `${state.displayed}${appendOnlySuffix}`,
    displayed: state.displayed,
    queue: Array.from(appendOnlySuffix),
  };
}

export function consumeStreamingTextFrame(
  state: StreamingTextState,
  tone: StreamingTextTone
): StreamingTextState {
  if (state.queue.length === 0) {
    return state;
  }
  const count = streamingCharsPerFrame(tone, state.queue.length);
  const nextChars = state.queue.slice(0, count);
  return {
    ...state,
    displayed: `${state.displayed}${nextChars.join("")}`,
    queue: state.queue.slice(count),
  };
}

export function streamingCharsPerFrame(tone: StreamingTextTone, queueLength: number): number {
  const baseline = tone === "thinking" ? 3 : tone === "process" ? 2 : 2;
  const catchup = queueLength > 720 ? 10 : queueLength > 360 ? 7 : queueLength > 160 ? 5 : baseline;
  return Math.max(1, catchup);
}

function sharedPrefix(left: string, right: string): string {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  const maxLength = Math.min(leftChars.length, rightChars.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (leftChars[index] !== rightChars[index]) {
      return leftChars.slice(0, index).join("");
    }
  }
  return leftChars.slice(0, maxLength).join("");
}

/**
 * 让流式输出过程中不完整的 Markdown 也能被安全渲染。
 * 仅闭合未配对的代码块围栏和常见 inline 标记，不修改已完整的内容。
 */
export function stabilizeStreamingMarkdown(value: string): string {
  let text = value.replace(/\r\n/g, "\n");

  // 未闭合的代码块围栏会在 ReactMarkdown 中吞掉后续内容，优先处理。
  const fenceCount = (text.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 === 1) {
    text += "\n```";
  }

  // 将文本按代码块切分，只在非代码块部分闭合 inline 标记。
  const parts = text.split(/^```/m);
  for (let index = 0; index < parts.length; index += 2) {
    parts[index] = stabilizeInlineMarkdown(parts[index]);
  }
  return parts.join("```");
}

function stabilizeInlineMarkdown(value: string): string {
  let text = value;

  // 先闭合未配对的内联代码围栏，再把已闭合的代码段暂时抽离，
  // 避免代码内容内部的 * _ 等被误当成 markdown 标记。
  text = closeInlineMarker(text, "`");
  const codeSpans: string[] = [];
  text = text.replace(/`[^`]*`/g, (match) => {
    codeSpans.push(match);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  text = closeInlineMarker(text, "~~");
  text = closeInlineMarker(text, "**");
  text = closeInlineMarker(text, "__");
  text = closeSingleCharMarker(text, "*", "**");
  text = closeSingleCharMarker(text, "_", "__");

  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => codeSpans[Number(index)]);
}

function closeInlineMarker(text: string, marker: string): string {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const count = (text.match(new RegExp(escaped, "g")) ?? []).length;
  return count % 2 === 1 ? text + marker : text;
}

function closeSingleCharMarker(text: string, marker: string, pairMarker: string): string {
  const pairRegex = new RegExp(escapeRegex(pairMarker) + ".*?" + escapeRegex(pairMarker), "gs");
  const withoutPairs = text.replace(pairRegex, "");
  const count = (withoutPairs.match(new RegExp(escapeRegex(marker), "g")) ?? []).length;
  return count % 2 === 1 ? text + marker : text;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
