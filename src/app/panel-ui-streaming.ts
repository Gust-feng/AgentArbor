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

export type FrozenMarkdownStreamChunk = {
  readonly key: string;
  readonly text: string;
};

export type FrozenMarkdownStreamState = {
  readonly source: string;
  readonly committedText: string;
  readonly chunks: readonly FrozenMarkdownStreamChunk[];
  readonly nextChunkId: number;
};

export type MarkdownStreamViewport = {
  readonly committedBlocks: readonly FrozenMarkdownStreamChunk[];
  readonly liveTail: string;
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

export function createFrozenMarkdownStreamState(text = ""): FrozenMarkdownStreamState {
  return {
    source: text,
    committedText: text,
    chunks: text.length === 0 ? [] : [{ key: "frozen-0", text }],
    nextChunkId: text.length === 0 ? 0 : 1,
  };
}

export function updateFrozenMarkdownStreamState(
  state: FrozenMarkdownStreamState,
  source: string,
  live: boolean
): FrozenMarkdownStreamState {
  if (source.length === 0) {
    return createFrozenMarkdownStreamState("");
  }

  if (!live) {
    return createFrozenMarkdownStreamState(source);
  }

  if (!source.startsWith(state.committedText)) {
    const boundary = stableMarkdownCommitLength(source);
    const committedText = source.slice(0, boundary);
    const chunks = committedText.length === 0 ? [] : splitFrozenMarkdownChunks(committedText, 0);
    return {
      source,
      committedText,
      chunks,
      nextChunkId: chunks.length,
    };
  }

  const boundary = stableMarkdownCommitLength(source);
  if (boundary <= state.committedText.length) {
    return { ...state, source };
  }

  const nextText = source.slice(state.committedText.length, boundary);
  const nextChunks = splitFrozenMarkdownChunks(nextText, state.nextChunkId);
  return {
    source,
    committedText: source.slice(0, boundary),
    chunks: [...state.chunks, ...nextChunks],
    nextChunkId: state.nextChunkId + nextChunks.length,
  };
}

export function frozenMarkdownStreamTail(state: FrozenMarkdownStreamState): string {
  return state.source.slice(state.committedText.length);
}

export function markdownStreamViewport(state: FrozenMarkdownStreamState): MarkdownStreamViewport {
  return {
    committedBlocks: state.chunks,
    liveTail: frozenMarkdownStreamTail(state),
  };
}

export function stableMarkdownCommitLength(text: string): number {
  let inFence = false;
  let latestBoundary = 0;
  let offset = 0;
  const lines = text.match(/[^\n]*(?:\n|$)/g) ?? [];

  for (const line of lines) {
    if (line.length === 0) continue;
    const lineStart = offset;
    offset += line.length;
    const content = line.endsWith("\n") ? line.slice(0, -1) : line;
    const completeLine = line.endsWith("\n");
    const trimmed = content.trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      if (!inFence && completeLine) {
        latestBoundary = offset;
      }
      continue;
    }

    if (inFence) {
      continue;
    }

    if (trimmed.length === 0 && completeLine) {
      latestBoundary = offset;
    }
  }

  return latestBoundary;
}

function splitFrozenMarkdownChunks(
  text: string,
  startIndex: number
): readonly FrozenMarkdownStreamChunk[] {
  const chunks = text
    .split(/((?:\r?\n){2,})/g)
    .reduce<string[]>((result, part) => {
      if (part.length === 0) return result;
      const lastIndex = result.length - 1;
      if (/^(?:\r?\n){2,}$/.test(part) && lastIndex >= 0) {
        result[lastIndex] = `${result[lastIndex]}${part}`;
        return result;
      }
      result.push(part);
      return result;
    }, []);
  return chunks.map((chunk, index) => ({
    key: `frozen-${startIndex + index}`,
    text: chunk,
  }));
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
