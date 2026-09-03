import { describe, expect, it, vi } from "vitest";

import {
  classifyRunwayTask,
  createHttpRunwayTransport,
  RunwayAnimationError,
} from "../../src/lib/runway";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL, init: RequestInit = {}) =>
    handler(String(url), init),
  );
}

describe("Runway task outcome classification", () => {
  it("classifies a succeeded task with an output URL", () => {
    expect(
      classifyRunwayTask({
        id: "task-1",
        status: "SUCCEEDED",
        output: ["https://cdn.example.com/out.mp4"],
      }),
    ).toEqual({
      kind: "SUCCEEDED",
      requestId: "task-1",
      outputUrl: "https://cdn.example.com/out.mp4",
    });
  });

  it("treats a succeeded task without output as unknown, not success", () => {
    const outcome = classifyRunwayTask({ id: "task-1", status: "SUCCEEDED" });
    expect(outcome.kind).toBe("UNKNOWN");
  });

  it("classifies terminal failures and cancellations", () => {
    expect(
      classifyRunwayTask({ id: "t", status: "FAILED", failure: "quota" }),
    ).toEqual({ kind: "FAILED", requestId: "t", reason: "quota" });
    expect(classifyRunwayTask({ id: "t", status: "CANCELLED" }).kind).toBe(
      "CANCELLED",
    );
  });

  it("classifies all known non-terminal states as in progress", () => {
    for (const status of ["PENDING", "THROTTLED", "RUNNING"]) {
      expect(classifyRunwayTask({ id: "t", status }).kind).toBe("IN_PROGRESS");
    }
  });

  it("classifies unrecognized provider states as unknown", () => {
    const outcome = classifyRunwayTask({ id: "t", status: "SOMETHING_NEW" });
    expect(outcome).toEqual({
      kind: "UNKNOWN",
      requestId: "t",
      detail: "unrecognized task status SOMETHING_NEW",
    });
  });
});

describe("HTTP Runway transport", () => {
  const credentials = { apiKey: "secret-key-value", model: "test-model" };

  it("submits the styled frame with bearer auth and returns the request ID", async () => {
    const fetchImpl = stubFetch((url, init) => {
      expect(url).toBe("https://api.dev.runwayml.com/v1/image_to_video");
      expect(init.method).toBe("POST");
      const headers = new Headers(init.headers);
      expect(headers.get("Authorization")).toBe("Bearer secret-key-value");
      expect(headers.get("X-Runway-Version")).toBeTruthy();
      const body = JSON.parse(String(init.body)) as {
        model: string;
        promptImage: string;
      };
      expect(body.model).toBe("test-model");
      expect(body.promptImage).toMatch(/^data:image\/png;base64,/);
      // Live-verified creation response: id plus cost metadata, no status.
      return jsonResponse(200, { id: "task-42", estimatedCost: { cost: 1 } });
    });

    const transport = createHttpRunwayTransport({
      ...credentials,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const requestId = await transport.createAnimationTask({
      imageBytes: new Uint8Array([1, 2, 3]),
      imageMimeType: "image/png",
      model: "test-model",
      durationSeconds: 6,
    });
    expect(requestId).toBe("task-42");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("routes promptText through the creation body when the job provides one", async () => {
    let wireBody: Record<string, unknown> = {};
    const fetchImpl = stubFetch((_url, init) => {
      wireBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse(200, { id: "task-prompt-1" });
    });
    const transport = createHttpRunwayTransport({
      ...credentials,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await transport.createAnimationTask({
      imageBytes: new Uint8Array([1]),
      imageMimeType: "image/png",
      model: "test-model",
      durationSeconds: 6,
      promptText: "  claymation zoom on the laughing vendor  ",
    });

    // The persisted creative direction reaches the provider trimmed; the
    // image and motion fields are unchanged.
    expect(wireBody.promptText).toBe("claymation zoom on the laughing vendor");
    expect(wireBody.promptImage).toMatch(/^data:image\/png;base64,/);
    expect(wireBody.ratio).toBe("720:1280");
  });

  it("omits promptText from the creation body when the job has none", async () => {
    let wireBody: Record<string, unknown> = {};
    const fetchImpl = stubFetch((_url, init) => {
      wireBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse(200, { id: "task-prompt-2" });
    });
    const transport = createHttpRunwayTransport({
      ...credentials,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await transport.createAnimationTask({
      imageBytes: new Uint8Array([1]),
      imageMimeType: "image/png",
      model: "test-model",
      durationSeconds: 6,
    });

    // Image-only generation, byte-identical in shape to the pre-promptText
    // wire contract.
    expect("promptText" in wireBody).toBe(false);
  });

  it("rejects a creation response without a task id", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, { estimatedCost: {} }));
    const transport = createHttpRunwayTransport({
      ...credentials,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = await transport
      .createAnimationTask({
        imageBytes: new Uint8Array([1]),
        imageMimeType: "image/png",
        model: "test-model",
        durationSeconds: 6,
      })
      .catch((e) => e);
    expect(error.code).toBe("PROVIDER_UNKNOWN_OUTCOME");
  });

  it("validates the task snapshot against the contract", async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse(200, { unexpected: "shape" }),
    );
    const transport = createHttpRunwayTransport({
      ...credentials,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(transport.getTask("task-1")).rejects.toBeInstanceOf(
      RunwayAnimationError,
    );
  });

  it("maps a 404 to a proven terminal failure carrying the request ID", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(404, { error: "no task" }));
    const transport = createHttpRunwayTransport({
      ...credentials,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = await transport.getTask("task-1").catch((e) => e);
    expect(error).toBeInstanceOf(RunwayAnimationError);
    expect(error.code).toBe("PROVIDER_REQUEST_FAILED");
    expect(error.requestId).toBe("task-1");
  });

  it("maps a 5xx to an unknown outcome and never leaks the API key", async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse(500, {
        error: "Authorization header was Bearer secret-key-value",
      }),
    );
    const transport = createHttpRunwayTransport({
      ...credentials,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = await transport.getTask("task-1").catch((e) => e);
    expect(error.code).toBe("PROVIDER_UNKNOWN_OUTCOME");
    // The error message only reports the status; response bodies are not
    // trusted to be secret-free.
    expect(error.message).not.toContain("secret-key-value");
  });
});
