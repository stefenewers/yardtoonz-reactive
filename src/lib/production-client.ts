import {
  directorTreatmentResponseSchema,
  type DirectorTreatmentResource,
} from "../domain/director";
import type { SegmentSelection } from "../domain/production";
import type { AnimationProvider, ImageProvider } from "./providers";
import {
  listProductionsResponseSchema,
  productionDetailResponseSchema,
  productionErrorResponseSchema,
  type ProductionDetailResponse,
  type RecordOutputDecisionRequest,
} from "../shared/productions";
import type { ZodType } from "zod";

/**
 * Browser client for the persisted production APIs. Failures surface as
 * ProductionApiError carrying the stable API error code so the setup and
 * job/output UI can explain exactly why an action is blocked
 * (Technical Specification §10).
 */

export class ProductionApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

type ProductionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const unavailableError = (cause: unknown) =>
  new ProductionApiError(
    "PRODUCTION_UNAVAILABLE",
    "The production service could not be reached. Try again.",
    { cause },
  );

async function parsePayload<T>(
  response: Response,
  schema: ZodType<T>,
): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw unavailableError(cause);
  }

  if (!response.ok) {
    const apiError = productionErrorResponseSchema.safeParse(payload);
    throw new ProductionApiError(
      apiError.success ? apiError.data.error.code : "PRODUCTION_REQUEST_FAILED",
      apiError.success
        ? apiError.data.error.message
        : "The production service rejected the request.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ProductionApiError(
      "INVALID_PRODUCTION_RESPONSE",
      "The production service returned an invalid response.",
    );
  }
  return parsed.data;
}

export interface ProductionApiClient {
  createProduction(input: {
    candidateId: string;
    segment: SegmentSelection;
    imageProvider: ImageProvider;
    animationProvider: AnimationProvider;
  }): Promise<ProductionDetailResponse>;
  updateSetup(
    productionId: string,
    body: {
      segment?: SegmentSelection;
      creativeDirection?: string;
      rights?: {
        confirmed: true;
        confirmationTextVersion: string;
      };
    },
  ): Promise<ProductionDetailResponse>;
  uploadSource(
    productionId: string,
    source: File,
  ): Promise<ProductionDetailResponse>;
  start(productionId: string): Promise<ProductionDetailResponse>;
  /** Authoritative job snapshot: production, stages, artifacts, decision. */
  getDetail(productionId: string): Promise<ProductionDetailResponse>;
  /** Re-arms a FAILED production; the response is the re-armed detail. */
  retry(
    productionId: string,
    approval: { confirmed: true },
  ): Promise<ProductionDetailResponse>;
  /** Persists the output decision; the response carries the fresh verdict. */
  recordDecision(
    productionId: string,
    body: RecordOutputDecisionRequest,
  ): Promise<ProductionDetailResponse>;
  /** Lists a candidate's productions for revisit recovery. */
  listForCandidate(candidateId: string): Promise<ProductionDetailResponse[]>;
  /**
   * The candidate's persisted Director treatment for setup prefill, or null
   * when none exists — absence is a normal state, not an error.
   */
  fetchDirectorTreatment(
    candidateId: string,
  ): Promise<DirectorTreatmentResource | null>;
  /** Safe URL for previewing or downloading one stored artifact. */
  artifactUrl(
    productionId: string,
    artifactId: string,
    download?: boolean,
  ): string;
}

export function createApiProductionClient(
  productionFetch: ProductionFetch = fetch,
): ProductionApiClient {
  async function request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await productionFetch(url, init);
    } catch (cause) {
      throw unavailableError(cause);
    }
    return response;
  }

  async function send(
    url: string,
    init: RequestInit,
  ): Promise<ProductionDetailResponse> {
    return parsePayload(
      await request(url, init),
      productionDetailResponseSchema,
    );
  }

  return {
    async createProduction(input) {
      return send("/api/productions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    },
    async updateSetup(productionId, body) {
      return send(`/api/productions/${productionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    async uploadSource(productionId, source) {
      const formData = new FormData();
      formData.set("source", source);
      return send(`/api/productions/${productionId}/source`, {
        method: "POST",
        body: formData,
      });
    },
    async start(productionId) {
      return send(`/api/productions/${productionId}/start`, {
        method: "POST",
      });
    },
    async getDetail(productionId) {
      return send(`/api/productions/${productionId}`, { method: "GET" });
    },
    async retry(productionId, approval) {
      return send(`/api/productions/${productionId}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approval }),
      });
    },
    async recordDecision(productionId, body) {
      return send(`/api/productions/${productionId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    async listForCandidate(candidateId) {
      const response = await request(
        `/api/productions?candidateId=${encodeURIComponent(candidateId)}`,
        { method: "GET" },
      );
      const payload = await parsePayload(
        response,
        listProductionsResponseSchema,
      );
      return payload.productions;
    },
    async fetchDirectorTreatment(treatmentCandidateId) {
      const response = await request(
        `/api/director/treatments?candidateId=${encodeURIComponent(
          treatmentCandidateId,
        )}`,
        { method: "GET" },
      );
      if (response.status === 404) return null;
      const payload = await parsePayload(
        response,
        directorTreatmentResponseSchema,
      );
      return payload.treatment;
    },
    artifactUrl(productionId, artifactId, download = false) {
      const suffix = download ? "?download=1" : "";
      return `/api/productions/${productionId}/artifacts/${artifactId}${suffix}`;
    },
  };
}
