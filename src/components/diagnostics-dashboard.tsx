"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildAttributionAudit,
  buildCredentialGateStates,
  buildProviderStatusCards,
  buildRequestIdTimeline,
  type AttributionAudit,
  type CredentialGateState,
  type ProviderStatusCard,
  type RequestIdEvent,
} from "@/domain/diagnostics";
import {
  createApiDiagnosticsClient,
  DiagnosticsApiError,
  type DiagnosticsApiClient,
} from "@/lib/diagnostics-client";
import type { DiagnosticsJob } from "@/shared/diagnostics";

export type DiagnosticsView =
  | { kind: "loading" }
  | { kind: "error"; code: string; message: string }
  | {
      kind: "ready";
      gates: CredentialGateState[];
      cards: ProviderStatusCard[];
      audit: AttributionAudit;
      jobs: DiagnosticsJob[];
    };

export const DIAGNOSTICS_POLL_INTERVAL_MS = 10_000;

/** Pure state derivation for the dashboard — keeps useEffect logic minimal. */
export function deriveDiagnosticsView(
  jobs: DiagnosticsJob[],
  environment: Parameters<typeof buildCredentialGateStates>[0],
): Extract<DiagnosticsView, { kind: "ready" }> {
  return {
    kind: "ready",
    gates: buildCredentialGateStates(environment),
    cards: buildProviderStatusCards(jobs, environment),
    audit: buildAttributionAudit(jobs),
    jobs,
  };
}

interface DiagnosticsDashboardProps {
  client?: DiagnosticsApiClient;
  pollIntervalMs?: number;
}

const errorCopy: Record<string, string> = {
  DIAGNOSTICS_UNAVAILABLE:
    "The diagnostics service is unreachable right now. It will retry automatically.",
  DIAGNOSTICS_REQUEST_FAILED:
    "The diagnostics service rejected the request. It will retry automatically.",
  INVALID_DIAGNOSTICS_RESPONSE:
    "The diagnostics service returned an unreadable response. It will retry automatically.",
};

function errorExplanation(code: string): string {
  return (
    errorCopy[code] ??
    "The diagnostics service reported an unexpected problem. It will retry automatically."
  );
}

/**
 * Read-only diagnostics dashboard: provider status cards, the credential
 * fail-fast explainer, the attribution audit, and per-job request-ID
 * timelines. Polls so demo resets are reflected without a reload; every
 * state (loading/error/ready-empty/ready) is reachable and tested.
 */
export function DiagnosticsDashboard({
  client = createApiDiagnosticsClient(),
  pollIntervalMs = DIAGNOSTICS_POLL_INTERVAL_MS,
}: DiagnosticsDashboardProps) {
  const [view, setView] = useState<DiagnosticsView>({ kind: "loading" });
  const [refreshedAt, setRefreshedAt] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const snapshot = await client.getSnapshot();
        if (!active) return;
        setView(deriveDiagnosticsView(snapshot.jobs, snapshot.environment));
        setRefreshedAt(new Date().toISOString());
      } catch (error) {
        if (!active) return;
        const code =
          error instanceof DiagnosticsApiError ? error.code : "UNKNOWN_ERROR";
        setView({ kind: "error", code, message: errorExplanation(code) });
      }
    }

    void refresh();
    if (pollIntervalMs <= 0) return;
    const interval = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client, pollIntervalMs]);

  return (
    <section
      aria-label="Provider diagnostics"
      aria-busy={view.kind === "loading"}
    >
      {view.kind === "loading" ? (
        <p role="status">Loading provider diagnostics…</p>
      ) : view.kind === "error" ? (
        <div
          className="error-banner"
          role="alert"
          data-testid="diagnostics-error"
        >
          {view.message}
        </div>
      ) : (
        <>
          <p
            className="diagnostics-refresh"
            data-testid="diagnostics-refreshed"
          >
            {refreshedAt
              ? `Refreshed ${new Date(refreshedAt).toLocaleTimeString()}`
              : "Awaiting first refresh"}
          </p>

          <h2 className="visually-hidden-title">Credential fail-fast gates</h2>
          <p className="diagnostics-note">
            Live provider selections fail fast at job creation when a required
            credential setting is missing. Setting names are shown; values never
            leave the server.
          </p>
          <div className="diagnostics-gate-grid">
            {view.gates.map((gate) => (
              <article
                key={gate.family}
                className="diagnostics-gate"
                data-testid={`diagnostics-gate-${gate.family}`}
                data-outcome={gate.outcome}
              >
                <p className="eyebrow">{gate.familyLabel}</p>
                <h3 className="diagnostics-gate-provider">
                  {gate.selectedLabel}
                </h3>
                <p
                  className={`diagnostics-outcome diagnostics-outcome--${
                    gate.outcome === "READY"
                      ? "ready"
                      : gate.outcome === "FAILS_FAST"
                        ? "blocked"
                        : "free"
                  }`}
                >
                  {gate.outcomeLabel}
                </p>
                {gate.isLive ? (
                  <ul className="diagnostics-setting-list">
                    {gate.requiredSettings.map((setting) => {
                      const present = gate.presentSettings.includes(setting);
                      return (
                        <li
                          key={setting}
                          className={
                            present
                              ? "diagnostics-setting--present"
                              : "diagnostics-setting--missing"
                          }
                        >
                          {present ? "✓" : "✗"} <code>{setting}</code>{" "}
                          {present ? "present" : "missing"}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p>
                    Mock selection — no credentials are consulted and the
                    pipeline stays fully local.
                  </p>
                )}
              </article>
            ))}
          </div>

          <h2 className="visually-hidden-title">Provider status</h2>
          {view.cards.length === 0 ? (
            <p className="empty-state">
              No productions yet. Create one from the workspace to see provider
              status, attribution, and request-ID timelines here.
            </p>
          ) : (
            <div className="diagnostics-card-grid">
              {view.cards.map((card) => (
                <article
                  key={card.productionId}
                  className="diagnostics-card"
                  data-testid={`diagnostics-card-${card.productionId}`}
                >
                  <p className="eyebrow">Production {card.productionId}</p>
                  <h3 className="diagnostics-card-status">
                    {card.imageProviderLabel} · {card.animationProviderLabel}
                  </h3>
                  <p>
                    Status {card.status} · attempt {card.attempt}
                  </p>
                  <p>
                    {card.artifactCount} artifacts — {card.liveAttributedCount}{" "}
                    attributed, {card.localCount} local,{" "}
                    {card.unattributedLiveCount} unattributed
                  </p>
                  {card.environmentStillServable ? null : (
                    <p className="diagnostics-warning">
                      Persisted selection can no longer be served: credentials
                      were removed after creation.
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}

          <h2 className="visually-hidden-title">Provider attribution audit</h2>
          <p className="diagnostics-note">
            {view.audit.complete
              ? `All ${view.audit.totals.liveAttributed} live-produced artifacts carry a provider request ID.`
              : `${view.audit.totals.unattributedLive} live-produced artifacts are missing a provider request ID.`}
          </p>
          {view.audit.rows.length === 0 ? (
            <p
              className="empty-state"
              data-testid="diagnostics-attribution-empty"
            >
              No artifacts recorded yet — attribution appears as productions
              produce media.
            </p>
          ) : (
            <table className="diagnostics-audit-table">
              <caption className="visually-hidden-title">
                Every artifact with its producing provider and request ID
              </caption>
              <thead>
                <tr>
                  <th scope="col">Artifact</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Request ID</th>
                  <th scope="col">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {view.audit.rows.map((row) => (
                  <tr key={`${row.productionId}:${row.artifactId}`}>
                    <td>{row.artifactId}</td>
                    <td>{row.kindLabel}</td>
                    <td>{row.providerLabel}</td>
                    <td>
                      {row.providerRequestId ?? (
                        <span className="diagnostics-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`diagnostics-verdict diagnostics-verdict--${
                          row.verdict === "LIVE_ATTRIBUTED"
                            ? "attributed"
                            : row.verdict === "LOCAL"
                              ? "local"
                              : "missing"
                        }`}
                      >
                        {row.verdictLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 className="visually-hidden-title">Request-ID timelines</h2>
          {view.jobs.map((job) => (
            <RequestTimeline key={job.id} job={job} />
          ))}
        </>
      )}
    </section>
  );
}

function RequestTimeline({ job }: { job: DiagnosticsJob }) {
  const events: readonly RequestIdEvent[] = useMemo(
    () => buildRequestIdTimeline(job),
    [job],
  );

  return (
    <details
      className="diagnostics-timeline"
      data-testid={`diagnostics-timeline-${job.id}`}
    >
      <summary>Request-ID timeline · production {job.id}</summary>
      {events.length === 0 ? (
        <p className="empty-state">No observed provider events yet.</p>
      ) : (
        <ol>
          {events.map((event, index) => (
            <li key={`${event.at}:${event.source}:${index}`}>
              {new Date(event.at).toLocaleTimeString()} — {event.sourceLabel}{" "}
              {event.detailLabel} · {event.providerLabel}
              {event.providerRequestId ? (
                <>
                  {" "}
                  · request <code>{event.providerRequestId}</code>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
