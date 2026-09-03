// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { ScoutHeaderAction } from "../../src/components/scout-header-action";
import type { ScoutApiClient } from "../../src/lib/scout-client";
import type { FeedRunResource } from "../../src/shared/trend-scout";

const completeRun: FeedRunResource = {
  id: "run_component_1",
  themes: ["STREET_AND_DANCEHALL"],
  status: "COMPLETE",
  discoveredCount: 12,
  duplicateCount: 2,
  importedCount: 10,
  importedCandidateIds: ["cand_scout_a", "cand_scout_b"],
  startedAt: "2026-09-03T06:00:00.000Z",
  completedAt: "2026-09-03T06:01:00.000Z",
};

type RunScoutMock = ReturnType<typeof vi.fn>;
type StubClient = ScoutApiClient & {
  runScout: RunScoutMock;
  fetchLatestRun: RunScoutMock;
};

function stubClient(overrides: Partial<ScoutApiClient> = {}): StubClient {
  return {
    runScout: vi.fn(async () => completeRun),
    listRuns: vi.fn(async () => [completeRun]),
    fetchLatestRun: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as StubClient;
}

afterEach(cleanup);

describe("ScoutHeaderAction", () => {
  it("shows a calm empty state before the first run", async () => {
    const client = stubClient();
    render(<ScoutHeaderAction client={client} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Checking last scout run…",
    );
    expect(
      await screen.findByText("No scout runs yet", { exact: false }),
    ).toBeTruthy();
    expect(client.fetchLatestRun).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("button", { name: "Run Scout" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("reports the persisted last-run status with counts", async () => {
    const client = stubClient({ fetchLatestRun: async () => completeRun });
    render(<ScoutHeaderAction client={client} />);
    const status = await screen.findByText(/Complete ·/, { exact: false });
    expect(status.textContent).toContain(
      "12 discovered · 10 imported · 2 duplicates",
    );
  });

  it("runs the scout, refreshes the status, and pings the workspace on imports", async () => {
    const client = stubClient();
    const onImported = vi.fn();
    render(<ScoutHeaderAction client={client} onImported={onImported} />);

    fireEvent.click(await screen.findByRole("button", { name: "Run Scout" }));
    expect(client.runScout).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Complete ·/, { exact: false }),
    ).toBeTruthy();
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledWith(completeRun);
  });

  it("does not refresh the inbox when a run imports nothing new", async () => {
    const client = stubClient({
      runScout: async () => ({
        ...completeRun,
        importedCount: 0,
        importedCandidateIds: [],
      }),
    });
    const onImported = vi.fn();
    render(<ScoutHeaderAction client={client} onImported={onImported} />);
    fireEvent.click(await screen.findByRole("button", { name: "Run Scout" }));
    await screen.findByText(/Complete ·/, { exact: false });
    expect(onImported).not.toHaveBeenCalled();
  });

  it("disables the button and shows progress while a run is in flight", async () => {
    let releaseRun: ((run: FeedRunResource) => void) | undefined;
    const client = stubClient({
      runScout: () =>
        new Promise<FeedRunResource>((resolve) => {
          releaseRun = resolve;
        }),
    });
    render(<ScoutHeaderAction client={client} />);
    const button = await screen.findByRole("button", { name: "Run Scout" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Scouting/ })).toHaveProperty(
        "disabled",
        true,
      );
    });
    releaseRun!(completeRun);
    await screen.findByText(/Complete ·/, { exact: false });
    expect(
      screen
        .getByRole("button", { name: "Run Scout" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("surfaces a failed run status from the persisted resource", async () => {
    const client = stubClient({
      fetchLatestRun: async () => ({
        ...completeRun,
        status: "FAILED",
        errorCode: "PROVIDER_INVALID_FEED",
        safeErrorMessage: "The MARKET_AND_HUSTLE feed returned bad data.",
        importedCount: 0,
        importedCandidateIds: [],
      }),
    });
    render(<ScoutHeaderAction client={client} />);
    expect(await screen.findByText(/Failed ·/, { exact: false })).toBeTruthy();
    expect(document.querySelector(".scout-status--failed")).not.toBeNull();
  });

  it("shows a retryable error when the run request fails", async () => {
    const client = stubClient({
      runScout: async () => {
        throw new Error("A scout run is already in progress.");
      },
    });
    render(<ScoutHeaderAction client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Run Scout" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "A scout run is already in progress.",
    );
    // The button recovers so the editor can try again.
    expect(
      screen
        .getByRole("button", { name: "Run Scout" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("surfaces a status-load failure without blocking the run button", async () => {
    const client = stubClient({
      fetchLatestRun: async () => {
        throw new Error("offline");
      },
    });
    render(<ScoutHeaderAction client={client} />);
    expect(
      await screen.findByText(/could not be loaded/, { exact: false }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Run Scout" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
