/**
 * 多 Agent 可解释结论区组件（T3-4d）。
 *
 * 渲染 [`DeepConclusionView`](src/app/panel-ui/src/contracts/deep.ts:195)，
 * 落地 FR-006（可解释结论展示）：结论 + 核心理由，可展开"为什么选 A / 为什么不选 B /
 * 风险 / 不确定性 / 相关证据引用"，证据可追溯。
 *
 * 展开交互：候选取舍（candidateDispositions）默认折叠为摘要计数，点击展开后按
 * selected → rejected 分组列出每条候选的采纳/拒绝理由，让用户复盘取舍依据。
 *
 * 安全口径（FR-007）：只渲染契约中的安全投影字段；outputRefs / keyEvidenceRefs
 * 只展示 refId 标识，不解析原始材料内容。
 */
import React, { useState } from "react";
import { ChevronDown, Lightbulb, Scale } from "lucide-react";
import type {
  DeepCandidateDisposition,
  DeepConclusionView,
} from "../contracts/deep";

type DeepConclusionProps = {
  /** 综合结论视图（run 收尾后由 report.conclusion 提供）。 */
  readonly conclusion: DeepConclusionView;
};

/**
 * 多 Agent 可解释结论区入口。
 */
export function DeepConclusion(props: DeepConclusionProps): React.ReactElement {
  const { conclusion } = props;
  const confidence = confidencePercent(conclusion.confidence);
  return (
    <section className="deep-conclusion" aria-label="Agent 集群可解释结论">
      <header className="deep-conclusion-head">
        <Lightbulb className="deep-conclusion-icon" aria-hidden="true" />
        <h3 className="deep-conclusion-title">综合结论</h3>
        {confidence && (
          <span className="deep-conclusion-confidence">
            置信度 {confidence}
          </span>
        )}
        {conclusion.source === "deterministic_fallback" && (
          <span className="deep-source-badge deep-source-fallback">
            兜底产出
          </span>
        )}
      </header>

      <p className="deep-conclusion-text">{conclusion.conclusion}</p>
      <p className="deep-conclusion-rationale">{conclusion.oneLineRationale}</p>

      {conclusion.mainUncertainty && (
        <p className="deep-conclusion-uncertainty">
          <span className="deep-conclusion-uncertainty-label">主要不确定性：</span>
          {conclusion.mainUncertainty}
        </p>
      )}

      {conclusion.candidateDispositions.length > 0 && (
        <CandidateDispositions dispositions={conclusion.candidateDispositions} />
      )}

      {conclusion.keyEvidenceRefs.length > 0 && (
        <div className="deep-conclusion-refs">
          <span className="deep-ref-label">关键证据</span>
          <RefChips refs={conclusion.keyEvidenceRefs} />
        </div>
      )}

      {conclusion.outputRefs.length > 0 && (
        <div className="deep-conclusion-refs">
          <span className="deep-ref-label">综合产出引用</span>
          <RefChips refs={conclusion.outputRefs} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 候选取舍：可展开
// ---------------------------------------------------------------------------

type CandidateDispositionsProps = {
  readonly dispositions: readonly DeepCandidateDisposition[];
};

function CandidateDispositions(props: CandidateDispositionsProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const selected = props.dispositions.filter((item) => item.selected);
  const rejected = props.dispositions.filter((item) => !item.selected);

  return (
    <div className="deep-conclusion-dispositions">
      <button
        type="button"
        className="deep-dispositions-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <Scale className="deep-dispositions-icon" aria-hidden="true" />
        <span className="deep-dispositions-summary">
          候选取舍（采纳 {selected.length} / 拒绝 {rejected.length}）
        </span>
        <ChevronDown
          className={`deep-dispositions-chevron ${expanded ? "deep-chevron-open" : ""}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div className="deep-dispositions-body">
          {selected.length > 0 && (
            <DispositionGroup
              title="为什么选这些方向"
              tone="selected"
              items={selected}
            />
          )}
          {rejected.length > 0 && (
            <DispositionGroup
              title="为什么不选这些方向"
              tone="rejected"
              items={rejected}
            />
          )}
        </div>
      )}
    </div>
  );
}

type DispositionGroupProps = {
  readonly title: string;
  readonly tone: "selected" | "rejected";
  readonly items: readonly DeepCandidateDisposition[];
};

function DispositionGroup(props: DispositionGroupProps): React.ReactElement {
  return (
    <div className={`deep-disposition-group deep-disposition-${props.tone}`}>
      <h4 className="deep-disposition-group-title">{props.title}</h4>
      <ul className="deep-disposition-list">
        {props.items.map((item) => (
          <li key={item.candidateId} className="deep-disposition-item">
            <span className="deep-disposition-label">{item.label}</span>
            <span className="deep-disposition-reason">{item.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 共享工具
// ---------------------------------------------------------------------------

function confidencePercent(value: number | undefined): string | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  const clamped = Math.max(0, Math.min(1, value));
  return `${Math.round(clamped * 100)}%`;
}

type RefChipsProps = {
  readonly refs: readonly string[];
};

function RefChips(props: RefChipsProps): React.ReactElement {
  return (
    <ul className="deep-ref-chips">
      {props.refs.map((ref) => (
        <li key={ref} className="deep-ref-chip">
          {ref}
        </li>
      ))}
    </ul>
  );
}

