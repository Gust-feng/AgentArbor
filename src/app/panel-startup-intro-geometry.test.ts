import assert from "node:assert/strict";
import test from "node:test";
import {
  createStartupIntroDefaultWindowSize,
  createStartupIntroWindowSize,
  estimateStartupIntroTextBox,
} from "./panel-startup-intro-geometry.js";

test("startup intro default rectangle is a compact text-driven software window", () => {
  assert.deepEqual(createStartupIntroDefaultWindowSize(), {
    width: 556,
    height: 136,
  });
});

test("startup intro rectangle keeps balanced padding around the measured title", () => {
  const textBox = estimateStartupIntroTextBox("今天想处理什么？");
  const windowSize = createStartupIntroWindowSize(1440, 960, textBox);
  const horizontalPadding = (windowSize.width - textBox.width) / 2;
  const verticalPadding = (windowSize.height - textBox.height) / 2;

  assert.equal(windowSize.width / windowSize.height > 3.8, true);
  assert.equal(windowSize.width / windowSize.height < 4.2, true);
  assert.equal(horizontalPadding >= 80, true);
  assert.equal(horizontalPadding <= 96, true);
  assert.equal(verticalPadding >= 40, true);
  assert.equal(verticalPadding <= 50, true);
  assert.equal(horizontalPadding / verticalPadding < 2.4, true);
});

test("startup intro rectangle adapts down without becoming square on compact viewports", () => {
  const textBox = estimateStartupIntroTextBox("今天想处理什么？");
  const windowSize = createStartupIntroWindowSize(760, 620, textBox);

  assert.equal(windowSize.width <= 680, true);
  assert.equal(windowSize.height <= 154, true);
  assert.equal(windowSize.width / windowSize.height > 3.4, true);
});
