type JsonRecord = Record<string, unknown>;
type ResponsesOutputStatus = "in_progress" | "completed" | "incomplete";
type TerminalResponsesStatus = Extract<ResponsesOutputStatus, "completed" | "incomplete">;

type ObservedOutputItem = {
  readonly outputIndex: number;
  added?: JsonRecord;
  completed?: JsonRecord;
};

export type OpenAIResponsesOutputObservation = {
  readonly outputIndex: number;
  readonly added?: unknown;
  readonly completed?: unknown;
};

type SseFrame = {
  readonly content: string;
  readonly separator: string;
};

/**
 * Reconciles raw Responses SSE lifecycle events before the OpenAI SDK parses
 * them. This keeps the SDK as the single owner of output-item conversion while
 * allowing a compact terminal snapshot to reuse complete streamed items.
 */
export function withOpenAIResponsesStreamReconciliation(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (!requestWantsStream(init?.body) ||
        response.body === null) {
      return response;
    }
    return new Response(reconcileResponsesSse(response.body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

function reconcileResponsesSse(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const observedItems = new Map<number, ObservedOutputItem>();
  let buffer = "";
  let sourceDone = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const frame = takeSseFrame(buffer, sourceDone);
          if (frame !== undefined) {
            buffer = buffer.slice(frame.content.length + frame.separator.length);
            controller.enqueue(encoder.encode(reconcileSseFrame(frame, observedItems)));
            return;
          }
          if (sourceDone) {
            controller.close();
            return;
          }
          const next = await reader.read();
          sourceDone = next.done;
          buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
        }
      } catch (error) {
        try {
          await reader.cancel(error);
        } catch {
          // Preserve the protocol failure that ended the stream.
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

function takeSseFrame(buffer: string, sourceDone: boolean): SseFrame | undefined {
  const boundary = /\r\n\r\n|\n\n|\r\r/u.exec(buffer);
  if (boundary !== null && boundary.index !== undefined) {
    return {
      content: buffer.slice(0, boundary.index),
      separator: boundary[0],
    };
  }
  if (sourceDone && buffer.length > 0) {
    return { content: buffer, separator: "" };
  }
  return undefined;
}

function reconcileSseFrame(
  frame: SseFrame,
  observedItems: Map<number, ObservedOutputItem>,
): string {
  const data = sseData(frame.content);
  if (data === undefined || data === "[DONE]") {
    return frame.content + frame.separator;
  }

  let event: JsonRecord;
  try {
    event = asRecord(JSON.parse(data));
  } catch {
    return frame.content + frame.separator;
  }
  if (event.type === "response.created") {
    observedItems.clear();
  }
  recordObservedOutputItem(observedItems, event);
  if (!isTerminalEventType(event.type)) {
    return frame.content + frame.separator;
  }

  const terminalStatus = terminalResponseStatus(event);
  const response = asRecord(event.response);
  const reconciledEvent = {
    ...event,
    response: {
      ...response,
      output: reconcileOpenAIResponsesTerminalOutput({
        terminalOutput: response.output,
        observations: [...observedItems.values()],
        terminalStatus,
      }),
    },
  };
  return replaceSseData(frame.content, JSON.stringify(reconciledEvent)) + frame.separator;
}

function recordObservedOutputItem(target: Map<number, ObservedOutputItem>, event: JsonRecord): void {
  if (event.type !== "response.output_item.added" && event.type !== "response.output_item.done") {
    return;
  }
  const outputIndex = event.output_index;
  if (typeof outputIndex !== "number" || !Number.isInteger(outputIndex) || outputIndex < 0) {
    throw protocolError(`${String(event.type)} has an invalid output_index.`);
  }
  const item = outputItem(event.item, `${String(event.type)} at output_index ${outputIndex}`);
  const existing = target.get(outputIndex) ?? { outputIndex };
  assertConsistentObservedIdentity(existing, item);
  if (event.type === "response.output_item.done") {
    existing.completed = item;
  } else {
    existing.added = item;
  }
  target.set(outputIndex, existing);
}

function assertConsistentObservedIdentity(existing: ObservedOutputItem, next: JsonRecord): void {
  for (const previous of [existing.added, existing.completed]) {
    if (previous === undefined) continue;
    if (previous.type !== next.type) {
      throw protocolError(
        `output_index ${existing.outputIndex} changed type from ${String(previous.type)} to ${String(next.type)}.`,
      );
    }
    if (typeof previous.id === "string" && typeof next.id === "string" && previous.id !== next.id) {
      throw protocolError(`output_index ${existing.outputIndex} changed item id.`);
    }
  }
}

export function reconcileOpenAIResponsesTerminalOutput(input: {
  readonly terminalOutput: unknown;
  readonly observations: readonly OpenAIResponsesOutputObservation[];
  readonly terminalStatus: TerminalResponsesStatus;
}): readonly unknown[] {
  const observedItems = new Map<number, ObservedOutputItem>();
  for (const observation of input.observations) {
    if (!Number.isInteger(observation.outputIndex) || observation.outputIndex < 0) {
      throw protocolError("output item observation has an invalid outputIndex.");
    }
    if (observedItems.has(observation.outputIndex)) {
      throw protocolError(`output_index ${observation.outputIndex} was observed more than once.`);
    }
    const added = observation.added === undefined
      ? undefined
      : outputItem(observation.added, `output_index ${observation.outputIndex} added item`);
    const completed = observation.completed === undefined
      ? undefined
      : outputItem(observation.completed, `output_index ${observation.outputIndex} completed item`);
    const identity = completed ?? added;
    if (identity === undefined) {
      throw protocolError(`output_index ${observation.outputIndex} has no observed item.`);
    }
    const observed = { outputIndex: observation.outputIndex, added, completed };
    assertConsistentObservedIdentity(observed, identity);
    observedItems.set(observation.outputIndex, observed);
  }
  return reconcileTerminalOutput(
    responseOutputItems(input.terminalOutput),
    observedItems,
    input.terminalStatus,
  );
}

function reconcileTerminalOutput(
  terminalItems: readonly JsonRecord[],
  observedItems: ReadonlyMap<number, ObservedOutputItem>,
  terminalStatus: TerminalResponsesStatus,
): JsonRecord[] {
  const consumedTerminalItems = new Set<number>();
  const output: JsonRecord[] = [];
  const observedInStreamOrder = [...observedItems.values()]
    .sort((left, right) => left.outputIndex - right.outputIndex);

  for (const observed of observedInStreamOrder) {
    const identity = observed.completed ?? observed.added;
    const terminalIndex = identity === undefined
      ? undefined
      : findMatchingTerminalItem(terminalItems, consumedTerminalItems, identity, observed.outputIndex);
    const terminalItem = terminalIndex === undefined ? undefined : terminalItems[terminalIndex];
    if (terminalIndex !== undefined) {
      consumedTerminalItems.add(terminalIndex);
    }

    if (observed.completed !== undefined) {
      output.push(finalizeOutputItem(
        terminalItem === undefined
          ? observed.completed
          : mergeDefined(terminalItem, observed.completed),
        terminalStatus,
        `output_index ${observed.outputIndex}`,
      ));
    } else if (terminalItem !== undefined) {
      output.push(finalizeOutputItem(
        terminalItem,
        terminalStatus,
        `output_index ${observed.outputIndex}`,
      ));
    }
  }

  for (const [terminalIndex, terminalItem] of terminalItems.entries()) {
    if (consumedTerminalItems.has(terminalIndex)) continue;
    output.push(finalizeOutputItem(terminalItem, terminalStatus, `terminal output[${terminalIndex}]`));
  }
  return output;
}

function findMatchingTerminalItem(
  terminalItems: readonly JsonRecord[],
  consumed: ReadonlySet<number>,
  identity: JsonRecord,
  outputIndex: number,
): number | undefined {
  const identityId = stringField(identity, "id");
  if (identityId !== undefined) {
    const exactIdIndex = terminalItems.findIndex((item, index) =>
      !consumed.has(index) && stringField(item, "id") === identityId);
    if (exactIdIndex >= 0) {
      if (!compatibleOutputIdentity(identity, terminalItems[exactIdIndex])) {
        throw protocolError(`output_index ${outputIndex} matched item id ${identityId} with an incompatible type.`);
      }
      return exactIdIndex;
    }
  }

  const compatibleIndex = terminalItems.findIndex((item, index) =>
    !consumed.has(index) && compatibleOutputIdentity(identity, item));
  return compatibleIndex < 0 ? undefined : compatibleIndex;
}

function compatibleOutputIdentity(left: JsonRecord, right: JsonRecord): boolean {
  if (left.type !== right.type) return false;
  const leftId = stringField(left, "id");
  const rightId = stringField(right, "id");
  if (leftId !== undefined && rightId !== undefined && leftId !== rightId) return false;
  for (const key of ["call_id", "name"] as const) {
    const leftValue = stringField(left, key);
    const rightValue = stringField(right, key);
    if (leftValue !== undefined && rightValue !== undefined && leftValue !== rightValue) return false;
  }
  return true;
}

function finalizeOutputItem(
  value: JsonRecord,
  terminalStatus: TerminalResponsesStatus,
  location: string,
): JsonRecord {
  const item = { ...value };
  if (item.type === "message") {
    if (item.status === undefined) {
      item.status = terminalStatus;
    } else if (!isResponsesOutputStatus(item.status)) {
      throw protocolError(`${location} has invalid message status ${JSON.stringify(item.status)}.`);
    }
  }
  return item;
}

function terminalResponseStatus(event: JsonRecord): TerminalResponsesStatus {
  const response = asRecord(event.response);
  const status = response.status;
  if (status === "failed" || event.type === "response.failed" || event.type === "response.error") {
    throw providerFailure(event, response);
  }
  if (status === "completed" || status === "incomplete") {
    return status;
  }
  if (event.type === "response.completed") return "completed";
  if (event.type === "response.incomplete") return "incomplete";
  if (status !== undefined) {
    throw protocolError(`terminal response has unsupported status ${JSON.stringify(status)}.`);
  }
  throw protocolError("terminal response does not identify a completed or incomplete outcome.");
}

function providerFailure(event: JsonRecord, response: JsonRecord): Error {
  const responseError = asRecord(response.error);
  const eventError = asRecord(event.error);
  const error = Object.keys(responseError).length > 0 ? responseError : eventError;
  const code = typeof error.code === "string" ? ` (${error.code})` : "";
  const message = typeof error.message === "string" ? error.message : "The provider returned a failed response.";
  return new Error(`OpenAI Responses stream failed${code}: ${message}`);
}

function responseOutputItems(value: unknown): JsonRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw protocolError("terminal response output is not an array.");
  }
  return value.map((item, index) => outputItem(item, `terminal output[${index}]`));
}

function outputItem(value: unknown, location: string): JsonRecord {
  const item = asRecord(value);
  if (typeof item.type !== "string" || item.type.length === 0) {
    throw protocolError(`${location} has no item type.`);
  }
  return item;
}

function isTerminalEventType(value: unknown): boolean {
  return value === "response.completed" ||
    value === "response.incomplete" ||
    value === "response.failed" ||
    value === "response.error";
}

function requestWantsStream(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string") return false;
  try {
    return asRecord(JSON.parse(body)).stream === true;
  } catch {
    return false;
  }
}

function sseData(frame: string): string | undefined {
  const lines = frame.split(/\r\n|\n|\r/u);
  const data = lines
    .filter((line) => line === "data" || line.startsWith("data:"))
    .map((line) => line === "data" ? "" : line.slice(5).replace(/^ /u, ""));
  return data.length === 0 ? undefined : data.join("\n");
}

function replaceSseData(frame: string, data: string): string {
  const lines = frame.split(/\r\n|\n|\r/u);
  const replaced: string[] = [];
  let wroteData = false;
  for (const line of lines) {
    if (line === "data" || line.startsWith("data:")) {
      if (!wroteData) {
        replaced.push(`data: ${data}`);
        wroteData = true;
      }
      continue;
    }
    replaced.push(line);
  }
  if (!wroteData) replaced.push(`data: ${data}`);
  return replaced.join("\n");
}

function mergeDefined(base: JsonRecord, override: JsonRecord): JsonRecord {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function isResponsesOutputStatus(value: unknown): value is ResponsesOutputStatus {
  return value === "in_progress" || value === "completed" || value === "incomplete";
}

function stringField(value: JsonRecord, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function protocolError(message: string): Error {
  return new Error(`Invalid OpenAI Responses stream: ${message}`);
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}
