import {
  candidateListSchema,
  candidateSchema,
  type Candidate,
  type CandidateListOptions,
  type CandidateReviewClient,
} from "../domain/candidate";
import { sortCandidates } from "../domain/inbox";
import type { ZodType } from "zod";

import {
  apiErrorResponseSchema,
  approveCandidateResponseSchema,
  confirmRightsResponseSchema,
  listCandidatesResponseSchema,
} from "../shared/candidates";

const score = (value: number, explanation: string, inputsUsed: string[]) => ({
  score: value,
  explanation,
  inputsUsed,
});

const seededCandidates: Candidate[] = [
  {
    id: "candidate-yard-call",
    platform: "INSTAGRAM",
    sourceLabel: "Kingston street interview",
    caption: "One phone call turns a quiet reasoning into pure yard chaos.",
    publishedAt: "2026-09-02T15:00:00.000Z",
    metrics: { views: 284000, likes: 34900, comments: 3100, shares: 12800 },
    commentExcerpts: [
      "Mi replay this five time 😂",
      "The side-eye finish me",
      "Pure comedy",
    ],
    adaptationNote:
      "Hold on the caller's side-eye, then land the final reaction as a quick claymation beat.",
    scores: {
      viralMomentum: score(
        94,
        "Fast share velocity and strong interaction for a recently observed clip.",
        ["views", "likes", "comments", "shares", "source age"],
      ),
      humorResponse: score(
        91,
        "Supplied comments contain repeated laughter and reaction language tied to the final beat.",
        ["3 comment excerpts"],
      ),
      yardToonzFit: score(
        96,
        "One clear reaction, recognizable Jamaican setting, and a payoff that fits one short shot.",
        [
          "clear premise",
          "short payoff",
          "visual simplicity",
          "cultural relevance",
        ],
      ),
      overall: 94,
      scoringVersion: "demo-1",
    },
    status: "NEW",
  },
  {
    id: "candidate-bus-stop",
    platform: "TIKTOK",
    sourceLabel: "Half Way Tree vox pop",
    caption:
      "A confident answer falls apart when the follow-up question lands.",
    metrics: { views: 198000, likes: 22100, comments: 1800 },
    commentExcerpts: ["Not the follow-up 😭", "Him face change quick"],
    adaptationNote: "Use a tiny camera push as the confidence disappears.",
    scores: {
      viralMomentum: score(
        84,
        "Strong supplied views and comments; source age was not supplied, so momentum confidence is limited.",
        ["views", "likes", "comments"],
      ),
      humorResponse: score(
        88,
        "Both supplied comments react directly to the comic reversal.",
        ["2 comment excerpts"],
      ),
      yardToonzFit: score(
        90,
        "The setup and reversal read clearly in one short, visually simple shot.",
        ["clear premise", "short payoff", "visual simplicity"],
      ),
      overall: 87,
      scoringVersion: "demo-1",
    },
    status: "NEW",
  },
  ...Array.from({ length: 8 }, (_, index): Candidate => {
    const rank = index + 3;
    const overall = 86 - index * 3;
    return {
      id: `candidate-demo-${rank}`,
      platform: index % 2 === 0 ? "YOUTUBE" : "OTHER",
      sourceLabel: `Demo source ${rank}`,
      caption: `A compact reaction moment with a clear setup and payoff — candidate ${rank}.`,
      metrics: { views: 120000 - index * 7000, likes: 14000 - index * 600 },
      commentExcerpts: [],
      adaptationNote:
        "Keep the action centered and preserve the original reaction timing.",
      scores: {
        viralMomentum: score(
          overall,
          "Supplied views and likes indicate useful attention; other metrics were not supplied.",
          ["views", "likes"],
        ),
        humorResponse: score(
          overall - 5,
          "No comment evidence was supplied, so humor confidence remains limited.",
          [],
        ),
        yardToonzFit: score(
          overall + 2,
          "The premise is concise enough for a single-shot adaptation.",
          ["clear premise", "short payoff"],
        ),
        overall,
        scoringVersion: "demo-1",
      },
      status: "NEW",
    };
  }),
];

type CandidateFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function parseCandidateResponse<T>(
  response: Response,
  schema: ZodType<T>,
): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error("Candidate service returned an invalid response.", {
      cause,
    });
  }

  if (!response.ok) {
    const apiError = apiErrorResponseSchema.safeParse(payload);
    throw new Error(
      apiError.success
        ? apiError.data.error.message
        : "Candidate service request failed.",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Candidate service returned an invalid response.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function createApiCandidateClient(
  candidateFetch: CandidateFetch = fetch,
): CandidateReviewClient {
  return {
    async listCandidates(options?: CandidateListOptions) {
      const params = new URLSearchParams();
      if (options?.sort) params.set("sort", options.sort);
      if (options?.order) params.set("order", options.order);
      const search = params.toString();
      const response = await candidateFetch(
        search ? `/api/candidates?${search}` : "/api/candidates",
      );
      const { candidates } = await parseCandidateResponse(
        response,
        listCandidatesResponseSchema,
      );
      return candidateListSchema.parse(candidates);
    },
    async approveCandidate(candidateId) {
      const response = await candidateFetch(`/api/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "APPROVED" }),
      });
      const { candidate } = await parseCandidateResponse(
        response,
        approveCandidateResponseSchema,
      );
      return candidateSchema.parse(candidate);
    },
    async confirmRights({ candidateId, confirmationTextVersion }) {
      const response = await candidateFetch(
        `/api/candidates/${candidateId}/rights`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            confirmed: true,
            confirmationTextVersion,
          }),
        },
      );
      const { rightsConfirmation } = await parseCandidateResponse(
        response,
        confirmRightsResponseSchema,
      );
      return {
        confirmed: rightsConfirmation.confirmed,
        confirmedAt: rightsConfirmation.confirmedAt,
      };
    },
  };
}

function wait(milliseconds = 350): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createMockCandidateClient(): CandidateReviewClient {
  let candidates = candidateListSchema.parse(seededCandidates);

  return {
    async listCandidates(options?: CandidateListOptions) {
      await wait();
      return candidateListSchema.parse(sortCandidates(candidates, options));
    },
    async approveCandidate(candidateId) {
      await wait(250);
      const candidate = candidates.find(({ id }) => id === candidateId);
      if (!candidate)
        throw new Error(
          "Candidate could not be found. Reload the inbox and try again.",
        );

      const approved = candidateSchema.parse({
        ...candidate,
        status: "APPROVED",
      });
      candidates = candidates.map((item) =>
        item.id === candidateId ? approved : item,
      );
      return approved;
    },
    async confirmRights({ candidateId }) {
      await wait(250);
      if (
        !candidates.some(
          ({ id, status }) => id === candidateId && status === "APPROVED",
        )
      ) {
        throw new Error(
          "Approve this candidate before confirming source rights.",
        );
      }
      return { confirmed: true, confirmedAt: new Date().toISOString() };
    },
  };
}
