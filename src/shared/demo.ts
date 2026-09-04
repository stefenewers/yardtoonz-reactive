import { z } from "zod";

/**
 * The demo spine: the pinned walkthrough candidate, the committed
 * owner-cleared source clip, its sampled keyframes, and the recorded
 * known-good fallback output. One module so the demo tells one story:
 * the clip is an owner-delivered, rights-cleared trim — never a social
 * download — and the fallback output was recorded by a real MOCK/MOCK
 * pipeline run on that same clip.
 */
export const demoCandidateId = "cand-rain-laundry-003";

export const demoClip = {
  url: "/brand/demo/asisay-boss-demo.mp4",
  fileName: "asisay-boss-demo.mp4",
  label: "As ISay Boss — owner-cleared demo source (6s fixture)",
} as const;

const demoKeyframes: Record<string, readonly string[]> = {
  [demoCandidateId]: [
    "/brand/demo/keyframes/keyframe-1.jpg",
    "/brand/demo/keyframes/keyframe-2.jpg",
    "/brand/demo/keyframes/keyframe-3.jpg",
  ],
};

/** Keyframe thumbnails for candidates backed by committed demo media. */
export function demoKeyframesFor(candidateId: string): readonly string[] {
  return demoKeyframes[candidateId] ?? [];
}

export const fallbackOutput = {
  url: "/brand/demo/known-good-output.mp4",
  label: "Recorded known-good output",
  description:
    "Captured from a successful mock run on the demo clip. Shown only when this job fails, so the demo can keep going.",
} as const;

/** Guarded demo reset (rehearsal) response. */
export const demoResetResponseSchema = z
  .object({
    reset: z.object({
      seededCandidates: z.number().int().nonnegative(),
    }),
  })
  .readonly();
export type DemoResetResponse = z.infer<typeof demoResetResponseSchema>;
