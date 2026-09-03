import type { EngagementMetrics, FitChecklist } from "@/shared/candidates";
import { sourcePlatforms } from "@/shared/candidates";
import { z } from "zod";

const candidateFixtureSchema = z
  .object({
    id: z.string().trim().min(1),
    platform: z.enum(sourcePlatforms),
    sourceUrl: z.url().optional(),
    sourceLabel: z.string().trim().min(1),
    caption: z.string().trim().min(1),
    publishedAt: z.iso.datetime().optional(),
    observedAt: z.iso.datetime(),
    metrics: z.custom<EngagementMetrics>(),
    commentExcerpts: z.array(z.string()),
    adaptationNote: z.string().trim().min(1),
    fitChecklist: z.custom<FitChecklist>(),
  })
  .readonly();

export type CandidateFixture = z.infer<typeof candidateFixtureSchema>;

const completeFit: FitChecklist = {
  clearPremise: true,
  recognizableScenario: true,
  payoffWithinEightSeconds: true,
  authorizedAudio: true,
  visuallySimple: true,
  culturallyRelevant: true,
};

export const candidateFixtures = z.array(candidateFixtureSchema).parse([
  {
    id: "cand_bus-stop-001",
    platform: "OTHER",
    sourceLabel: "Yard Toonz demo archive",
    caption: "The bus finally arrives just as everybody gives up waiting.",
    publishedAt: "2026-09-02T12:00:00.000Z",
    observedAt: "2026-09-03T12:00:00.000Z",
    metrics: { views: 94000, likes: 8100, comments: 950, shares: 2600 },
    commentExcerpts: ["Mi cyaan 😂", "The timing weak me", "🤣🤣"],
    adaptationNote:
      "Hold on the queue's synchronized side-eye before the payoff.",
    fitChecklist: completeFit,
  },
  {
    id: "cand-shop-credit-002",
    platform: "OTHER",
    sourceLabel: "Yard Toonz demo archive",
    caption: "A shopkeeper remembers every item except the promised credit.",
    publishedAt: "2026-09-03T06:00:00.000Z",
    observedAt: "2026-09-03T12:00:00.000Z",
    metrics: {
      views: 43000,
      likes: 5200,
      comments: 610,
      shares: 1200,
      saves: 430,
    },
    commentExcerpts: ["Lmao the notebook disappear", "Dead 😂", "Too accurate"],
    adaptationNote:
      "Use one counter, one notebook, and a quick disappearing-prop beat.",
    fitChecklist: completeFit,
  },
  {
    id: "cand-rain-laundry-003",
    platform: "INSTAGRAM",
    sourceLabel: "Authorized demo contributor",
    caption: "Fresh laundry meets the first sudden drop of rain.",
    publishedAt: "2026-09-01T12:00:00.000Z",
    observedAt: "2026-09-03T12:00:00.000Z",
    metrics: {
      views: 180000,
      likes: 14000,
      comments: 740,
      shares: 3800,
      saves: 1600,
    },
    commentExcerpts: ["Every single time 😂", "Mi cyaan", "The sprint 🤣"],
    adaptationNote:
      "Exaggerate the first raindrop and the instant clothesline sprint.",
    fitChecklist: completeFit,
  },
  {
    id: "cand-phone-speaker-004",
    platform: "YOUTUBE",
    sourceLabel: "Authorized demo contributor",
    caption: "A private voice note starts playing through the car speakers.",
    publishedAt: "2026-09-03T09:00:00.000Z",
    observedAt: "2026-09-03T12:00:00.000Z",
    metrics: { views: 29000, likes: 3900, comments: 510, shares: 900 },
    commentExcerpts: ["The panic 😂", "Weak!", "🤣"],
    adaptationNote:
      "Keep the reveal readable through one face and the dashboard display.",
    fitChecklist: completeFit,
  },
  {
    id: "cand-sunday-parking-005",
    platform: "OTHER",
    sourceLabel: "Yard Toonz demo archive",
    caption: "Everyone gives different directions to the same parking space.",
    publishedAt: "2026-08-31T12:00:00.000Z",
    observedAt: "2026-09-03T12:00:00.000Z",
    metrics: { views: 125000, likes: 9600, comments: 480, shares: 2100 },
    commentExcerpts: ["Too many conductors lol", "😂😂"],
    adaptationNote:
      "Stage the conflicting hand signals around one slowly reversing car.",
    fitChecklist: { ...completeFit, visuallySimple: false },
  },
  {
    id: "cand-market-change-006",
    platform: "TIKTOK",
    sourceLabel: "Authorized demo contributor",
    caption: "The change calculation becomes a full committee meeting.",
    publishedAt: "2026-09-02T18:00:00.000Z",
    observedAt: "2026-09-03T12:00:00.000Z",
    metrics: {
      views: 67000,
      likes: 7100,
      comments: 820,
      shares: 1700,
      saves: 510,
    },
    commentExcerpts: ["Dead 🤣", "Everybody doing maths now", "Lmao"],
    adaptationNote:
      "Turn the arithmetic into a rapid clay counter choreography.",
    fitChecklist: completeFit,
  },
  {
    id: "cand-remote-control-007",
    platform: "OTHER",
    sourceLabel: "Yard Toonz demo archive",
    caption:
      "The missing remote is discovered in the hand of the person searching.",
    observedAt: "2026-09-03T12:00:00.000Z",
    metrics: { views: 51000, likes: 4600, comments: 330 },
    commentExcerpts: ["Crying 😂", "That is me"],
    adaptationNote:
      "Frame the reveal tightly so the remote is visible before the character notices.",
    fitChecklist: { ...completeFit, culturallyRelevant: false },
  },
  {
    id: "cand-domino-table-008",
    platform: "YOUTUBE",
    sourceLabel: "Authorized demo contributor",
    caption: "A confident domino slam lands on the wrong end of the table.",
    publishedAt: "2026-09-03T10:00:00.000Z",
    observedAt: "2026-09-03T12:00:00.000Z",
    metrics: {
      views: 22000,
      likes: 3100,
      comments: 440,
      shares: 800,
      saves: 220,
    },
    commentExcerpts: ["Mi cyaan 🤣", "The confidence lol", "Dead"],
    adaptationNote:
      "Use the slam as the anticipation beat and the table reaction as payoff.",
    fitChecklist: completeFit,
  },
  {
    id: "cand-grocery-bag-009",
    platform: "INSTAGRAM",
    sourceLabel: "Authorized demo contributor",
    caption: "One grocery bag survives every step until the front door.",
    publishedAt: "2026-09-02T00:00:00.000Z",
    observedAt: "2026-09-03T12:00:00.000Z",
    metrics: { views: 76000, likes: 5800, shares: 1300 },
    commentExcerpts: [],
    adaptationNote:
      "Build suspense around the stretching handle and save the break for the door.",
    fitChecklist: completeFit,
  },
  {
    id: "cand-group-photo-010",
    platform: "OTHER",
    sourceLabel: "Yard Toonz demo archive",
    caption:
      "The group photo is perfect except for the person holding the phone.",
    publishedAt: "2026-08-30T12:00:00.000Z",
    observedAt: "2026-09-03T12:00:00.000Z",
    metrics: {
      views: 89000,
      likes: 6200,
      comments: 290,
      shares: 950,
      saves: 640,
    },
    commentExcerpts: ["🤣", "How every photo goes", "Weak"],
    adaptationNote:
      "Reveal the photographer's accidental close-up after the posed group shot.",
    fitChecklist: { ...completeFit, authorizedAudio: false },
  },
]);
