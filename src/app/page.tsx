import { env } from "@/lib/env";
import { getMediaToolHealth } from "@/lib/media-tools";

export const dynamic = "force-dynamic";

export default async function Home() {
  const mediaTools = await getMediaToolHealth();

  return (
    <main>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Foundation status</p>
        <h1 id="page-title">YardToonz Reactive</h1>
        <p className="summary">
          The credential-free creator workflow foundation is ready for reviewed
          product features.
        </p>
        <dl className="status-grid">
          <div>
            <dt>Provider mode</dt>
            <dd>{env.PROVIDER_MODE}</dd>
          </div>
          {mediaTools.map((tool) => (
            <div key={tool.name}>
              <dt>{tool.name}</dt>
              <dd>{tool.available ? "Available" : "Unavailable"}</dd>
            </div>
          ))}
        </dl>
        <p className="notice">
          Human approval and rights confirmation remain required before any
          media processing.
        </p>
      </section>
    </main>
  );
}
