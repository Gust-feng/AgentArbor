import React from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LiveStreamBox } from "./live-stream-text";

test("live stream smooths a provider chunk across frames and settles immediately", () => {
  let now = 0;
  let nextFrame: FrameRequestCallback | undefined;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    nextFrame = callback;
    return 1;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn(() => {
    nextFrame = undefined;
  }));

  const renderStreamingText = (text: string) => <span data-testid="stream-text">{text}</span>;
  const view = render(
    <LiveStreamBox text="" live renderStreamingText={renderStreamingText} />,
  );
  const target = "abcdefghijklmnopqrst";
  view.rerender(
    <LiveStreamBox text={target} live renderStreamingText={renderStreamingText} />,
  );

  const firstFrameText = screen.getByTestId("stream-text").textContent ?? "";
  expect(firstFrameText.length).toBeGreaterThan(0);
  expect(firstFrameText.length).toBeLessThan(target.length);

  act(() => {
    now = 32;
    const frame = nextFrame;
    nextFrame = undefined;
    frame?.(now);
  });
  expect((screen.getByTestId("stream-text").textContent ?? "").length).toBeGreaterThan(firstFrameText.length);

  view.rerender(
    <LiveStreamBox text={target} live={false} renderText={renderStreamingText} />,
  );
  expect(screen.getByTestId("stream-text").textContent).toBe(target);
});
