import { z } from "zod";

export const scoreEvidenceSchema = z.object({
  score: z.number().int().min(0).max(100),
  explanation: z.string().min(1),
  inputsUsed: z.array(z.string()),
});

export const candidateSchema = z.object({
  id: z.string().min(1),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "OTHER"]),
  sourceLabel: z.string().min(1),
  caption: z.string().min(1),
  publishedAt: z.string().optional(),
  metrics: z.object({
    views: z.number().nonnegative().optional(),
    likes: z.number().nonnegative().optional(),
    comments: z.number().nonnegative().optional(),
    shares: z.number().nonnegative().optional(),
    saves: z.number().nonnegative().optional(),
  }),
  commentExcerpts: z.array(z.string()),
  adaptationNote: z.string().optional(),
  scores: z.object({
    viralMomentum: scoreEvidenceSchema,
    humorResponse: scoreEvidenceSchema,
    yardToonzFit: scoreEvidenceSchema,
    overall: z.number().int().min(0).max(100),
    scoringVersion: z.string().min(1),
  }),
  status: z.enum(["NEW", "APPROVED", "REJECTED"]),
});

export const candidateListSchema = z.array(candidateSchema);
export type Candidate = z.infer<typeof candidateSchema>;
export type ScoreEvidence = z.infer<typeof scoreEvidenceSchema>;

export const candidateSortFields = [
  "overall",
  "viralMomentum",
  "humorResponse",
  "yardToonzFit",
] as const;
export type CandidateSortField = (typeof candidateSortFields)[number];
export type CandidateSortOrder = "asc" | "desc";

export interface CandidateListOptions {
  sort?: CandidateSortField;
  order?: CandidateSortOrder;
}

export interface CandidateReviewClient {
  listCandidates(options?: CandidateListOptions): Promise<Candidate[]>;
  approveCandidate(candidateId: string): Promise<Candidate>;
  confirmRights(input: {
    candidateId: string;
    confirmationTextVersion: string;
  }): Promise<{ confirmed: true; confirmedAt: string }>;
}

export function formatMetric(value: number | undefined): string {
  return value === undefined
    ? "Not supplied"
    : new Intl.NumberFormat("en").format(value);
}

export function scoreLabel(score: number): "Strong" | "Promising" | "Review" {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Promising";
  return "Review";
}
