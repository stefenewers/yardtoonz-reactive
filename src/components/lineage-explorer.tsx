"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildLineageChain,
  inspectArtifact,
  lineageExplorerUrl,
  lineageGraphState,
  lineageStateCopy,
  type LineageGraphState,
  type LineageNode,
} from "@/domain/lineage-explorer";
import { isJobActive } from "@/domain/job-output";
import { humanizeProvider } from "@/domain/inbox";
import { createApiProductionClient } from "@/lib/production-client";
import type { ProductionDetailResponse } from "@/shared/productions";

const pollIntervalMs = 3000;

export interface LineageExplorerProps {
  productionId: string;
  /** Deep-linked node: selected as soon as the production detail arrives. */
  initialArtifactId?: string;
  onBack?: () => void;
  backLabel?: string;
}

interface ExplorerSelection {
  readonly node: LineageNode;
  readonly metadata: ProductionDetailResponse["artifacts"][number]["metadata"];
}

function explorerUrlFor(
  productionId: string,
  artifactId: string | undefined,
): string {
  return lineageExplorerUrl(productionId, artifactId);
}

/**
 * The exploration view over one production's artifact lineage: the
 * source→final chain as an interactive graph, with a drill-in inspector
 * for every stored artifact (including superseded retries). Reads the same
 * polled snapshot the job monitor renders as a timeline — it explains the
 * lineage, it does not duplicate job progress. Deep links arrive as
 * `/lineage?production=…&artifact=…` and the URL re-syncs on every
 * selection so any inspected node stays shareable.
 */
export function LineageExplorer({
  productionId,
  initialArtifactId,
  onBack,
  backLabel = "← Job monitor",
}: LineageExplorerProps) {
  const client = useMemo(() => createApiProductionClient(), []);
  const [detail, setDetail] = useState<ProductionDetailResponse>();
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState<string>();
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialArtifactId,
  );

  const productionStatus = detail?.production.status;
  const statusRef = useRef(productionStatus);
  useEffect(() => {
    statusRef.current = productionStatus;
  }, [productionStatus]);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const fetched = await client.getDetail(productionId);
        if (!active) return;
        setDetail(fetched);
        setLoadState("idle");
        setLoadError(undefined);
      } catch (error) {
        if (!active) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "The lineage could not be loaded. Try again.",
        );
        setLoadState("error");
      }
    }

    void refresh();
    const interval = window.setInterval(() => {
      if (statusRef.current && !isJobActive(statusRef.current)) return;
      void refresh();
    }, pollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client, productionId, refreshToken]);

  const production = detail?.production;
  const graphState: LineageGraphState = lineageGraphState(
    production?.status ?? "QUEUED",
    detail?.artifacts ?? [],
  );
  const stages = useMemo(
    () => buildLineageChain(detail?.artifacts ?? []),
    [detail?.artifacts],
  );

  const selection: ExplorerSelection | undefined = useMemo(() => {
    const artifact = detail?.artifacts.find(
      (candidate) => candidate.id === selectedId,
    );
    if (!artifact || !production) return undefined;
    const node = stages
      .flatMap((stage) => stage.nodes)
      .find((candidate) => candidate.id === artifact.id);
    if (!node) return undefined;
    return { node, metadata: artifact.metadata };
  }, [detail?.artifacts, production, selectedId, stages]);

  // A deep-linked artifact absent from the loaded detail is a stale link,
  // not a selection of nothing — derived during render so any refresh that
  // removes the artifact flips the notice without an effect round-trip.
  const staleLink =
    loadState === "idle" &&
    selectedId !== undefined &&
    !(detail?.artifacts ?? []).some((artifact) => artifact.id === selectedId);

  function selectNode(node: LineageNode) {
    setSelectedId(node.id);
    const url = explorerUrlFor(productionId, node.id);
    try {
      window.history.replaceState(null, "", url);
    } catch {
      // History is unavailable in some embedded environments; selection
      // still works, only the shareable URL is lost.
    }
  }

  if (loadState === "loading") {
    return (
      <section className="lineage-explorer" aria-labelledby="lineage-title">
        <p className="processing-message" role="status">
          Loading the lineage explorer…
        </p>
      </section>
    );
  }

  if (loadState === "error" || !production) {
    return (
      <section className="lineage-explorer" aria-labelledby="lineage-title">
        <p className="eyebrow">Lineage explorer</p>
        <h1 id="lineage-title">Artifact lineage</h1>
        <div className="error-banner" role="alert">
          <div>
            <strong>The lineage could not be loaded</strong>
            <p>{loadError ?? "The production could not be loaded."}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoadState("loading");
              setRefreshToken((token) => token + 1);
            }}
          >
            Try again
          </button>
        </div>
        {onBack && (
          <button className="back-button" type="button" onClick={onBack}>
            {backLabel}
          </button>
        )}
      </section>
    );
  }

  const stateCopy = lineageStateCopy[graphState];

  return (
    <section className="lineage-explorer" aria-labelledby="lineage-title">
      <p className="eyebrow">Lineage explorer</p>
      <div className="job-heading">
        <h1 id="lineage-title">Artifact lineage</h1>
        <span className="rights-chip" role="status">
          <i aria-hidden="true" /> {production.status}
        </span>
      </div>
      <p className="lede">
        Every artifact stored by production <code>{production.id}</code>, in
        pipeline order. This view explains the chain — the job monitor stays the
        authority on stage progress.
      </p>

      <dl className="provider-strip" aria-label="Production providers">
        <div>
          <dt>Image provider</dt>
          <dd>{humanizeProvider(production.imageProvider)}</dd>
        </div>
        <div>
          <dt>Animation provider</dt>
          <dd>{humanizeProvider(production.animationProvider)}</dd>
        </div>
        <div>
          <dt>Artifacts</dt>
          <dd>{detail?.artifacts.length ?? 0} stored</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{production.status}</dd>
        </div>
      </dl>

      <div
        className={`lineage-state-banner lineage-state-banner--${graphState}`}
        role="status"
        aria-label={`Lineage state: ${stateCopy.heading}`}
      >
        <strong>{stateCopy.heading}</strong>
        <p>{stateCopy.detail}</p>
      </div>

      {staleLink && (
        <div className="error-banner" role="alert">
          <div>
            <strong>The linked artifact is gone</strong>
            <p>
              The deep link names an artifact this production no longer stores.
              Pick any node below to inspect what exists now.
            </p>
          </div>
        </div>
      )}

      {stages.length === 0 ? (
        <p className="empty-state" role="status">
          No artifacts have been stored for this production yet.
        </p>
      ) : (
        <ol
          className="lineage-chain"
          aria-label="Interactive lineage chain from source to final video"
        >
          {stages.map((stage) => (
            <li key={stage.label} className="lineage-stage">
              <h3 className="lineage-stage-label">{stage.label}</h3>
              <ul className="lineage-nodes">
                {stage.nodes.map((node) => {
                  const isSelected = node.id === selectedId;
                  return (
                    <li key={node.id} className="lineage-node-item">
                      <button
                        type="button"
                        className={`lineage-node lineage-node--${node.state}${isSelected ? " lineage-node--selected" : ""}`}
                        onClick={() => selectNode(node)}
                        aria-pressed={isSelected}
                      >
                        <strong>{node.label}</strong>
                        <small>
                          {node.providerLabel} · {node.sizeLabel}
                          {node.clockLabel ? ` · ${node.clockLabel}` : ""}
                        </small>
                        {node.state === "superseded" && (
                          <em className="lineage-node-flag">Superseded</em>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {selection ? (
        <section
          className="inspector-panel"
          aria-label={`Artifact inspector: ${selection.node.label}`}
          aria-live="polite"
        >
          <header className="inspector-header">
            <h2>{selection.node.label}</h2>
            <div className="action-row">
              <a
                className="secondary-button"
                href={client.artifactUrl(production.id, selection.node.id)}
                target="_blank"
                rel="noreferrer"
              >
                Open raw
              </a>
              <a
                className="secondary-button"
                href={client.artifactUrl(
                  production.id,
                  selection.node.id,
                  true,
                )}
                data-testid="inspector-download"
              >
                Download
              </a>
            </div>
          </header>

          {selection.node.previewKind === "image" && (
            <img
              className="inspector-preview"
              src={client.artifactUrl(production.id, selection.node.id)}
              alt={`${selection.node.label} preview`}
            />
          )}
          {selection.node.previewKind === "video" && (
            <video
              className="inspector-preview"
              src={client.artifactUrl(production.id, selection.node.id)}
              controls
              muted
              playsInline
              preload="metadata"
              aria-label={`${selection.node.label} preview`}
            />
          )}
          {selection.node.previewKind === "audio" && (
            <audio
              controls
              src={client.artifactUrl(production.id, selection.node.id)}
              aria-label={`${selection.node.label} preview`}
            />
          )}
          {selection.node.previewKind === "none" && (
            <p className="inspector-no-preview">
              No inline preview for this media type.
            </p>
          )}

          <dl className="facts-grid" aria-label="Artifact facts">
            {inspectArtifact(selection.node, selection.metadata).map(
              (field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd className={field.mono ? "inspector-mono" : undefined}>
                    {field.value}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </section>
      ) : (
        <p className="empty-state" role="status">
          Select a node in the chain to inspect its facts, checksum, and
          preview.
        </p>
      )}

      <div className="action-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setRefreshToken((token) => token + 1)}
        >
          Refresh lineage
        </button>
        {onBack && (
          <button type="button" className="back-button" onClick={onBack}>
            {backLabel}
          </button>
        )}
      </div>
    </section>
  );
}
