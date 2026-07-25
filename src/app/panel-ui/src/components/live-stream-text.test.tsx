import React from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LiveStreamBox } from "./live-stream-text";

test("live stream mounts with visible text instead of an empty first render", () => {
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const target = "abcdefghijklmnopqrst";

  render(
    <LiveStreamBox
      text={target}
      live
      animateOnMount
      renderStreamingText={(text) => <span data-testid="initial-stream-text">{text}</span>}
    />,
  );

  const displayed = screen.getByTestId("initial-stream-text").textContent ?? "";
  expect(displayed.length).toBeGreaterThan(0);
  expect(displayed.length).toBeLessThan(target.length);
});

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
