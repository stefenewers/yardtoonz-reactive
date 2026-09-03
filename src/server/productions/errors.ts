import { ZodError } from "zod";

import { ProductionTransitionError } from "@/domain/production";
import { ArtifactStoreError } from "@/lib/artifact-store";
import { MediaUploadError } from "@/lib/upload-validation";

import type { ProductionApiErrorCode } from "@/shared/productions";

/**
 * Gate and lookup failures raised by the production repository and service.
 * They carry the stable API error code so responses never depend on parsing
 * exception messages (Technical Specification §10).
 */
export type ProductionGateErrorCode =
  | "PRODUCTION_NOT_FOUND"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_NOT_APPROVED"
  | "RIGHTS_REQUIRED"
  | "APPROVED_CANDIDATE_REQUIRED"
  | "SOURCE_REQUIRED"
  | "SOURCE_TOO_SHORT"
  | "SOURCE_AUDIO_REQUIRED"
  | "PRODUCTION_ALREADY_ACTIVE";

export class ProductionGateError extends Error {
  constructor(public readonly code: ProductionGateErrorCode) {
    super(code);
  }
}

export interface ProductionErrorResult {
  code: ProductionApiErrorCode;
  message: string;
  status: number;
}

const gateErrorMessages: Record<ProductionGateErrorCode, string> = {
  PRODUCTION_NOT_FOUND: "Production not found.",
  CANDIDATE_NOT_FOUND: "Candidate not found.",
  CANDIDATE_NOT_APPROVED:
    "Approve the candidate before managing its productions.",
  RIGHTS_REQUIRED: "Confirm rights for this candidate before continuing.",
  APPROVED_CANDIDATE_REQUIRED:
    "The candidate must be approved to start production.",
  SOURCE_REQUIRED: "Upload the authorized source MP4 before starting.",
  SOURCE_TOO_SHORT: "The source video is shorter than the selected segment.",
  SOURCE_AUDIO_REQUIRED: "The source MP4 must include an audio track.",
  PRODUCTION_ALREADY_ACTIVE:
    "This candidate already has an active production. Wait for it to finish or fail before starting another.",
};

const gateErrorStatuses: Record<ProductionGateErrorCode, number> = {
  PRODUCTION_NOT_FOUND: 404,
  CANDIDATE_NOT_FOUND: 404,
  CANDIDATE_NOT_APPROVED: 409,
  RIGHTS_REQUIRED: 409,
  APPROVED_CANDIDATE_REQUIRED: 409,
  SOURCE_REQUIRED: 409,
  SOURCE_TOO_SHORT: 409,
  SOURCE_AUDIO_REQUIRED: 400,
  PRODUCTION_ALREADY_ACTIVE: 409,
};

const transitionErrorMessages: Record<
  ProductionTransitionError["code"],
  { code: ProductionApiErrorCode; message: string; status: number }
> = {
  ILLEGAL_TRANSITION: {
    code: "ILLEGAL_TRANSITION",
    message: "That action is not allowed for the production's current state.",
    status: 409,
  },
  RIGHTS_REQUIRED: {
    code: "RIGHTS_REQUIRED",
    message: gateErrorMessages.RIGHTS_REQUIRED,
    status: 409,
  },
  APPROVED_CANDIDATE_REQUIRED: {
    code: "APPROVED_CANDIDATE_REQUIRED",
    message: gateErrorMessages.APPROVED_CANDIDATE_REQUIRED,
    status: 409,
  },
  INVALID_SEGMENT: {
    code: "INVALID_SEGMENT",
    message:
      "The segment must be a 5–8 second clip whose end is after its start.",
    status: 400,
  },
  WORKER_OWNERSHIP_CONFLICT: {
    code: "ILLEGAL_TRANSITION",
    message: "Another worker owns this production stage.",
    status: 409,
  },
  ARTIFACT_INVARIANT_VIOLATION: {
    code: "INTERNAL_ERROR",
    message: "The production artifacts violate the state machine invariants.",
    status: 500,
  },
  UPSTREAM_ARTIFACTS_REQUIRED: {
    code: "ILLEGAL_TRANSITION",
    message: "The failed stage's upstream artifacts must be verified first.",
    status: 409,
  },
  VALIDATION_REQUIRED: {
    code: "ILLEGAL_TRANSITION",
    message: "A successful output validation report is required first.",
    status: 409,
  },
};

const uploadErrorMessages: Record<
  MediaUploadError["code"],
  ProductionErrorResult
> = {
  UNSUPPORTED_MEDIA_TYPE: {
    code: "UNSUPPORTED_MEDIA_TYPE",
    message: "Upload the source as an MP4 video.",
    status: 400,
  },
  UPLOAD_TOO_LARGE: {
    code: "UPLOAD_TOO_LARGE",
    message: "That MP4 is larger than the configured upload limit.",
    status: 400,
  },
  INVALID_MEDIA_CONTENT: {
    code: "INVALID_MEDIA_CONTENT",
    message: "That file does not contain playable MP4 media.",
    status: 400,
  },
};

/**
 * Maps every typed error the production API can produce to its stable code,
 * safe message, and HTTP status. Returns undefined for unknown errors so the
 * caller logs them and answers with a generic 500 instead of leaking detail.
 */
export function productionErrorResult(
  error: unknown,
): ProductionErrorResult | undefined {
  if (error instanceof ProductionGateError) {
    return {
      code: error.code,
      message: gateErrorMessages[error.code],
      status: gateErrorStatuses[error.code],
    };
  }
  if (error instanceof ProductionTransitionError) {
    return transitionErrorMessages[error.code];
  }
  if (error instanceof MediaUploadError) {
    return uploadErrorMessages[error.code];
  }
  if (error instanceof ArtifactStoreError) {
    if (error.code === "SIZE_LIMIT_EXCEEDED")
      return uploadErrorMessages.UPLOAD_TOO_LARGE;
    if (error.code === "INVALID_ARTIFACT") {
      return uploadErrorMessages.INVALID_MEDIA_CONTENT;
    }
    if (error.code === "WRITE_FAILED") {
      return {
        code: "INTERNAL_ERROR",
        message: "The source could not be stored. Try again.",
        status: 500,
      };
    }
    return {
      code: "INVALID_REQUEST",
      message: "The request could not be stored with the given identifiers.",
      status: 400,
    };
  }
  if (error instanceof ZodError) {
    const segmentIssue = error.issues.some(
      (issue) => issue.path[0] === "segment",
    );
    if (segmentIssue) return transitionErrorMessages.INVALID_SEGMENT;
    return {
      code: "INVALID_REQUEST",
      message: "The request body is invalid.",
      status: 400,
    };
  }
  if (error instanceof SyntaxError) {
    return {
      code: "INVALID_REQUEST",
      message: "The request body is invalid.",
      status: 400,
    };
  }
  return undefined;
}
