"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  FixtureConformanceResponse,
  StyleGuideResponse,
} from "@/domain/style-api";
import type { ConformanceFixtureFrameName } from "@/domain/style-tokens";

/**
 * The /style-guide inspector: brand tokens, the committed logo's
 * extracted palette, and per-fixture conformance results loaded from
 * the style API. Server-rendered guide data is the baseline; frame
 * conformance is fetched client-side so the API surface is exercised
 * end to end.
 */

type FrameState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: FixtureConformanceResponse };

type FrameStates = Record<ConformanceFixtureFrameName, FrameState>;

const frameOrder: ConformanceFixtureFrameName[] = [
  "conformant",
  "partial",
  "offbrand",
];

const frameLabels: Record<ConformanceFixtureFrameName, string> = {
  conformant: "Conformant clay frame",
  partial: "Partial frame",
  offbrand: "Off-brand frame",
};

const verdictClass: Record<string, string> = {
  CONFORMANT: "verdict-chip conformant",
  PARTIAL: "verdict-chip partial",
  OFF_BRAND: "verdict-chip offbrand",
};

const statusGlyph: Record<string, string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
};

function Swatch({ hex }: { hex: string }) {
  return <span className="swatch" style={{ background: hex }} />;
}

function loadingStates(): FrameStates {
  return Object.fromEntries(
    frameOrder.map((name) => [
      name,
      { status: "loading" } satisfies FrameState,
    ]),
  ) as FrameStates;
}

function FrameResult({ state }: { state: FrameState }) {
  if (state.status === "loading") {
    return <p className="frame-state">Checking conformance…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="frame-state error" role="alert">
        {state.message}
      </p>
    );
  }

  const { report } = state;
  return (
    <div className="frame-result">
      <img
        src={`/${report.path}`}
        alt={`${report.label} fixture frame`}
        width={report.width}
        height={report.height}
        loading="lazy"
      />
      <p className="verdict-line">
        <span className={verdictClass[report.conformance.verdict]}>
          {report.conformance.verdict}
        </span>{" "}
        <strong>{report.conformance.score}</strong>/100 ·{" "}
        <small>v{report.conformance.version}</small>
      </p>
      <div className="swatch-row" aria-label="Extracted frame palette">
        {report.palette.map((color) => (
          <span key={color.hex} className="swatch-cell">
            <Swatch hex={color.hex} />
            <small>{color.hex}</small>
            <small>{Math.round(color.weight * 100)}%</small>
          </span>
        ))}
      </div>
      <ul className="factor-list">
        {report.conformance.factors.map((factor) => (
          <li key={factor.key} className={`factor-row ${factor.status}`}>
            <span aria-hidden>{statusGlyph[factor.status]}</span>{" "}
            <strong>{factor.label}</strong> — {factor.measured}
            <small>{factor.explanation}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StyleGuideInspector({ guide }: { guide: StyleGuideResponse }) {
  const [frames, setFrames] = useState<FrameStates>(loadingStates);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadFrames() {
      const results = await Promise.all(
        frameOrder.map(async (name) => {
          try {
            const response = await fetch(
              `/api/style/conformance?frame=${name}`,
            );
            if (!response.ok) {
              const body = (await response.json()) as {
                error?: { message?: string };
              };
              return [
                name,
                {
                  status: "error",
                  message:
                    body.error?.message ??
                    `Conformance check failed (${response.status}).`,
                },
              ] as const;
            }
            return [
              name,
              { status: "ready", report: await response.json() },
            ] as const;
          } catch {
            return [
              name,
              { status: "error", message: "Network request failed." },
            ] as const;
          }
        }),
      );

      if (active) {
        setFrames(Object.fromEntries(results) as FrameStates);
      }
    }

    void loadFrames();
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const retryFrames = useCallback(() => {
    setFrames(loadingStates());
    setReloadToken((token) => token + 1);
  }, []);

  return (
    <div className="style-inspector">
      <header className="page-heading">
        <p className="eyebrow">Clay style subsystem</p>
        <h1>Style guide inspector</h1>
        <p className="lede">
          The committed brand tokens, the palette extracted from the committed
          logo fixture, and conformance results for the generated fixture frames
          — all computed by the same pure pixel functions the API serves.
        </p>
      </header>

      <section aria-labelledby="brand-tokens-heading">
        <h2 id="brand-tokens-heading">Brand tokens</h2>
        <p className="provenance">{guide.tokenSet.provenance}</p>
        <div className="token-grid">
          {guide.tokenSet.colors.map((token) => (
            <div key={token.key} className="token-card">
              <Swatch hex={token.hex} />
              <strong>{token.key}</strong>
              <code>{token.hex}</code>
              <small>{token.role}</small>
            </div>
          ))}
        </div>
        <ul className="quality-list">
          {guide.tokenSet.qualities.map((quality) => (
            <li key={quality.key}>
              <strong>{quality.label}</strong> — {quality.directive}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="logo-palette-heading">
        <h2 id="logo-palette-heading">Extracted logo palette</h2>
        <img
          className="logo-preview"
          src={`/${guide.logo.path}`}
          alt="Committed Yard Toonz logo fixture"
          width={160}
          height={160}
        />
        <div className="swatch-row" aria-label="Extracted logo palette">
          {guide.logo.palette.map((color) => (
            <span key={color.hex} className="swatch-cell">
              <Swatch hex={color.hex} />
              <small>{color.hex}</small>
              <small>{Math.round(color.weight * 100)}%</small>
            </span>
          ))}
        </div>
        <p className="verdict-line">
          <span className={verdictClass[guide.logo.conformance.verdict]}>
            {guide.logo.conformance.verdict}
          </span>{" "}
          <strong>{guide.logo.conformance.score}</strong>/100 ·{" "}
          <small>v{guide.logo.conformance.version}</small>
        </p>
      </section>

      <section aria-labelledby="prompt-contract-heading">
        <h2 id="prompt-contract-heading">Controlled prompt contract</h2>
        <dl className="prompt-contract">
          <div>
            <dt>Base style</dt>
            <dd>{guide.tokenSet.promptContract.baseStyle}</dd>
          </div>
          <div>
            <dt>Negative direction</dt>
            <dd>{guide.tokenSet.promptContract.negativeDirection}</dd>
          </div>
          <div>
            <dt>Output requirement</dt>
            <dd>{guide.tokenSet.promptContract.outputRequirement}</dd>
          </div>
          <div>
            <dt>Motion base</dt>
            <dd>{guide.tokenSet.promptContract.motionBase}</dd>
          </div>
          <div>
            <dt>Motion close</dt>
            <dd>{guide.tokenSet.promptContract.motionClose}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="fixture-frames-heading">
        <h2 id="fixture-frames-heading">Fixture frame conformance</h2>
        <button
          className="secondary-button"
          type="button"
          onClick={retryFrames}
        >
          Re-check fixtures
        </button>
        <div className="frame-grid">
          {frameOrder.map((name) => (
            <article key={name} className="frame-card">
              <h3>{frameLabels[name]}</h3>
              <FrameResult state={frames[name]} />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
