import React from "react";
import { compact } from "../text";
import type { BasicAgentRun, DesktopRunDetail, RunEvent, ToolDisplayProjection } from "../types";

export function RightInspector(props: {
  readonly run?: BasicAgentRun;
  readonly events: readonly RunEvent[];
  readonly detail?: DesktopRunDetail;
  readonly toolDisplays: readonly ToolDisplayProjection[];
}): React.ReactElement {
  const contextItems = props.detail?.canvas?.agent?.contextPack?.items ?? [];
  return (
    <aside className="right-inspector" aria-label="工作上下文">
      <section>
        <h2>上下文</h2>
        {contextItems.length === 0 ? (
          <p className="muted">当前没有额外上下文。</p>
        ) : (
          contextItems.slice(0, 6).map((item) => (
            <article className="mini-card" key={item.itemId}>
              <strong>{contextItemLabel(item.sourceKind)}</strong>
              <p>{compact(item.summary, 160)}</p>
            </article>
          ))
        )}
      </section>
      <section>
        <h2>工具结果</h2>
        {props.toolDisplays.length === 0 ? (
          <p className="muted">工具完成后会在这里显示安全摘要。</p>
        ) : (
          props.toolDisplays.map((display, index) => <ToolDisplayCard display={display} key={`${display.kind}:${index}`} />)
        )}
      </section>
      <section>
        <h2>安全摘要</h2>
        <p className="muted">{props.run?.requiresUserAction ? "这次运行需要你处理确认或补充信息。" : "普通视图只展示安全摘要和引用。"}</p>
      </section>
    </aside>
  );
}

function ToolDisplayCard({ display }: { readonly display: ToolDisplayProjection }): React.ReactElement {
  if (display.kind === "search_results") {
    return (
      <article className="mini-card">
        <strong>搜索结果</strong>
        {display.query && <p>{display.query}</p>}
        <ul>
          {display.results.slice(0, 3).map((result, index) => (
            <li key={`${result.url ?? result.title}:${index}`}>
              {result.url ? <a href={result.url} target="_blank" rel="noreferrer">{result.title}</a> : result.title}
              {result.summary && <small>{result.summary}</small>}
            </li>
          ))}
        </ul>
      </article>
    );
  }
  if (display.kind === "command_summary") {
    return (
      <article className="mini-card">
        <strong>命令摘要</strong>
        {display.command && <p>{display.command}</p>}
        {display.stdoutSummary && <small>{display.stdoutSummary}</small>}
        {display.stderrSummary && <small>{display.stderrSummary}</small>}
      </article>
    );
  }
  return (
    <article className="mini-card">
      <strong>{toolDisplayTitle(display.kind)}</strong>
      {"summary" in display && display.summary && <p>{display.summary}</p>}
      {"preview" in display && display.preview && <pre>{display.preview}</pre>}
    </article>
  );
}

function contextItemLabel(kind: string): string {
  if (kind === "system") return "系统边界";
  if (kind === "skill") return "技能";
  if (kind === "conversation") return "历史对话";
  if (kind === "user_message") return "当前任务";
  return "上下文引用";
}

function toolDisplayTitle(kind: ToolDisplayProjection["kind"]): string {
  if (kind === "browser_snapshot") return "浏览器摘要";
  if (kind === "file_change_summary") return "文件变更";
  if (kind === "file_diff_preview") return "差异预览";
  return "工具摘要";
}
