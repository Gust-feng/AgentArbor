import React, { useState } from "react";
import { Check, ChevronDown, Clipboard, ExternalLink, FileText, ListChecks, RotateCcw, Sparkles, Terminal } from "lucide-react";
import type { PanelRunResultReadModel } from "../contracts/run";
import type { AssistantModelBadge } from "./chat-session-projection";
import { RichText } from "./rich-text";

type ResultActionHandler = (action: PanelRunResultReadModel["actions"][number]) => void;
export type RunResultDisplayKind = "transcript" | "standalone" | "compact";

export function ChatRunResult(props: {
  readonly result: PanelRunResultReadModel;
  readonly displayKind?: RunResultDisplayKind;
  readonly model?: AssistantModelBadge;
  readonly onAction?: ResultActionHandler;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy?: boolean;
}): React.ReactElement {
  const displayKind = props.displayKind ?? "transcript";
  return (
    <article className="assistant-message assistant-run-result" data-display-kind={displayKind} data-status={props.result.status}>
      <AssistantRunResultLabel model={props.model} />
      <div className="assistant-message-body panel-run-result">
        <RunResultHeader result={props.result} />
        <RunResultAnswer result={props.result} />
        <RunResultDeliverable evidence={props.result.evidence} />
        <RunResultActions
          actions={props.result.actions}
          hasConfirmation={props.result.confirmation !== undefined}
          onAction={props.onAction}
        />
        <RunResultProcess process={props.result.process} />
        <RunResultConfirmation
          confirmation={props.result.confirmation}
          busy={props.confirmationBusy === true}
          onDecision={props.onDecision}
        />
      </div>
    </article>
  );
}

function RunResultHeader(props: {
  readonly result: PanelRunResultReadModel;
}): React.ReactElement {
  const summary = resultSummary(props.result);
  return (
    <section className="panel-run-result-hero" data-tone={resultTone(props.result)}>
      <span className="panel-run-result-hero-icon" aria-hidden="true">
        <Sparkles size={16} />
      </span>
      <div className="panel-run-result-hero-copy">
        <div className="panel-run-result-hero-title">
          <strong>{resultTitle(props.result)}</strong>
          <span>{resultStatusLabel(props.result.status)}</span>
        </div>
        {summary.length > 0 && <p>{summary}</p>}
      </div>
    </section>
  );
}

export function RunResultAnswer(props: {
  readonly result: PanelRunResultReadModel;
}): React.ReactElement | null {
  const answer = props.result.answer;
  if (answer === undefined || answer.markdown.trim().length === 0) return null;
  return (
    <section className="assistant-answer panel-run-result-answer" data-tone={answer.tone ?? "final"}>
      <ResultSectionTitle title="回答" />
      <RichText text={answer.markdown} />
      {answer.copyText.trim().length > 0 && (
        <div className="turn-actions">
          <button type="button" onClick={() => copyToClipboard(answer.copyText)}>
            <Clipboard size={13} />
            复制
          </button>
        </div>
      )}
    </section>
  );
}

export function RunResultActions(props: {
  readonly actions: PanelRunResultReadModel["actions"];
  readonly hasConfirmation: boolean;
  readonly onAction?: ResultActionHandler;
}): React.ReactElement | null {
  const actions = props.actions.filter((action) => action.label.trim().length > 0 && !(props.hasConfirmation && action.kind === "confirm"));
  const handler = props.onAction;
  const buttonActions = handler === undefined ? [] : actions.filter(isInteractiveAction);
  const nextSuggestions = handler === undefined ? actions.filter((action) => action.kind === "next") : actions.filter((action) => !isInteractiveAction(action));
  if (buttonActions.length === 0 && nextSuggestions.length === 0) return null;
  return (
    <section className="panel-run-result-section panel-run-result-actions" aria-label="建议操作">
      <ResultSectionTitle icon={<ListChecks size={14} />} title="下一步" meta={actionMetaLabel(buttonActions.length + nextSuggestions.length)} />
      <div className="panel-run-result-action-list">
        {buttonActions.map((action) => (
          <button
            key={action.id}
            type="button"
            data-kind={action.kind}
            data-status={action.status ?? "available"}
            onClick={() => props.onAction?.(action)}
            disabled={action.status === "done"}
          >
            <ActionIcon kind={action.kind} />
            <span>{action.label}</span>
          </button>
        ))}
        {nextSuggestions.map((action) => (
          <div key={action.id} className="panel-run-result-next-action" data-kind={action.kind} data-status={action.status ?? "available"}>
            <ActionIcon kind={action.kind} />
            <span>{action.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function isInteractiveAction(action: PanelRunResultReadModel["actions"][number]): boolean {
  return action.kind === "next" || action.kind === "retry";
}

function AssistantRunResultLabel({ model }: { readonly model?: AssistantModelBadge }): React.ReactElement {
  const modelLabel = assistantModelLabel(model);
  return (
    <div className="assistant-message-label">
      {model?.iconSvg !== undefined && (
        <span className="assistant-message-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: model.iconSvg }} />
      )}
      {modelLabel !== undefined && <span className="assistant-message-model">{modelLabel}</span>}
    </div>
  );
}

export function RunResultDeliverable(props: {
  readonly evidence: PanelRunResultReadModel["evidence"];
}): React.ReactElement | null {
  const { files, commands, sources } = props.evidence;
  if (files.length === 0 && commands.length === 0 && sources.length === 0) return null;
  return (
    <section className="panel-run-result-section panel-run-result-deliverable" aria-label="交付物与证据">
      <ResultSectionTitle icon={<FileText size={14} />} title="交付物" meta={evidenceMetaLabel(props.evidence)} />
      {files.length > 0 && (
        <div className="panel-run-result-file-grid">
          {files.map((file) => <RunResultFileCard key={`${file.kind}:${file.path}`} file={file} />)}
        </div>
      )}
      {(commands.length > 0 || sources.length > 0) && (
        <div className="panel-run-result-supporting-evidence">
          {commands.length > 0 && (
            <EvidenceGroup title="命令">
              {commands.map((command, index) => (
                <EvidenceRow
                  key={`${command.command ?? "command"}:${index}`}
                  icon={<Terminal size={14} />}
                  title={command.command ?? command.summary ?? "命令执行"}
                  meta={command.exitCode === undefined ? undefined : `exit ${command.exitCode}`}
                >
                  {command.summary !== undefined && command.command !== command.summary && <p>{command.summary}</p>}
                  {command.logRef !== undefined && <p className="panel-run-result-ref">{command.logRef}</p>}
                </EvidenceRow>
              ))}
            </EvidenceGroup>
          )}
          {sources.length > 0 && (
            <EvidenceGroup title="来源">
              {sources.map((source) => (
                <EvidenceRow
                  key={`${source.ref ?? source.url ?? source.label}`}
                  icon={<ExternalLink size={14} />}
                  title={source.label}
                  meta={source.ref ?? source.url}
                >
                  {source.summary !== undefined && <p>{source.summary}</p>}
                </EvidenceRow>
              ))}
            </EvidenceGroup>
          )}
        </div>
      )}
    </section>
  );
}

export const RunResultEvidence = RunResultDeliverable;

export function RunResultProcess(props: {
  readonly process: PanelRunResultReadModel["process"];
}): React.ReactElement | null {
  const [open, setOpen] = useState(!props.process.defaultCollapsed);
  const hasSummary = props.process.summary.trim().length > 0;
  if (!hasSummary && props.process.items.length === 0) return null;
  return (
    <section className="panel-run-result-section panel-run-result-process">
      <button type="button" className="panel-run-result-process-toggle" onClick={() => setOpen((current) => !current)}>
        <ChevronDown size={14} data-open={open ? "true" : "false"} />
        <span>{hasSummary ? props.process.summary : "过程"}</span>
      </button>
      {open && props.process.items.length > 0 && (
        <ol className="panel-run-result-process-list">
          {props.process.items.map((item) => (
            <li key={item.id} data-status={item.status}>
              <span>{item.label}</span>
              <small>{item.kind} · {item.status}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RunResultFileCard(props: {
  readonly file: PanelRunResultReadModel["evidence"]["files"][number];
}): React.ReactElement {
  const { file } = props;
  const preview = file.preview?.trim();
  return (
    <article className="panel-run-result-file-card" data-kind={file.kind}>
      <div className="panel-run-result-file-head">
        <strong>{file.path}</strong>
        <span>{fileKindLabel(file.kind)}</span>
      </div>
      {file.summary !== undefined && file.summary.trim().length > 0 && (
        <p>{file.summary.trim()}</p>
      )}
      {preview !== undefined && preview.length > 0 && (
        <details className="panel-run-result-file-preview">
          <summary>查看预览</summary>
          <pre>{preview}</pre>
        </details>
      )}
    </article>
  );
}

export function RunResultConfirmation(props: {
  readonly confirmation?: PanelRunResultReadModel["confirmation"];
  readonly busy: boolean;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement | null {
  const confirmation = props.confirmation;
  if (confirmation === undefined) return null;
  return (
    <section className="confirmation-node-body panel-run-result-confirmation" data-risk={confirmation.riskLevel ?? "medium"}>
      <div className="confirmation-node-header">
        <strong>{confirmation.title}</strong>
      </div>
      <p className="confirmation-action-summary">{confirmation.body}</p>
      {confirmation.affectedResources.length > 0 && (
        <div className="confirmation-node-meta">
          {confirmation.affectedResources.map((resource) => <span key={resource}>{resource}</span>)}
        </div>
      )}
      {props.onDecision !== undefined && (
        <div className="confirmation-actions">
          <button
            type="button"
            className="primary"
            disabled={props.busy}
            onClick={() => props.onDecision?.("approve_once")}
          >
            {props.busy ? "执行中" : "执行"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={props.busy}
            onClick={() => props.onDecision?.("deny")}
          >
            不执行
          </button>
        </div>
      )}
    </section>
  );
}

function ResultSectionTitle(props: {
  readonly icon?: React.ReactNode;
  readonly title: string;
  readonly meta?: string;
}): React.ReactElement {
  return (
    <div className="panel-run-result-section-title">
      {props.icon !== undefined && <span aria-hidden="true">{props.icon}</span>}
      <strong>{props.title}</strong>
      {props.meta !== undefined && <small>{props.meta}</small>}
    </div>
  );
}

function EvidenceGroup(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="panel-run-result-evidence-group">
      <h3>{props.title}</h3>
      <div className="panel-run-result-evidence-list">{props.children}</div>
    </div>
  );
}

function EvidenceRow(props: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly meta?: string;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="panel-run-result-evidence-row">
      <span className="panel-run-result-evidence-icon" aria-hidden="true">{props.icon}</span>
      <div className="panel-run-result-evidence-body">
        <div className="panel-run-result-evidence-title">
          <strong>{props.title}</strong>
          {props.meta !== undefined && <small>{props.meta}</small>}
        </div>
        {props.children}
      </div>
    </div>
  );
}

function ActionIcon(props: { readonly kind: PanelRunResultReadModel["actions"][number]["kind"] }): React.ReactElement {
  if (props.kind === "retry") return <RotateCcw size={14} />;
  if (props.kind === "open_file" || props.kind === "inspect") return <ExternalLink size={14} />;
  return <Check size={14} />;
}

function resultTitle(result: PanelRunResultReadModel): string {
  if (result.status === "failed" || result.answer?.tone === "error") return "运行结果需要处理";
  if (result.status === "waiting_confirmation") return "等待确认";
  if (result.status === "cancelled") return "运行已取消";
  if (result.status === "blocked") return "结果受阻";
  if (result.status === "completed") return "本轮结果";
  return "正在整理结果";
}

function resultSummary(result: PanelRunResultReadModel): string {
  const processSummary = result.process.summary.trim();
  if (processSummary.length > 0) return processSummary;
  const evidenceParts = [
    countLabel(result.evidence.files.length, "个文件变更"),
    countLabel(result.evidence.commands.length, "条命令证据"),
    countLabel(result.evidence.sources.length, "个来源"),
  ].filter((part): part is string => part !== undefined);
  if (evidenceParts.length > 0) return evidenceParts.join(" · ");
  if (result.status === "waiting_confirmation") return "需要用户确认后才能继续执行。";
  if (result.status === "running" || result.status === "queued") return "运行仍在进行中，结果会继续更新。";
  return "";
}

function resultTone(result: PanelRunResultReadModel): "success" | "warning" | "danger" | "neutral" {
  if (result.status === "failed" || result.answer?.tone === "error") return "danger";
  if (result.status === "waiting_confirmation" || result.status === "blocked") return "warning";
  if (result.status === "completed") return "success";
  return "neutral";
}

function resultStatusLabel(status: PanelRunResultReadModel["status"]): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "运行中";
    case "waiting_confirmation":
      return "待确认";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "blocked":
      return "受阻";
  }
}

function evidenceMetaLabel(evidence: PanelRunResultReadModel["evidence"]): string | undefined {
  const parts = [
    countLabel(evidence.files.length, "个文件"),
    countLabel(evidence.commands.length, "条命令"),
    countLabel(evidence.sources.length, "个来源"),
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function actionMetaLabel(count: number): string | undefined {
  return count === 0 ? undefined : `${count} 项`;
}

function countLabel(count: number, unit: string): string | undefined {
  return count === 0 ? undefined : `${count} ${unit}`;
}

function fileKindLabel(kind: PanelRunResultReadModel["evidence"]["files"][number]["kind"]): string {
  switch (kind) {
    case "created":
      return "新建";
    case "modified":
      return "修改";
    case "deleted":
      return "删除";
    case "changed":
      return "变更";
  }
}

function assistantModelLabel(model: AssistantModelBadge | undefined): string | undefined {
  if (model === undefined) return undefined;
  const name = model.modelName.trim();
  return name.length > 0 ? name : undefined;
}

function copyToClipboard(value: string): void {
  if (navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(value);
  }
}
