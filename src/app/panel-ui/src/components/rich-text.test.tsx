import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { RichText, StreamingRichText } from "./rich-text";

afterEach(() => vi.unstubAllGlobals());

test("markdown code blocks expose their language and copy the code", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  render(<RichText text={'```ts\nconst answer = 42;\n```'} />);

  expect(screen.getByText("ts")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "复制代码" }));

  expect(writeText).toHaveBeenCalledWith("const answer = 42;");
  expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy();
});

test("streaming rich text preserves completed Markdown blocks while its active tail grows", () => {
  // 同步帧：动画在渲染内直接收敛，用于断言最终状态。
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  const { rerender } = render(<StreamingRichText text={"# 标题\n\n正在输出"} />);
  const heading = screen.getByRole("heading", { name: "标题" });

  rerender(<StreamingRichText text={"# 标题\n\n正在输出更多内容"} />);

  expect(screen.getByRole("heading", { name: "标题" })).toBe(heading);
  expect(screen.getByText("正在输出更多内容")).toBeTruthy();
});

test("streaming rich text settles without remounting when live ends", () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  const { rerender } = render(<StreamingRichText text={"正在输出"} live />);

  rerender(<StreamingRichText text={"正在输出完整内容"} live={false} />);

  expect(screen.getByText("正在输出完整内容")).toBeTruthy();
  expect(document.querySelector(".rich-text-streaming")).toBeNull();
});

test("streaming rich text animates the active tail progressively before settling", async () => {
  const frames: Array<() => void> = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(() => callback(0));
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  const { rerender } = render(<StreamingRichText text={"正在输出"} />);
  expect(screen.getByText("正在输出")).toBeTruthy();

  rerender(<StreamingRichText text={"正在输出更多内容"} />);
  // 追加目标后首帧尚未执行：只显示旧文本。
  expect(screen.queryByText("正在输出更多内容")).toBeNull();

  await act(async () => { frames.shift()!(); });
  const partial = document.querySelector(".rich-text-streaming")?.textContent ?? "";
  expect(partial.length).toBeGreaterThan(0);
  expect(partial.length).toBeLessThan("正在输出更多内容".length);
  expect("正在输出更多内容".startsWith(partial)).toBe(true);

  let guard = 0;
  while (frames.length > 0 && guard < 200) {
    await act(async () => { frames.shift()!(); });
    guard += 1;
  }
  expect(screen.getByText("正在输出更多内容")).toBeTruthy();
  expect(frames.length).toBe(0);
});