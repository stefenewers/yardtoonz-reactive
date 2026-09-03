import Link from "next/link";

import { StyleGuideInspector } from "@/components/style-guide-inspector";
import { getClayStyleService } from "@/server/style/service";

export const dynamic = "force-dynamic";

/**
 * Standalone /style-guide inspector page. Guide data is fetched
 * server-side so the brand tokens and logo palette render even before
 * the client-side conformance checks resolve; missing brand assets
 * surface an explicit recovery state instead of a broken page.
 */
export default async function StyleGuidePage() {
  const outcome = await getClayStyleService().getStyleGuide();
  if (!outcome.ok) {
    return (
      <main className="workspace-main">
        <header className="page-heading">
          <p className="eyebrow">Clay style subsystem</p>
          <h1>Style guide unavailable</h1>
          <p className="lede">{outcome.message}</p>
        </header>
        <p>
          <Link href="/" className="back-button">
            Back to workspace
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="workspace-main">
      <StyleGuideInspector guide={outcome.value} />
    </main>
  );
}
