"use client";

import { useMemo, useState } from "react";

import { createApiManualIntakeClient } from "@/lib/manual-intake-client";
import type { ManualIntakeApiClient } from "@/lib/manual-intake-client";
import { sourcePlatforms } from "@/shared/candidates";
import type { ManualCandidateIntake } from "@/shared/candidate-intake";

export interface ManualIntakeActionProps {
  /**
   * Called after a pasted-URL candidate imports so the workspace can
   * refresh the inbox without a manual reload.
   */
  onImported?: (candidateIds: readonly string[]) => void;
  client?: ManualIntakeApiClient;
}

/**
 * Inbox header action for manual intake: the operator pastes a social post
 * URL as a source reference. Nothing is fetched from the platform — the URL
 * is stored verbatim next to hand-supplied editorial context.
 */
export function ManualIntakeAction({
  onImported,
  client,
}: ManualIntakeActionProps) {
  const fallbackClient = useMemo(() => createApiManualIntakeClient(), []);
  const intakeClient = client ?? fallbackClient;
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<string>(sourcePlatforms[0]);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  function toggleOpen() {
    setOpen((value) => !value);
    setError(undefined);
  }

  function resetForm() {
    setPlatform(sourcePlatforms[0]);
    setUrl("");
    setCaption("");
    setError(undefined);
  }

  async function submitPastedUrl() {
    const trimmedUrl = url.trim();
    const trimmedCaption = caption.trim();
    if (trimmedUrl === "" || trimmedCaption === "") {
      setError("Paste the post URL and add a caption before importing.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const candidate: ManualCandidateIntake = {
        url: trimmedUrl,
        platform: platform as ManualCandidateIntake["platform"],
        caption: trimmedCaption,
      };
      const result = await intakeClient.importManualCandidate(candidate);
      resetForm();
      setOpen(false);
      onImported?.(result.candidateIds);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The paste import failed. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="scout-action manual-intake">
      <button
        className="secondary-button manual-intake-toggle"
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        {open ? "Close paste intake" : "Paste social URL"}
      </button>
      {open && (
        <form
          className="manual-intake-panel"
          aria-label="Paste a social post URL as a source reference"
          onSubmit={(event) => {
            event.preventDefault();
            void submitPastedUrl();
          }}
        >
          <p className="manual-intake-hint">
            Stored as a source reference — nothing is fetched from the platform.
          </p>
          <label className="manual-intake-field">
            Platform
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
            >
              {sourcePlatforms.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="manual-intake-field">
            Post URL
            <input
              type="url"
              inputMode="url"
              placeholder="https://www.tiktok.com/@creator/video/123"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
          </label>
          <label className="manual-intake-field">
            Caption
            <textarea
              rows={2}
              placeholder="What is the clip about?"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              required
            />
          </label>
          {error && (
            <span className="manual-intake-error" role="alert">
              {error}
            </span>
          )}
          <button
            className="secondary-button manual-intake-submit"
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? "Importing…" : "Import candidate"}
          </button>
        </form>
      )}
    </div>
  );
}
