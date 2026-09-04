import { NextResponse } from "next/server";

import { apiError, invalidRequest } from "@/server/api-response";
import {
  CandidateIntakeError,
  createCsvCandidateIntakeProvider,
  createManualCandidateIntakeProvider,
  createSeededCandidateIntakeProvider,
  importCandidates,
  pastedUrlToIntakeRecord,
} from "@/server/candidates/intake";
import { getCandidateRepository } from "@/server/candidates/service";
import {
  importCandidatesRequestSchema,
  importCandidatesResponseSchema,
} from "@/shared/candidate-intake";

export const dynamic = "force-dynamic";

const intakeErrorStatuses = {
  INVALID_CSV: 400,
  INVALID_RECORD: 400,
  DUPLICATE_ID: 409,
} as const satisfies Record<CandidateIntakeError["code"], number>;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = importCandidatesRequestSchema.parse(await request.json());
    const provider =
      input.source === "CSV"
        ? createCsvCandidateIntakeProvider(input.csv)
        : input.source === "MANUAL"
          ? createManualCandidateIntakeProvider(
              pastedUrlToIntakeRecord({
                pasted: input.candidate,
                now: new Date().toISOString(),
              }),
            )
          : createSeededCandidateIntakeProvider();

    const result = importCandidates({
      provider,
      repository: getCandidateRepository(),
      now: new Date().toISOString(),
    });

    return NextResponse.json(
      importCandidatesResponseSchema.parse({ import: result }),
    );
  } catch (error) {
    if (error instanceof CandidateIntakeError) {
      return apiError(
        error.code,
        error.message,
        intakeErrorStatuses[error.code],
      );
    }
    return invalidRequest(error);
  }
}
