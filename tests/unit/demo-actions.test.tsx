// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { DemoActions } from "../../src/components/demo-actions";
import type { DemoApiClient } from "../../src/lib/demo-client";

function stubClient(
  resetDemo: DemoApiClient["resetDemo"] = vi.fn(async () => ({
    seededCandidates: 10,
  })),
): DemoApiClient {
  return { resetDemo };
}

function renderPanel(props: Partial<Parameters<typeof DemoActions>[0]> = {}) {
  const handlers = {
    onUseDemoCandidate: vi.fn(),
    onReset: vi.fn(),
  };
  render(<DemoActions {...handlers} {...props} />);
  return handlers;
}

describe("DemoActions", () => {
  afterEach(cleanup);

  it("offers the one-click candidate jump and the rehearsal reset", () => {
    renderPanel({ client: stubClient() });

    expect(
      screen.getByRole("button", { name: "Use demo candidate" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reset demo data" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm reset" })).toBeNull();
  });

  it("jumps to the pinned walkthrough candidate on one click", () => {
    const { onUseDemoCandidate } = renderPanel({ client: stubClient() });

    fireEvent.click(screen.getByRole("button", { name: "Use demo candidate" }));

    expect(onUseDemoCandidate).toHaveBeenCalledTimes(1);
  });

  it("locks both controls while the workspace is busy", () => {
    renderPanel({ client: stubClient(), busy: true });

    expect(
      (
        screen.getByRole("button", {
          name: "Use demo candidate",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Reset demo data",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("requires explicit confirmation before calling the reset API", async () => {
    const resetDemo = vi.fn().mockResolvedValue({ seededCandidates: 10 });
    const { onReset } = renderPanel({ client: stubClient(resetDemo) });

    fireEvent.click(screen.getByRole("button", { name: "Reset demo data" }));

    expect(resetDemo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));

    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    expect(resetDemo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Confirm reset" })).toBeNull();
  });

  it("returns to the armed state when reset is cancelled", () => {
    renderPanel({ client: stubClient() });

    fireEvent.click(screen.getByRole("button", { name: "Reset demo data" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: "Reset demo data" }),
    ).toBeTruthy();
  });

  it("surfaces a reset failure as an alert and keeps the inbox", async () => {
    const resetDemo = vi.fn().mockRejectedValue(new Error("Reset refused."));
    const { onReset } = renderPanel({ client: stubClient(resetDemo) });

    fireEvent.click(screen.getByRole("button", { name: "Reset demo data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Reset refused.");
    expect(onReset).not.toHaveBeenCalled();
  });
});
