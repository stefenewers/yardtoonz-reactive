// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { ProductionSetup } from "../../src/components/production-setup";

const ISO = "2026-09-03T12:00:00.000Z";
const SHA = "a".repeat(64);
const STAGE_NAMES = [
  "INGEST_SOURCE",
  "EXTRACT_MEDIA",
  "SELECT_KEYFRAME",
  "STYLE_IMAGE",
  "ANIMATE_IMAGE",
  "MUX_AND_NORMALIZE",
  "VALIDATE_OUTPUT",
] as const;

function makeProduction(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "prod-e51",
    candidateId: "cand-e51",
    status: "DRAFT",
    imageProvider: "MOCK",
    animationProvider: "MOCK",
    segment: { startSeconds: 0, endSeconds: 6, durationSeconds: 6 },
    attempt: 1,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function makeDetail(
  options: {
    production?: Record<string, unknown>;
    withSource?: boolean;
    queued?: boolean;
  } = {},
): Record<string, unknown> {
  const status = options.queued ? "QUEUED" : "RIGHTS_CONFIRMED";
  return {
    production: makeProduction({
      status,
      ...options.production,
    }),
    stages:
      status === "QUEUED"
        ? STAGE_NAMES.map((name, index) => ({
            id: `prod-e51-${name}`,
            name,
            status: index === 0 ? "COMPLETE" : "WAITING",
            attempt: 1,
          }))
        : [],
    artifacts: options.withSource
      ? [
          {
            id: "prod-e51-source",
            kind: "SOURCE_VIDEO",
            provider: "USER_UPLOAD",
            mimeType: "video/mp4",
            byteSize: 2048,
            sha256: SHA,
            metadata: {
              durationSeconds: 12.4,
              audioPresent: true,
              width: 1080,
              height: 1920,
              videoCodec: "avc1",
              audioCodec: "aac",
            },
            createdAt: ISO,
          },
        ]
      : [],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function findCall(
  fetchMock: ReturnType<typeof vi.fn>,
  url: string,
  method: string,
) {
  return fetchMock.mock.calls.find(
    ([input, init]) =>
      String(input) === url &&
      ((init?.method as string | undefined) ?? "GET").toUpperCase() === method,
  );
}

function defaultProps() {
  return {
    candidateId: "cand-e51",
    candidateCaption: "A confident answer falls apart.",
    imageProvider: "MOCK" as const,
    animationProvider: "MOCK" as const,
    maxUploadMb: 100,
    onBack: vi.fn(),
  };
}

function pickMp4File(): File {
  return new File([new Uint8Array(2048)], "clip.mp4", { type: "video/mp4" });
}

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:preview"),
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProductionSetup", () => {
  it("creates the production, links persisted rights, and lists the start gates", async () => {
    const fetchMock = installFetch(async (url, init) => {
      if (url === "/api/productions" && init?.method === "POST") {
        return jsonResponse(
          201,
          makeDetail({ production: { status: "DRAFT" } }),
        );
      }
      if (url === "/api/productions/prod-e51" && init?.method === "PATCH") {
        return jsonResponse(200, makeDetail({}));
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });

    render(<ProductionSetup {...defaultProps()} />);

    await screen.findByText("Linked to the persisted candidate confirmation.");

    const createCall = findCall(fetchMock, "/api/productions", "POST");
    expect(createCall).toBeDefined();
    expect(JSON.parse(createCall![1]?.body as string)).toMatchObject({
      candidateId: "cand-e51",
      segment: { startSeconds: 0, endSeconds: 6, durationSeconds: 6 },
      imageProvider: "MOCK",
      animationProvider: "MOCK",
    });

    const patchCall = findCall(fetchMock, "/api/productions/prod-e51", "PATCH");
    expect(JSON.parse(patchCall![1]?.body as string)).toMatchObject({
      rights: { confirmed: true, confirmationTextVersion: "2026-09-03" },
    });

    // The amendment requires separate provider labels in setup facts.
    expect(screen.getByText("Image provider")).toBeTruthy();
    expect(screen.getByText("Animation provider")).toBeTruthy();
    expect(screen.getAllByText("Mock").length).toBeGreaterThanOrEqual(2);

    const start = screen.getByRole("button", { name: "Start production" });
    expect(start.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("Upload the authorized source MP4 to continue."),
    ).toBeTruthy();
    expect(
      screen.getByText(/Start is locked until: Authorized source uploaded/),
    ).toBeTruthy();
  });

  it("shows why the rights gate is closed when the candidate confirmation is missing", async () => {
    installFetch(async (url, init) => {
      if (url === "/api/productions" && init?.method === "POST") {
        return jsonResponse(
          201,
          makeDetail({ production: { status: "DRAFT" } }),
        );
      }
      if (url === "/api/productions/prod-e51" && init?.method === "PATCH") {
        return jsonResponse(409, {
          error: {
            code: "RIGHTS_REQUIRED",
            message: "Confirm rights for this candidate before continuing.",
          },
        });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });

    const onBack = vi.fn();
    render(<ProductionSetup {...defaultProps()} onBack={onBack} />);

    await screen.findByText(
      "Confirm rights for this candidate before continuing.",
    );
    const back = screen.getByRole("button", {
      name: "Back to rights confirmation",
    });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("button", { name: "Start production" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("rejects non-MP4 selections locally without uploading", async () => {
    const fetchMock = installFetch(async (url, init) => {
      if (url === "/api/productions" && init?.method === "POST") {
        return jsonResponse(
          201,
          makeDetail({ production: { status: "DRAFT" } }),
        );
      }
      if (url === "/api/productions/prod-e51" && init?.method === "PATCH") {
        return jsonResponse(200, makeDetail({}));
      }
      if (url?.endsWith("/source")) {
        throw new Error("A rejected file must never be uploaded.");
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });

    render(<ProductionSetup {...defaultProps()} />);
    const uploadInput = await screen.findByLabelText(
      "Authorized source clip (MP4)",
    );

    const quicktime = new File([new Uint8Array(512)], "clip.mov", {
      type: "video/quicktime",
    });
    fireEvent.change(screen.getByLabelText("Authorized source clip (MP4)"), {
      target: { files: [quicktime] },
    });

    // The rejection appears twice by design: in the inline alert and in the
    // start-gate reason that explains why the gate stays closed.
    const rejections = await screen.findAllByText(
      /The source must be an MP4 video file./,
    );
    expect(rejections.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Authorized source uploaded")).toBeTruthy();
    expect(
      findCall(fetchMock, "/api/productions/prod-e51/source", "POST"),
    ).toBeUndefined();
  });

  it("uploads a valid source, shows probed facts, and unlocks start", async () => {
    installFetch(async (url, init) => {
      if (url === "/api/productions" && init?.method === "POST") {
        return jsonResponse(
          201,
          makeDetail({ production: { status: "DRAFT" } }),
        );
      }
      if (url === "/api/productions/prod-e51" && init?.method === "PATCH") {
        return jsonResponse(200, makeDetail({}));
      }
      if (
        url === "/api/productions/prod-e51/source" &&
        init?.method === "POST"
      ) {
        return jsonResponse(201, makeDetail({ withSource: true }));
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });

    const { container } = render(<ProductionSetup {...defaultProps()} />);
    const uploadInput = await screen.findByLabelText(
      "Authorized source clip (MP4)",
    );

    fireEvent.change(uploadInput, {
      target: { files: [pickMp4File()] },
    });

    await screen.findByText("12.4s");
    expect(screen.getByText("1080 × 1920")).toBeTruthy();
    expect(screen.getByText("Present")).toBeTruthy();
    expect(container.querySelector("video")).toBeTruthy();

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Start production" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("explains segment problems and keeps start locked until the draft is valid", async () => {
    installFetch(async (url, init) => {
      if (url === "/api/productions" && init?.method === "POST") {
        return jsonResponse(
          201,
          makeDetail({ production: { status: "DRAFT" } }),
        );
      }
      if (url === "/api/productions/prod-e51" && init?.method === "PATCH") {
        return jsonResponse(200, makeDetail({}));
      }
      if (
        url === "/api/productions/prod-e51/source" &&
        init?.method === "POST"
      ) {
        return jsonResponse(201, makeDetail({ withSource: true }));
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });

    render(<ProductionSetup {...defaultProps()} />);
    const uploadInput = await screen.findByLabelText(
      "Authorized source clip (MP4)",
    );

    fireEvent.change(uploadInput, {
      target: { files: [pickMp4File()] },
    });
    await screen.findByText("12.4s");

    const end = screen.getByLabelText("End (seconds)") as HTMLInputElement;
    fireEvent.change(end, { target: { value: "20" } });
    const exceeds = await screen.findAllByText(
      /must end inside the uploaded source video/,
    );
    expect(exceeds.length).toBeGreaterThanOrEqual(1);
    expect(
      screen
        .getByRole("button", { name: "Start production" })
        .hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.change(end, { target: { value: "3" } });
    const tooShort = await screen.findAllByText(
      /The segment must be at least 5 seconds long/,
    );
    expect(tooShort.length).toBeGreaterThanOrEqual(1);

    fireEvent.change(end, { target: { value: "6" } });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Start production" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("persists the segment and creative direction, then queues the production", async () => {
    const fetchMock = installFetch(async (url, init) => {
      if (url === "/api/productions" && init?.method === "POST") {
        return jsonResponse(
          201,
          makeDetail({ production: { status: "DRAFT" } }),
        );
      }
      if (url === "/api/productions/prod-e51" && init?.method === "PATCH") {
        return jsonResponse(200, makeDetail({}));
      }
      if (
        url === "/api/productions/prod-e51/source" &&
        init?.method === "POST"
      ) {
        return jsonResponse(201, makeDetail({ withSource: true }));
      }
      if (
        url === "/api/productions/prod-e51/start" &&
        init?.method === "POST"
      ) {
        return jsonResponse(
          200,
          makeDetail({ queued: true, withSource: true }),
        );
      }
      if (
        url === "/api/productions/prod-e51" &&
        init?.method === "GET"
      ) {
        return jsonResponse(
          200,
          makeDetail({ queued: true, withSource: true }),
        );
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });

    render(<ProductionSetup {...defaultProps()} />);
    // The rights-link PATCH must land before start so patch ordering is
    // deterministic.
    await screen.findByText("Linked to the persisted candidate confirmation.");
    const uploadInput = await screen.findByLabelText(
      "Authorized source clip (MP4)",
    );

    fireEvent.change(uploadInput, {
      target: { files: [pickMp4File()] },
    });
    await screen.findByText("12.4s");

    fireEvent.change(screen.getByLabelText("Creative direction (optional)"), {
      target: { value: "Hold on the side-eye beat." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Start production" }));

    // Queueing hands control to the authoritative job monitor.
    await screen.findByRole("heading", { name: "Job monitor" });

    const setupPatches = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input) === "/api/productions/prod-e51" &&
        init?.method === "PATCH",
    );
    expect(JSON.parse(setupPatches[1]?.[1]?.body as string)).toMatchObject({
      segment: { startSeconds: 0, endSeconds: 6, durationSeconds: 6 },
      creativeDirection: "Hold on the side-eye beat.",
    });
    expect(
      findCall(fetchMock, "/api/productions/prod-e51/start", "POST"),
    ).toBeDefined();

    // Queued state still discloses providers separately.
    expect(screen.getByText("Image provider")).toBeTruthy();
    expect(screen.getByText("Animation provider")).toBeTruthy();
    expect(screen.getByLabelText("Production stage timeline")).toBeTruthy();
  });

  it("surfaces the API's start-gate message when start is refused", async () => {
    installFetch(async (url, init) => {
      if (url === "/api/productions" && init?.method === "POST") {
        return jsonResponse(
          201,
          makeDetail({ production: { status: "DRAFT" } }),
        );
      }
      if (url === "/api/productions/prod-e51" && init?.method === "PATCH") {
        return jsonResponse(200, makeDetail({}));
      }
      if (
        url === "/api/productions/prod-e51/source" &&
        init?.method === "POST"
      ) {
        return jsonResponse(201, makeDetail({ withSource: true }));
      }
      if (
        url === "/api/productions/prod-e51/start" &&
        init?.method === "POST"
      ) {
        return jsonResponse(409, {
          error: {
            code: "SOURCE_TOO_SHORT",
            message: "The source video is shorter than the selected segment.",
          },
        });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });

    render(<ProductionSetup {...defaultProps()} />);
    const uploadInput = await screen.findByLabelText(
      "Authorized source clip (MP4)",
    );

    fireEvent.change(uploadInput, {
      target: { files: [pickMp4File()] },
    });
    await screen.findByText("12.4s");
    fireEvent.click(screen.getByRole("button", { name: "Start production" }));

    await screen.findByText(
      /The source video is shorter than the selected segment./,
    );
    expect(
      screen.queryByRole("heading", { name: "Production queued" }),
    ).toBeNull();
  });
});
