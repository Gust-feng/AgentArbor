import React from "react";
import { ArrowUpRight, ChevronRight, FileText } from "lucide-react";
import type {
  ActivityExpandedItem,
  ActivityExpandedSection,
  ActivityItem,
} from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import { CopyActionButton } from "./copy-action-button";

const PRIMARY_LIST_LIMIT = 8;

export function ActivityEvidencePanel(props: {
  readonly item: ActivityItem;
}): React.ReactElement | null {
  const sections = props.item.expandedSections ?? expandedDetailSectionsForItem(props.item);
  if (sections === undefined || sections.length === 0) {
    return null;
  }

  if (props.item.toolKind === "command") {
    return <CommandEvidence item={props.item} sections={sections} />;
  }

  const sourceList = sections.find((section) => section.format === "source_list");
  if (sourceList !== undefined) {
    return (
      <div className="agent-evidence-panel" data-tool-kind="search">
        <EvidenceItemList
          items={sourceList.items}
          fallback={sourceList.content}
          kind="source"
        />
      </div>
    );
  }

  const sourceSections = sections.filter((section) => section.format === "source");
  if (props.item.toolKind === "search" && sourceSections.length > 0) {
    return (
      <div className="agent-evidence-panel" data-tool-kind="search">
        {sourceSections.map((section, index) => (
          <GenericEvidenceSection
            key={`${section.title}-${index}`}
            section={section}
            hideTitle
          />
        ))}
      </div>
    );
  }

  const pathList = sections.find((section) => section.format === "path_list");
  if (pathList !== undefined && sections.length === 1) {
    return (
      <div className="agent-evidence-panel" data-tool-kind={props.item.toolKind}>
        <EvidenceItemList
          items={pathList.items}
          fallback={pathList.content}
          kind="path"
        />
      </div>
    );
  }

  if (props.item.toolKind === "edit") {
    return <FileChangeEvidence item={props.item} sections={sections} />;
  }

  if (props.item.toolKind === "read" || props.item.toolKind === "web") {
    return <ReadEvidence item={props.item} sections={sections} />;
  }

  return (
    <div className="agent-evidence-panel" data-tool-kind={props.item.toolKind}>
      {sections.map((section, index) => (
        sectionRepeatsLeadContext(section, props.item)
          ? null
          : (
            <GenericEvidenceSection
              key={`${section.title}-${index}`}
              section={section}
              hideTitle={shouldHideSectionTitle(section)}
            />
          )
      ))}
    </div>
  );
}

function CommandEvidence(props: {
  readonly item: ActivityItem;
  readonly sections: readonly ActivityExpandedSection[];
}): React.ReactElement {
  const command = props.sections.find((section) => section.title === "命令");
  const output = props.sections.find((section) => section.title === "输出") ??
    props.sections.find((section) => section.format === "console" && section !== command);
  const rest = props.sections.filter((section) =>
    section !== command &&
    section !== output &&
    section.format !== "diagnostics" &&
    section.title !== "更多信息"
  );
  const tone = props.item.phase === "failed" || props.item.phase === "blocked" || output?.tone === "danger"
    ? "danger"
    : "neutral";

  return (
    <div className="agent-evidence-panel" data-tool-kind="command">
      <section className="agent-command-evidence" data-tone={tone}>
        {command !== undefined && (
          <header className="agent-command-line">
            <code>{stripCommandPrompt(command.content)}</code>
            <CopyActionButton
              value={stripCommandPrompt(command.content)}
              label="复制命令"
              className="agent-evidence-copy"
            />
          </header>
        )}
        {output !== undefined && (
          <pre className="agent-command-output">
            <code>{output.content}</code>
          </pre>
        )}
      </section>
      {rest.map((section, index) => (
        <GenericEvidenceSection
          key={`${section.title}-${index}`}
          section={section}
          hideTitle={shouldHideSectionTitle(section)}
        />
      ))}
    </div>
  );
}

function FileChangeEvidence(props: {
  readonly item: ActivityItem;
  readonly sections: readonly ActivityExpandedSection[];
}): React.ReactElement {
  const fileSections = props.sections.filter((section) => section.format === "diff" || section.format === "code");
  const rest = props.sections.filter((section) => !fileSections.includes(section));
  if (fileSections.length === 0) {
    return (
      <div className="agent-evidence-panel" data-tool-kind="edit">
        {props.sections.map((section, index) => (
          <GenericEvidenceSection
            key={`${section.title}-${index}`}
            section={section}
            hideTitle={shouldHideSectionTitle(section)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="agent-evidence-panel" data-tool-kind="edit">
      <div className="agent-file-evidence-stack" data-file-count={fileSections.length}>
        {fileSections.map((section, index) => (
          fileSections.length === 1
            ? (
              <section className="agent-file-evidence" key={`${section.title}-${index}`}>
                <NativeSectionContent section={section} />
              </section>
            )
            : (
              <details className="agent-file-evidence" key={`${section.title}-${index}`}>
                <summary>
                  <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
                  <span>{section.title}</span>
                  <ChevronRight size={13} aria-hidden="true" />
                </summary>
                <NativeSectionContent section={section} />
              </details>
            )
        ))}
      </div>
      {rest.map((section, index) => (
        <GenericEvidenceSection
          key={`${section.title}-${index}`}
          section={section}
          hideTitle={shouldHideSectionTitle(section)}
        />
      ))}
    </div>
  );
}

function ReadEvidence(props: {
  readonly item: ActivityItem;
  readonly sections: readonly ActivityExpandedSection[];
}): React.ReactElement {
  const linkedSources = props.sections.filter((section) =>
    section.format === "source" && section.href !== undefined
  );
  const sections = linkedSources.length > 0 ? linkedSources : props.sections;
  return (
    <div className="agent-evidence-panel" data-tool-kind={props.item.toolKind}>
      {sections.map((section, index) => {
        if (sectionRepeatsLeadContext(section, props.item)) {
          return null;
        }
        if (sourceRepeatsLead(section, props.item)) {
          return section.href === undefined
            ? null
            : <SourceOnlyLink href={section.href} key={`${section.title}-${index}`} />;
        }
        return (
          <GenericEvidenceSection
            key={`${section.title}-${index}`}
            section={section}
            hideTitle={shouldHideSectionTitle(section)}
          />
        );
      })}
    </div>
  );
}

function SourceOnlyLink(props: { readonly href: string }): React.ReactElement {
  return (
    <a
      className="agent-evidence-source-link agent-evidence-source-link-only"
      href={props.href}
      target="_blank"
      rel="noreferrer noopener"
      title={props.href}
    >
      <span>{sourceHost(props.href)}</span>
      <ArrowUpRight size={13} aria-hidden="true" />
    </a>
  );
}

function sourceRepeatsLead(section: ActivityExpandedSection, item: ActivityItem): boolean {
  if (section.format !== "source") {
    return false;
  }
  const source = normalizedVisibleText(section.content);
  const subject = normalizedVisibleText(item.lead?.subject ?? item.copy.detail);
  return source.length > 0 && (subject === source || subject.startsWith(`${source} ·`));
}

function sectionRepeatsLeadContext(section: ActivityExpandedSection, item: ActivityItem): boolean {
  if (section.format === "code" || section.format === "console" || section.format === "diff") {
    return false;
  }
  const context = item.lead?.context;
  return context !== undefined &&
    normalizedVisibleText(section.content) === normalizedVisibleText(context);
}

function normalizedVisibleText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sourceHost(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./u, "") || href;
  } catch {
    return href;
  }
}

function GenericEvidenceSection(props: {
  readonly section: ActivityExpandedSection;
  readonly hideTitle: boolean;
}): React.ReactElement {
  if (props.section.format === "diagnostics") {
    return (
      <details className="agent-evidence-diagnostics">
        <summary>
          <ChevronRight size={12} aria-hidden="true" />
          <span>{props.section.title}</span>
        </summary>
        <NativeSectionContent section={props.section} />
      </details>
    );
  }

  const framed = props.section.format === "code" ||
    props.section.format === "console" ||
    props.section.format === "diff";
  return (
    <section
      className="agent-evidence-section"
      data-format={props.section.format ?? "plain"}
      data-tone={props.section.tone ?? "neutral"}
    >
      {!props.hideTitle && (
        <header className="agent-evidence-section-header">
          <span>{props.section.title}</span>
          {framed && (
            <CopyActionButton
              value={props.section.content}
              label={`复制${props.section.title}`}
              className="agent-evidence-copy"
            />
          )}
        </header>
      )}
      <NativeSectionContent section={props.section} />
    </section>
  );
}

function shouldHideSectionTitle(section: ActivityExpandedSection): boolean {
  if (section.format === "diagnostics" || section.tone === "danger" || section.tone === "warning") {
    return false;
  }
  if (
    ["详情", "内容", "内容预览", "结果", "提示", "来源", "条目", "匹配位置", "摘要", "摘录", "页面摘录", "输出"]
      .includes(section.title)
  ) {
    return true;
  }
  if (section.format === "code" || section.format === "console" || section.format === "diff") {
    return false;
  }
  if (
    section.format === "source" ||
    section.format === "source_list" ||
    section.format === "path_list" ||
    section.format === "quote"
  ) {
    return true;
  }
  return false;
}

function NativeSectionContent(props: {
  readonly section: ActivityExpandedSection;
}): React.ReactElement {
  const section = props.section;
  if (section.format === "source_list" || section.format === "path_list") {
    return (
      <EvidenceItemList
        items={section.items}
        fallback={section.content}
        kind={section.format === "source_list" ? "source" : "path"}
      />
    );
  }
  if (section.format === "source") {
    if (section.href !== undefined) {
      return (
        <a
          className="agent-evidence-source"
          href={section.href}
          target="_blank"
          rel="noreferrer noopener"
          title={section.href}
        >
          <span className="agent-evidence-source-title">{section.content}</span>
          <span className="agent-evidence-source-link">
            <span>{sourceHost(section.href)}</span>
            <ArrowUpRight size={13} aria-hidden="true" />
          </span>
        </a>
      );
    }
    return (
      <div className="agent-evidence-source">
        <span className="agent-evidence-source-title">{section.content}</span>
      </div>
    );
  }
  if (section.format === "quote") {
    return <blockquote className="agent-evidence-quote">{section.content}</blockquote>;
  }
  if (section.format === "diff") {
    return <DiffView section={section} />;
  }
  if (section.format === "code" || section.format === "console") {
    return (
      <pre className="agent-evidence-code">
        <code>{section.content}</code>
      </pre>
    );
  }
  if (section.format === "list" || section.format === "diagnostics") {
    return (
      <ul className="agent-evidence-list">
        {section.content
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
      </ul>
    );
  }
  return <div className="agent-evidence-plain">{section.content}</div>;
}

function DiffView(props: { readonly section: ActivityExpandedSection }): React.ReactElement {
  return (
    <pre className="agent-evidence-diff" aria-label={props.section.title}>
      {props.section.content.split("\n").map((line, index) => {
        const parts = diffLineParts(line);
        return (
          <span className="agent-evidence-diff-line" data-kind={parts.kind} key={`${index}-${line}`}>
            <span className="agent-evidence-diff-marker" aria-hidden="true">{parts.marker}</span>
            <code>{parts.text.length === 0 ? " " : parts.text}</code>
          </span>
        );
      })}
    </pre>
  );
}

function EvidenceItemList(props: {
  readonly items?: readonly ActivityExpandedItem[];
  readonly fallback: string;
  readonly kind: "source" | "path";
}): React.ReactElement {
  const fallbackItems: readonly ActivityExpandedItem[] = props.fallback
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((title) => ({ title }));
  const items: readonly ActivityExpandedItem[] = props.kind === "source"
    ? (props.items ?? fallbackItems).map(sourceEvidenceItem)
    : props.items ?? fallbackItems;
  const primary = items.slice(0, PRIMARY_LIST_LIMIT);
  const remaining = items.slice(PRIMARY_LIST_LIMIT);
  return (
    <div className="agent-evidence-item-group" data-kind={props.kind}>
      <EvidenceItems items={primary} kind={props.kind} />
      {remaining.length > 0 && (
        <details className="agent-evidence-more">
          <summary>
            <ChevronRight size={12} aria-hidden="true" />
            <span>更多</span>
          </summary>
          <EvidenceItems items={remaining} kind={props.kind} />
        </details>
      )}
    </div>
  );
}

function sourceEvidenceItem(item: ActivityExpandedItem): ActivityExpandedItem {
  return {
    title: item.title,
    href: item.href,
    meta: item.href === undefined ? undefined : [{ value: sourceHost(item.href) }],
  };
}

function EvidenceItems(props: {
  readonly items: readonly ActivityExpandedItem[];
  readonly kind: "source" | "path";
}): React.ReactElement {
  return (
    <ol className="agent-evidence-item-list" data-kind={props.kind}>
      {props.items.map((item, index) => (
        <li key={`${index}-${item.title}`}>
          <div className="agent-evidence-item-main">
            {item.href === undefined
              ? <strong data-monospace={item.monospace === true ? "true" : undefined}>{item.title}</strong>
              : (
                <a href={item.href} target="_blank" rel="noreferrer noopener">
                  <strong>{item.title}</strong>
                  <ArrowUpRight size={13} aria-hidden="true" />
                </a>
              )}
            <EvidenceMeta items={item.meta} />
          </div>
          {item.detail !== undefined && <p>{item.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

function EvidenceMeta(props: {
  readonly items?: readonly { readonly label?: string; readonly value: string }[];
}): React.ReactElement | null {
  if (props.items === undefined || props.items.length === 0) {
    return null;
  }
  return (
    <span className="agent-evidence-meta">
      {props.items.map((item, index) => (
        <span key={`${index}-${item.value}`} title={item.label}>{item.value}</span>
      ))}
    </span>
  );
}

function expandedDetailSectionsForItem(item: ActivityItem): readonly ActivityExpandedSection[] | undefined {
  if (item.copy.expandedDetail === undefined) {
    return undefined;
  }
  return [{
    title: "详情",
    content: item.copy.expandedDetail,
    format: item.tone === "thinking" ? "quote" : "plain",
  }];
}

function stripCommandPrompt(value: string): string {
  return value.replace(/^\$\s*/u, "");
}

type DiffLineKind = "add" | "delete" | "hunk" | "file" | "context";

function diffLineParts(line: string): {
  readonly kind: DiffLineKind;
  readonly marker: string;
  readonly text: string;
} {
  if (line.startsWith("@@")) {
    return { kind: "hunk", marker: "@", text: line };
  }
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---")) {
    return { kind: "file", marker: "", text: line };
  }
  if (line.startsWith("+")) {
    return { kind: "add", marker: "+", text: line.slice(1) };
  }
  if (line.startsWith("-")) {
    return { kind: "delete", marker: "-", text: line.slice(1) };
  }
  if (line.startsWith(" ")) {
    return { kind: "context", marker: "", text: line.slice(1) };
  }
  return { kind: "context", marker: "", text: line };
}
