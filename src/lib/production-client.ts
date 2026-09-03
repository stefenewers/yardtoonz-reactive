import type { SegmentSelection } from "../domain/production";
import type { AnimationProvider, ImageProvider } from "./providers";
import {
  productionDetailResponseSchema,
  productionErrorResponseSchema,
  type ProductionDetailResponse,
} from "../shared/productions";
import type { ZodType } from "zod";

/**
 * Browser client for the persisted production APIs. Failures surface as
 * ProductionApiError carrying the stable API error code so the setup UI can
 * explain exactly why a gate is closed (Technical Specification §10).
 */

export class ProductionApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
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
      apiError.success
        ? apiError.data.error.code
        : "PRODUCTION_REQUEST_FAILED",
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

export interface ProductionSetupClient {
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
}

export function createApiProductionClient(
  productionFetch: ProductionFetch = fetch,
): ProductionSetupClient {
  async function send(
    url: string,
    init: RequestInit,
  ): Promise<ProductionDetailResponse> {
    let response: Response;
    try {
      response = await productionFetch(url, init);
    } catch (cause) {
      throw unavailableError(cause);
    }
    return parsePayload(response, productionDetailResponseSchema);
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
  };
}
