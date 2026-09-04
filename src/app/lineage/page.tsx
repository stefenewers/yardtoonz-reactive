import { LineageExplorer } from "@/components/lineage-explorer";

export const dynamic = "force-dynamic";

interface LineagePageProps {
  searchParams: Promise<{ production?: string; artifact?: string }>;
}

/**
 * The deep-linkable lineage explorer. Any node inspection rewrites the
 * URL in place (`?production=…&artifact=…`), so a link taken from the job
 * timeline — or copied after drilling in — restores the same view.
 */
export default async function LineagePage({ searchParams }: LineagePageProps) {
  const { production, artifact } = await searchParams;

  if (!production) {
    return (
      <section className="lineage-explorer" aria-labelledby="lineage-title">
        <p className="eyebrow">Lineage explorer</p>
        <h1 id="lineage-title">Artifact lineage</h1>
        <p className="empty-state" role="status">
          Open the lineage from a production job monitor, or add{" "}
          <code>?production=&lt;id&gt;</code> to this URL.
        </p>
      </section>
    );
  }

  return (
    <LineageExplorer productionId={production} initialArtifactId={artifact} />
  );
}
