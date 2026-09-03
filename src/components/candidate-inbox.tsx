"use client";

import type { Candidate } from "@/domain/candidate";
import {
  formatMetric,
  scoreLabel,
  type ScoreEvidence,
} from "@/domain/candidate";
import {
  formatSourceAge,
  nextSortState,
  overallWeightingSummary,
  platformLabels,
  sortDescription,
  type InboxSortState,
} from "@/domain/inbox";

export interface CandidateInboxProps {
  candidates: Candidate[];
  loading: boolean;
  /** Retryable inbox error; existing rows stay visible while it shows. */
  error?: string;
  sort: InboxSortState;
  /** Injectable clock keeps source-age rendering deterministic in tests. */
  nowMs?: number;
  onSortChange: (next: InboxSortState) => void;
  onRetry: () => void;
  onLoadDemo: () => void;
  onOpenCandidate: (candidate: Candidate) => void;
}

const statusLabels: Record<Candidate["status"], string> = {
  NEW: "New",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const metricColumns: {
  key: keyof Candidate["metrics"];
  label: string;
}[] = [
  { key: "views", label: "Views" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "saves", label: "Saves" },
];

const sortableColumns = [
  { field: "viralMomentum", label: "Viral momentum" },
  { field: "humorResponse", label: "Humor response" },
  { field: "yardToonzFit", label: "Yard Toonz fit" },
  { field: "overall", label: "Overall" },
] as const;

const skeletonRowCount = 4;
const columnCount = 3 + metricColumns.length + sortableColumns.length + 1;

function ScoreCell({
  evidence,
  overall = false,
}: {
  evidence: ScoreEvidence;
  overall?: boolean;
}) {
  return (
    <td
      className={`score-cell${overall ? " score-cell--overall" : ""}`}
      title={evidence.explanation}
    >
      <span className="score-value">{evidence.score}</span>
      <span className="score-name">{scoreLabel(evidence.score)}</span>
      <span className="sr-only">Score explanation: {evidence.explanation}</span>
    </td>
  );
}

function SortHeader({
  column,
  sort,
  onSortChange,
}: {
  column: (typeof sortableColumns)[number];
  sort: InboxSortState;
  onSortChange: CandidateInboxProps["onSortChange"];
}) {
  const active = sort.field === column.field;
  return (
    <th
      scope="col"
      className="num"
      aria-sort={
        active ? (sort.order === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        className="sort-button"
        onClick={() => onSortChange(nextSortState(column.field, sort))}
      >
        {column.label}
        <span className="sort-arrow" aria-hidden="true">
          {active ? (sort.order === "asc" ? "▲" : "▼") : "↕"}
        </span>
        <span className="sr-only">
          {active
            ? sort.order === "asc"
              ? ", ascending, activate for descending"
              : ", descending, activate for ascending"
            : ", activate to sort highest first"}
        </span>
      </button>
    </th>
  );
}

function TableHeader({
  sort,
  onSortChange,
}: Pick<CandidateInboxProps, "sort" | "onSortChange">) {
  return (
    <thead>
      <tr>
        <th scope="col" className="rank-col">
          #
        </th>
        <th scope="col">Source</th>
        <th scope="col">Age</th>
        {metricColumns.map(({ key, label }) => (
          <th key={key} scope="col" className="num">
            {label}
          </th>
        ))}
        {sortableColumns.map((column) => (
          <SortHeader
            key={column.field}
            column={column}
            sort={sort}
            onSortChange={onSortChange}
          />
        ))}
        <th scope="col">Status</th>
      </tr>
    </thead>
  );
}

function CandidateRow({
  candidate,
  rank,
  nowMs,
  overallExplanation,
  onOpenCandidate,
}: {
  candidate: Candidate;
  rank: number;
  nowMs: number | undefined;
  overallExplanation: string;
  onOpenCandidate: CandidateInboxProps["onOpenCandidate"];
}) {
  const overallEvidence: ScoreEvidence = {
    score: candidate.scores.overall,
    explanation: overallExplanation,
    inputsUsed: [],
  };

  return (
    <tr className="candidate-row">
      <td className="rank-cell">#{rank}</td>
      <td className="source-cell">
        <span className="thumbnail" aria-hidden="true">
          {platformLabels[candidate.platform].slice(0, 2)}
        </span>
        <span className="source-copy">
          <small>
            {platformLabels[candidate.platform]} · {candidate.sourceLabel}
          </small>
          <button
            type="button"
            className="caption-button"
            onClick={() => onOpenCandidate(candidate)}
          >
            {candidate.caption}
          </button>
        </span>
      </td>
      <td className="age-cell" suppressHydrationWarning>
        {formatSourceAge(candidate.publishedAt, nowMs)}
      </td>
      {metricColumns.map(({ key }) => {
        const value = candidate.metrics[key];
        return (
          <td
            key={key}
            className={`num metric-cell${
              value === undefined ? " metric-cell--missing" : ""
            }`}
          >
            {formatMetric(value)}
          </td>
        );
      })}
      <ScoreCell evidence={candidate.scores.viralMomentum} />
      <ScoreCell evidence={candidate.scores.humorResponse} />
      <ScoreCell evidence={candidate.scores.yardToonzFit} />
      <ScoreCell evidence={overallEvidence} overall />
      <td>
        <span className={`status status--${candidate.status.toLowerCase()}`}>
          {statusLabels[candidate.status]}
        </span>
      </td>
    </tr>
  );
}

export function CandidateInbox({
  candidates,
  loading,
  error,
  sort,
  nowMs,
  onSortChange,
  onRetry,
  onLoadDemo,
  onOpenCandidate,
}: CandidateInboxProps) {
  const overallExplanation = overallWeightingSummary();
  const showSkeleton = loading && candidates.length === 0;
  const showErrorOnly = !loading && error && candidates.length === 0;
  const showEmptyState = !loading && !error && candidates.length === 0;

  return (
    <>
      {error && (
        <div className="error-banner" role="alert">
          <div>
            <strong>Candidates could not be refreshed</strong>
            <p>{error}</p>
            {candidates.length > 0 && (
              <p>The list below still shows the last successful load.</p>
            )}
          </div>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {showErrorOnly ? null : showSkeleton ? (
        <div
          className="table-scroll"
          aria-label="Loading candidates"
          aria-busy="true"
        >
          <table className="candidate-table">
            <caption className="sr-only">Loading candidates</caption>
            <TableHeader sort={sort} onSortChange={onSortChange} />
            <tbody>
              {Array.from({ length: skeletonRowCount }, (_, row) => (
                <tr key={row}>
                  {Array.from({ length: columnCount }, (_, cell) => (
                    <td key={cell}>
                      <span className="skeleton-bar" aria-hidden="true" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : showEmptyState ? (
        <div className="empty-state">
          <span className="empty-sticker">10</span>
          <h2>Your desk is clear</h2>
          <p>
            Load the deterministic demo set to review ten ranked moments.
            Nothing is imported from social platforms.
          </p>
          <button className="primary-button" type="button" onClick={onLoadDemo}>
            Load demo candidates
          </button>
        </div>
      ) : (
        <>
          <div className="list-toolbar">
            <p aria-live="polite">
              <strong>{candidates.length} candidates</strong> ·{" "}
              {sortDescription(sort)}
            </p>
            <p className="weighting-note">{overallExplanation}</p>
          </div>
          <div className="table-scroll">
            <table className="candidate-table" aria-busy={loading}>
              <caption className="sr-only">
                Candidates ranked for review. {overallExplanation}
              </caption>
              <TableHeader sort={sort} onSortChange={onSortChange} />
              <tbody>
                {candidates.map((candidate, index) => (
                  <CandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    rank={index + 1}
                    nowMs={nowMs}
                    overallExplanation={overallExplanation}
                    onOpenCandidate={onOpenCandidate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
