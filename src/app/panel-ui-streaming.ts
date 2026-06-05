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
  live: boolean,
  animateOnMount: boolean,
  tone: StreamingTextTone
): StreamingTextState {
  if (text.length === 0 || (!live && !animateOnMount)) {
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
