import assert from "node:assert/strict";
import test from "node:test";
import {
  createStartupIntroDefaultWindowSize,
  createStartupIntroWindowSize,
  estimateStartupIntroTextBox,
} from "./panel-startup-intro-geometry.js";

test("startup intro default rectangle is a software-like launch window", () => {
  assert.deepEqual(createStartupIntroDefaultWindowSize(), {
    width: 718,
    height: 404,
  });
});

test("startup intro rectangle leaves enough surface around the measured title", () => {
  const textBox = estimateStartupIntroTextBox("今天想处理什么？");
  const windowSize = createStartupIntroWindowSize(1440, 960, textBox);
  const horizontalPadding = (windowSize.width - textBox.width) / 2;
  const verticalPadding = (windowSize.height - textBox.height) / 2;

  assert.equal(windowSize.width / windowSize.height > 1.65, true);
  assert.equal(windowSize.width / windowSize.height < 1.9, true);
  assert.equal(horizontalPadding >= 170, true);
  assert.equal(horizontalPadding <= 190, true);
  assert.equal(verticalPadding >= 170, true);
  assert.equal(verticalPadding <= 190, true);
  assert.equal(Math.abs(horizontalPadding - verticalPadding) <= 8, true);
});

test("startup intro rectangle adapts down without becoming square on compact viewports", () => {
  const textBox = estimateStartupIntroTextBox("今天想处理什么？");
  const windowSize = createStartupIntroWindowSize(760, 620, textBox);

  assert.equal(windowSize.width <= 680, true);
  assert.equal(windowSize.height <= 360, true);
  assert.equal(windowSize.width / windowSize.height > 1.7, true);
  assert.equal(windowSize.width / windowSize.height < 2.05, true);
});
