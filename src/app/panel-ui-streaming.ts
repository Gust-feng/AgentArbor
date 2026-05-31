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

  const displayed = sharedPrefix(state.displayed, target);
  return {
    target,
    displayed,
    queue: Array.from(target.slice(displayed.length)),
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
