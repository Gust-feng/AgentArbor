import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useStreamingText } from "../src/use-streaming-text";

let frames: Array<() => void>;

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(() => callback(0));
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => vi.unstubAllGlobals());

async function flushFrames(limit = 200): Promise<void> {
  let guard = 0;
  while (frames.length > 0 && guard < limit) {
    await act(async () => { frames.shift()!(); });
    guard += 1;
  }
}

test("mounts with the full text without replaying history", () => {
  const { result } = renderHook(() => useStreamingText("恢复中的完整输出", true));
  expect(result.current).toBe("恢复中的完整输出");
  expect(frames.length).toBe(0);
});

test("appends new live text progressively until it settles", async () => {
  const { result, rerender } = renderHook(
    ({ text }: { readonly text: string }) => useStreamingText(text, true),
    { initialProps: { text: "正在输出" } },
  );

  rerender({ text: "正在输出更多内容" });
  expect(result.current).toBe("正在输出");

  await act(async () => { frames.shift()!(); });
  const partial = result.current;
  expect(partial.length).toBeGreaterThan("正在输出".length);
  expect(partial.length).toBeLessThan("正在输出更多内容".length);
  expect("正在输出更多内容".startsWith(partial)).toBe(true);

  await flushFrames();
  expect(result.current).toBe("正在输出更多内容");
  expect(frames.length).toBe(0);
});

test("settles immediately when live ends mid-animation", async () => {
  const { result, rerender } = renderHook(
    ({ text, live }: { readonly text: string; readonly live: boolean }) => useStreamingText(text, live),
    { initialProps: { text: "正在输出", live: true } },
  );

  rerender({ text: "正在输出更多内容", live: false });
  expect(result.current).toBe("正在输出更多内容");
  expect(frames.length).toBe(0);
});

test("skips animation for targets longer than maxAnimatedLength", () => {
  const { result, rerender } = renderHook(
    ({ text }: { readonly text: string }) => useStreamingText(text, true, { maxAnimatedLength: 10 }),
    { initialProps: { text: "短" } },
  );

  rerender({ text: "这是一个超过最大动画长度的长文本目标" });
  expect(result.current).toBe("这是一个超过最大动画长度的长文本目标");
  expect(frames.length).toBe(0);
});

test("settles immediately when the target replaces the stream with a non-prefix", () => {
  const { result, rerender } = renderHook(
    ({ text }: { readonly text: string }) => useStreamingText(text, true),
    { initialProps: { text: "旧内容" } },
  );

  rerender({ text: "全新终态内容" });
  expect(result.current).toBe("全新终态内容");
  expect(frames.length).toBe(0);
});