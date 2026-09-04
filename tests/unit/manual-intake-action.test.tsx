// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { ManualIntakeAction } from "../../src/components/manual-intake-action";
import type { ManualIntakeApiClient } from "../../src/lib/manual-intake-client";

function stubClient(
  importManualCandidate: ManualIntakeApiClient["importManualCandidate"] = vi.fn(
    async () => ({
      providerKind: "MANUAL",
      imported: 1,
      candidateIds: ["cand_pasted-1"],
    }),
  ),
): ManualIntakeApiClient {
  return { importManualCandidate };
}

function openPanel(
  props: Partial<Parameters<typeof ManualIntakeAction>[0]> = {},
) {
  const handlers = { onImported: vi.fn() };
  render(<ManualIntakeAction {...handlers} {...props} />);
  return handlers;
}

describe("ManualIntakeAction", () => {
  afterEach(cleanup);

  it("keeps the paste panel closed until the operator opens it", () => {
    openPanel({ client: stubClient() });

    expect(
      screen.getByRole("button", { name: "Paste social URL" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("form", {
        name: /paste a social post url/i,
      }),
    ).toBeNull();
  });

  it("imports a pasted social URL as a source reference without fetching anything", async () => {
    const importManualCandidate = vi.fn(async () => ({
      providerKind: "MANUAL",
      imported: 1,
      candidateIds: ["cand_x"],
    }));
    const { onImported } = openPanel({
      client: stubClient(importManualCandidate),
    });

    fireEvent.click(screen.getByRole("button", { name: "Paste social URL" }));
    fireEvent.change(screen.getByLabelText("Platform"), {
      target: { value: "TIKTOK" },
    });
    fireEvent.change(screen.getByLabelText("Post URL"), {
      target: { value: "https://www.tiktok.com/@vendor/video/735123" },
    });
    fireEvent.change(screen.getByLabelText("Caption"), {
      target: { value: "Vendor change, full committee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import candidate" }));

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith(["cand_x"]);
    });
    expect(importManualCandidate).toHaveBeenCalledWith({
      url: "https://www.tiktok.com/@vendor/video/735123",
      platform: "TIKTOK",
      caption: "Vendor change, full committee",
    });
    // The panel closes and the form resets after a successful import.
    expect(
      screen.queryByRole("form", { name: /paste a social post url/i }),
    ).toBeNull();
  });

  it("surfaces intake failures inline instead of refreshing the inbox", async () => {
    const importManualCandidate = vi.fn(async () => {
      throw new Error("pasted url: only http(s) links are accepted");
    });
    const { onImported } = openPanel({
      client: stubClient(importManualCandidate),
    });

    fireEvent.click(screen.getByRole("button", { name: "Paste social URL" }));
    fireEvent.change(screen.getByLabelText("Post URL"), {
      target: { value: "ftp://example.com/clip.mp4" },
    });
    fireEvent.change(screen.getByLabelText("Caption"), {
      target: { value: "Not an http link" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import candidate" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /only http\(s\) links/i,
      );
    });
    expect(onImported).not.toHaveBeenCalled();
    // The panel stays open so the operator can correct the paste.
    expect(
      screen.getByRole("form", { name: /paste a social post url/i }),
    ).toBeTruthy();
  });

  it("requires both the URL and a caption before submitting", () => {
    const importManualCandidate = vi.fn();
    openPanel({ client: stubClient(importManualCandidate) });

    fireEvent.click(screen.getByRole("button", { name: "Paste social URL" }));
    fireEvent.change(screen.getByLabelText("Caption"), {
      target: { value: "Caption without a URL" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import candidate" }));

    // Native constraint validation (required + type=url) blocks the submit
    // before the intake client is ever invoked.
    expect(importManualCandidate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("form", { name: /paste a social post url/i }),
    ).toBeTruthy();
  });
});
