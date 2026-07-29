import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createPanelHtml } from "../panel-server/panel-assets.js";
import { assertFirstScreenHasNoInternalTerms } from "./panel-structure-test-utils.js";

test("panel HTML serves the React workbench shell without first-screen internals", () => {
  const staticHtml = createPanelHtml();
  const firstScreenHtml = staticHtml.slice(
    staticHtml.indexOf("<!-- ordinary-screen-start -->"),
    staticHtml.indexOf("<!-- ordinary-screen-end -->")
  );

  assert.match(staticHtml, /<script type="module"[^>]+src="\/assets\/[^"]+\.js"/);
  assert.match(staticHtml, /<link rel="stylesheet"[^>]+href="\/assets\/[^"]+\.css"/);
  assert.equal(staticHtml.includes('<div id="root">'), true);
  assert.equal(firstScreenHtml.includes("新任务"), false);
  assert.equal(firstScreenHtml.includes("redesign-bootstrap"), true);
  assert.equal(firstScreenHtml.includes("正在加载 AgentArbor"), true);
  assert.equal(firstScreenHtml.includes("有什么可以帮到你？"), false);
  assert.equal(firstScreenHtml.includes("直接输入问题"), false);
  assert.equal(firstScreenHtml.includes("技能"), false);
  assert.equal(firstScreenHtml.includes("工具"), false);
  assert.equal(firstScreenHtml.includes("设置"), false);
  assert.equal(firstScreenHtml.includes("待处理"), false);
  assert.equal(firstScreenHtml.includes("待确认"), false);
  assert.equal(firstScreenHtml.includes("工作上下文"), false);
  assert.equal(firstScreenHtml.includes("证据"), false);
  assert.equal(firstScreenHtml.includes("结果"), false);
  assert.equal(firstScreenHtml.includes("下一步"), false);
  assert.equal(firstScreenHtml.includes("工作会话"), false);
  assert.equal(firstScreenHtml.includes("任务输入"), false);
  assertFirstScreenHasNoInternalTerms(firstScreenHtml);
});

test("active Panel entry reaches the Redesign workbench without the legacy shell", () => {
  const appSource = readFileSync(resolve("src/app/panel-ui/src/App.tsx"), "utf8");
  const workbenchEntry = readFileSync(
    resolve("src/app/panel-ui/src/personal-workbench/personal-workbench.tsx"),
    "utf8",
  );

  assert.equal(appSource.includes("./personal-workbench/personal-workbench"), true);
  assert.equal(appSource.includes("app-workbench-shell-props"), false);
  assert.equal(appSource.includes("./components/sidebar"), false);
  assert.equal(workbenchEntry.includes("./redesign/app/App"), true);
});
