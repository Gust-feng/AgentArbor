import React from "react";
import { compact } from "../text";
import type { BasicAgentRun, DesktopRunDetail, DesktopWorkSession, RunEvent, ToolDisplayProjection } from "../types";

export function RightInspector(props: {
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly events: readonly RunEvent[];
  readonly detail?: DesktopRunDetail;
  readonly toolDisplays: readonly ToolDisplayProjection[];
}): React.ReactElement {
  const contextItems = props.detail?.canvas?.agent?.context?.items ?? [];
  const attachments = props.workSession?.contextAttachments ?? [];
  const ledgerEntries = props.workSession?.contextLedger.entries ?? [];
  const toolDisplays = props.workSession?.deliverable?.toolDisplays ?? props.toolDisplays;
  const pendingConfirmation = props.workSession?.pendingConfirmation ?? props.detail?.canvas?.agent?.pendingConfirmation;
  return (
    <aside className="right-inspector" aria-label="工作上下文">
      {pendingConfirmation !== undefined && (
        <section>
          <h2>待确认</h2>
          <article className="mini-card warning">
            <strong>{pendingConfirmation.title}</strong>
            <p>{compact("actionSummary" in pendingConfirmation ? pendingConfirmation.actionSummary : pendingConfirmation.question, 180)}</p>
          </article>
        </section>
      )}
      <section>
        <h2>上下文与文件</h2>
        {ledgerEntries.length > 0 ? (
          ledgerEntries.slice(0, 8).map((entry) => (
            <article className={`mini-card ${entry.status}`} key={entry.entryId}>
              <strong>{entry.title}</strong>
              <p>{compact(entry.summary, 160)}</p>
            </article>
          ))
        ) : attachments.length > 0 ? (
          attachments.slice(0, 6).map((attachment) => (
            <article className="mini-card" key={attachment.attachmentId}>
              <strong>{attachment.title}</strong>
              <p>{compact(attachment.summary, 160)}</p>
            </article>
          ))
        ) : contextItems.length === 0 ? (
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
        <h2>证据与资料</h2>
        {toolDisplays.length === 0 ? (
          <p className="muted">读取文件、网页或执行操作后，会在这里显示可引用的摘要。</p>
        ) : (
          toolDisplays.map((display, index) => <ToolDisplayCard display={display} key={`${display.kind}:${index}`} />)
        )}
      </section>
      <section>
        <h2>权限</h2>
        <p className="muted">{props.workSession?.safetySummary.summary ?? (props.run?.requiresUserAction ? "这次任务需要你处理确认或补充信息。" : "这里只展示权限说明和引用，不显示原始输出。")}</p>
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
              {(result.summary ?? result.snippet) && <small>{result.summary ?? result.snippet}</small>}
            </li>
          ))}
        </ul>
      </article>
    );
  }
  if (display.kind === "command_summary") {
    return (
      <article className="mini-card">
        <strong>命令结果</strong>
        {display.command && <p>{display.command}</p>}
        {display.outputSummary && <small>{display.outputSummary}</small>}
        {display.errorSummary && <small>{display.errorSummary}</small>}
      </article>
    );
  }
  return (
    <article className="mini-card">
      <strong>{toolDisplayTitle(display.kind)}</strong>
      {"summary" in display && display.summary && <p>{display.summary}</p>}
      {"text" in display && display.text && <p>{display.text}</p>}
      {"preview" in display && display.preview && <pre>{display.preview}</pre>}
      {"items" in display && display.items && (
        <ul>{display.items.slice(0, 6).map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}</ul>
      )}
    </article>
  );
}

function contextItemLabel(kind: string): string {
  if (kind === "system") return "工作边界";
  if (kind === "skill") return "技能";
  if (kind === "conversation") return "历史对话";
  if (kind === "user_message") return "当前任务";
  return "上下文引用";
}

function toolDisplayTitle(kind: ToolDisplayProjection["kind"]): string {
  if (kind === "browser_snapshot") return "浏览器摘要";
  if (kind === "file_change_summary") return "文件变更";
  if (kind === "file_diff_preview") return "差异预览";
  return "操作摘要";
}
