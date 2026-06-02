import React from "react";
import { Copy } from "lucide-react";
import { compact } from "../text";
import type { TranscriptNode } from "../contracts/run";
import type { ToolDisplayProjection } from "../contracts/tools";
import { commandText, genericItemLabel } from "./transcript-tool-format";

export function ToolNodeDetail({ node }: { readonly node: TranscriptNode }): React.ReactElement | undefined {
  const display = node.display;
  if (display === undefined) {
    return node.summary === undefined ? undefined : <p className="transcript-node-summary">{node.summary}</p>;
  }
  if (display.kind === "command_summary") {
    return <CommandDetail display={display} />;
  }
  if (display.kind === "search_results") {
    return <SearchDetail display={display} />;
  }
  if (display.kind === "browser_snapshot") {
    return <BrowserDetail display={display} />;
  }
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") {
    return <FileChangeDetail display={display} />;
  }
  if (display.kind === "generic_tool_summary") {
    return <GenericToolDetail display={display} fallback={node.summary} />;
  }
  return undefined;
}

function CommandDetail({ display }: { readonly display: Extract<ToolDisplayProjection, { readonly kind: "command_summary" }> }): React.ReactElement {
  const command = commandText(display);
  const output = [display.outputSummary, display.errorSummary]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join("\n");
  return (
    <div className="transcript-tool-detail" data-display="command">
      {command !== undefined && (
        <div className="transcript-command-block">
          <button type="button" className="activity-copy-btn" onClick={() => copyToClipboard(command)} aria-label="复制命令">
            <Copy size={12} />
          </button>
          <pre>{command}</pre>
        </div>
      )}
      {(output.length > 0 || (display.exitCode !== undefined && display.exitCode !== 0)) && (
        <div className="transcript-output-panel">
          <pre>{[
            output,
            display.exitCode !== undefined && display.exitCode !== 0 ? `exit ${display.exitCode}` : undefined,
          ].filter((value): value is string => value !== undefined && value.length > 0).join("\n")}</pre>
        </div>
      )}
    </div>
  );
}

function SearchDetail({ display }: { readonly display: Extract<ToolDisplayProjection, { readonly kind: "search_results" }> }): React.ReactElement {
  return (
    <div className="transcript-tool-detail" data-display="search">
      <div className="transcript-detail-list">
        {display.results.slice(0, 6).map((item, index) => (
          <div className="transcript-detail-row" key={`${item.title}:${item.url ?? index}`}>
            <strong>{item.title}</strong>
            {item.url !== undefined && <em>{item.url}</em>}
            {(item.summary ?? item.snippet) !== undefined && <span>{compact(item.summary ?? item.snippet ?? "", 160)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function BrowserDetail({ display }: { readonly display: Extract<ToolDisplayProjection, { readonly kind: "browser_snapshot" }> }): React.ReactElement {
  return (
    <div className="transcript-tool-detail" data-display="browser">
      <div className="transcript-detail-list">
        <div className="transcript-detail-row">
          <strong>{display.title ?? "网页"}</strong>
          {display.url !== undefined && <em>{display.url}</em>}
          {(display.summary ?? display.text) !== undefined && <span>{compact(display.summary ?? display.text ?? "", 220)}</span>}
        </div>
      </div>
    </div>
  );
}

function GenericToolDetail(props: {
  readonly display: Extract<ToolDisplayProjection, { readonly kind: "generic_tool_summary" }>;
  readonly fallback?: string;
}): React.ReactElement | undefined {
  const items = props.display.items ?? [];
  const summary = props.display.summary ?? props.fallback;
  if (items.length === 0 && (summary === undefined || summary.trim().length === 0)) {
    return undefined;
  }
  return (
    <div className="transcript-tool-detail" data-display="generic">
      {items.length > 0 ? (
        <div className="transcript-detail-list">
          {items.slice(0, 10).map((item) => (
            <div className="transcript-detail-row" key={item}>
              <strong>{genericItemLabel(item)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="transcript-node-summary">{summary}</p>
      )}
    </div>
  );
}

function FileChangeDetail({ display }: { readonly display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }> }): React.ReactElement {
  const stats = fileChangeStats(display);
  const preview = display.preview?.trim();
  const label = display.path ?? "文件";
  return (
    <div className="file-change-review" data-display="file-change">
      <div className="file-change-review-header">
        <div>
          <strong>{label}</strong>
        </div>
        {stats.length > 0 && (
          <div className="file-change-stats">
            {stats.map((stat) => <span key={stat}>{stat}</span>)}
          </div>
        )}
      </div>
      {preview !== undefined && preview.length > 0 ? (
        <div className="file-diff-panel">
          {diffLines(preview).map((line, index) => (
            <div className={`file-diff-line ${line.kind}`} key={`${index}:${line.text}`}>
              <span>{line.sign}</span>
              <p>{line.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="file-diff-preview">{display.summary ?? "已更新"}</p>
      )}
    </div>
  );
}

function fileChangeStats(display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>): readonly string[] {
  if (display.kind === "file_diff_preview") {
    return [
      display.replacements === undefined ? undefined : `${display.replacements} 处修改`,
      display.previousLength === undefined || display.nextLength === undefined ? undefined : `${display.previousLength} -> ${display.nextLength} chars`,
      display.truncated === true ? "已截取" : undefined,
    ].filter((value): value is string => value !== undefined);
  }
  return [
    display.bytes === undefined ? undefined : `${display.bytes} bytes`,
    display.append === true ? "追加" : undefined,
    display.truncated === true ? "已截取" : undefined,
  ].filter((value): value is string => value !== undefined);
}

function diffLines(preview: string): readonly { readonly sign: string; readonly text: string; readonly kind: "add" | "remove" | "neutral" }[] {
  return preview.split(/\r?\n/).filter((line) => line.length > 0).map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return { sign: "+", text: line.slice(1), kind: "add" };
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      return { sign: "-", text: line.slice(1), kind: "remove" };
    }
    return { sign: " ", text: line, kind: "neutral" };
  });
}

function copyToClipboard(value: string): void {
  if (navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(value);
  }
}
