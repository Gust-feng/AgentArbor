import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function readPanelUiSource(fileName: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "src", "app", "panel-ui", "src", fileName), "utf8");
}

export async function readPanelUiStyle(fileName: string): Promise<string> {
  return readPanelUiSource(path.join("styles", fileName));
}

export async function readAppSource(fileName: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "src", "app", fileName), "utf8");
}

/**
 * 读取归档模块（`src/deferred/`）源码。
 *
 * Multi-Agent 后端已归档，但 Panel 侧仍保留其前端投影，二者之间的契约对齐
 * 仍需被结构测试守住——否则归档代码与现役前端会在无人察觉时漂移。
 */
export async function readDeferredSource(fileName: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "src", "deferred", fileName), "utf8");
}

export function assertFirstScreenHasNoInternalTerms(html: string): void {
  for (const term of [
    "Task Soil",
    "Plan Package",
    "Observation Panel",
    "Agent Run Tree",
    "provider",
    "rootlet",
    "EventLog",
    "Routines",
    "OpenAI-compatible",
    "Fake AI",
    "AI 禁用",
    "运行树",
    "父层 synthesis",
    "详情与诊断",
    "真实 AI 诊断",
    "模型 / 工具流",
    "测试模型",
    "内容由 AI 生成",
    "快速提问",
    "文档分析",
    "加载更多",
    "申请授权",
    "占位",
    "Skeleton",
    "Fixture",
  ]) {
    assert.equal(html.includes(term), false, `first screen should not include ${term}`);
  }
}

export function assertOrdinaryUiSourceHasNoInternalTerms(source: string): void {
  for (const term of [
    "Task Soil",
    "Plan Package",
    "Observation Panel",
    "Agent Run Tree",
    "rootlet",
    "raw prompt",
    "raw provider",
    "raw tool",
    "event id",
    "tool id",
  ]) {
    assert.equal(source.includes(term), false, `ordinary UI source should not include ${term}`);
  }
}
