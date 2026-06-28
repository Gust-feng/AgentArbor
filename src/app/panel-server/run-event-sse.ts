import type { IncomingMessage, ServerResponse } from "node:http";
import {
  parseStreamCursor,
  writeSseEvent,
} from "./http-utils.js";

export type RunEventSseEvent = {
  readonly sequence: number;
  readonly type: string;
  readonly [key: string]: unknown;
};

export type RunEventSsePollResult<TEvent extends RunEventSseEvent> = {
  readonly events: readonly TEvent[];
  readonly terminal: boolean;
};

export type RunEventSseOptions<TEvent extends RunEventSseEvent> = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly comment: string;
  readonly pollIntervalMs?: number;
  readonly poll: (lastSequence: number) => RunEventSsePollResult<TEvent> | Promise<RunEventSsePollResult<TEvent>>;
  readonly onPollError?: (error: unknown) => void;
};

export function serveRunEventSse<TEvent extends RunEventSseEvent>(
  options: RunEventSseOptions<TEvent>,
): void {
  let lastSequence = parseStreamCursor(
    options.url.searchParams.get("cursor"),
    options.request.headers["last-event-id"],
  );
  let closed = false;
  let flushing = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  options.response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  options.response.write(`: ${options.comment}\n\n`);

  const cleanup = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    if (interval !== undefined) {
      clearInterval(interval);
    }
    options.response.end();
  };

  const flush = (): void => {
    if (closed || flushing) {
      return;
    }
    flushing = true;
    Promise.resolve()
      .then(() => options.poll(lastSequence))
      .then((result) => {
        if (closed) {
          return;
        }
        for (const event of result.events) {
          if (event.sequence <= lastSequence) {
            continue;
          }
          writeSseEvent(options.response, event);
          lastSequence = event.sequence;
        }
        if (result.terminal) {
          cleanup();
        }
      })
      .catch((error: unknown) => {
        options.onPollError?.(error);
      })
      .finally(() => {
        flushing = false;
      });
  };

  interval = setInterval(flush, options.pollIntervalMs ?? 100);
  options.request.on("close", cleanup);
  flush();
}
