import Link from "next/link";

import { DiagnosticsDashboard } from "@/components/diagnostics-dashboard";

export const dynamic = "force-dynamic";

/**
 * Standalone /diagnostics operator page. The dashboard polls the read-only
 * snapshot API client-side so provider attribution, credential-gate states,
 * and request-ID timelines stay current across demo resets without a reload.
 */
export default function DiagnosticsPage() {
  return (
    <main className="workspace-main">
      <header className="page-heading">
        <p className="eyebrow">Provider subsystem</p>
        <h1>Provider diagnostics</h1>
        <p className="lede">
          Live view of provider selections, credential readiness, artifact
          attribution, and request-ID lineage. Credential values never leave
          the server — only their presence is reported.
        </p>
      </header>
      <DiagnosticsDashboard />
      <p>
        <Link href="/" className="back-button">
          Back to workspace
        </Link>
      </p>
    </main>
  );
}
