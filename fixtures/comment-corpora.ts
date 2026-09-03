import { z } from "zod";

import { candidateFixtures } from "@/../fixtures/candidates";

import { demoCorpusSize } from "@/domain/humor-analysis";

/**
 * Demo comment corpora for the Humor Analyst.
 *
 * Ten comments per candidate that has persisted excerpts, so the analyst
 * always reads a realistic, deterministic Jamaican-context corpus instead
 * of a synthetic stub. The excerpts recorded on each candidate open that
 * candidate's corpus in their recorded order, so the demo corpus is a
 * superset of the persisted evidence, never a contradiction.
 *
 * cand-grocery-bag-009 is intentionally absent: it has no persisted
 * excerpts, and inventing comments for it would fabricate audience
 * evidence. Its analyst panel renders the honest empty-evidence path.
 */

const commentCorpusEntrySchema = z
  .object({
    candidateId: z.string(),
    comments: z.array(z.string()),
  })
  .strict();

export const commentCorpusSchema = commentCorpusEntrySchema;

export type CommentCorpus = z.infer<typeof commentCorpusSchema>;

export const commentsPerCorpusFixture = demoCorpusSize;

export const commentCorpora: CommentCorpus[] = [
  {
    candidateId: "cand_bus-stop-001",
    comments: [
      "Mi cyaan 😂",
      "The timing weak me",
      "🤣🤣",
      "Mi dead when the man did a run behind the bus with him bag a jump",
      "Lol this is every single route across Kingston, no bus comes when the board says",
      "Why is this so accurate though, mi stand up in the sun for one hour last week",
      "The bus came early for once and everybody did a look confuse like a world record",
      "Nuh normal fi the driver to drive past the full bus stop and wave 🤣",
      "To be honest the rebook is boring to watch after the third time",
      "Big up to the driver who did wait, that is the only proper one out a whole route",
    ],
  },
  {
    candidateId: "cand-shop-credit-002",
    comments: [
      "Lmao the notebook disappear",
      "Dead 😂",
      "Too accurate",
      "Mi weak when the shopkeeper did a read the credit book upside down 🤣",
      "The way nobody owe nothing when the book lost is a whole study",
      "I am crying at the man did a plead say him pay already since July",
      "Yuh kill mi with the stamp weh did appear from nowhere",
      "Hahahaha the pencil record that only one person can read",
      "Honestly the last scene is boring, the joke run too long fi me",
      "Not the official receipt hidden in a yam bag 💀 that part is too accurate",
    ],
  },
  {
    candidateId: "cand-rain-laundry-003",
    comments: [
      "Every single time 😂",
      "Mi cyaan",
      "The sprint 🤣",
      "Mi dead a the way the one white shirt always end up in the mud",
      "Lmao the forecast did say sunny all day, typical",
      "This is why mi use the dryer, mi nuh trust sky again after last year",
      "Weak!! The pegs fly off one by one like confetti",
      "Crying at the neighbour did a bring in him clothes after the storm done 😂",
      "The timing a the rain is actually boring now, same plot every episode",
      "Big up to everybody who run out at six o clock sharp, that is dedication",
    ],
  },
  {
    candidateId: "cand-phone-speaker-004",
    comments: [
      "The panic 😂",
      "Weak!",
      "🤣",
      "Mi dead at the man did a tap the phone two time like a trap door",
      "Lmao put it in the cup, the universal speaker fix",
      "Why is this so accurate, every taxi driver know this trick",
      "Honestly the second half is boring, one joke stretch ten minutes",
      "Nuh normal how the volume drop exactly when the punchline drop 🤣",
      "I am crying at the whole bus quiet so one phone can breathe",
      "Big up to the cup method, that is proper engineering right there",
    ],
  },
  {
    candidateId: "cand-sunday-parking-005",
    comments: [
      "Too many conductors lol",
      "😂😂",
      "Mi weak when the third conductor did claim the front seat seniority",
      "Dead at the man park sideways and call it arrangement",
      "Lmao the church parking lot after service is pure navigation exam",
      "This is accurate, not one reverse without a whole committee",
      "Why is this so accurate though, sunday traffic is a sport",
      "The sprint when somebody call good spot 🤣 nobody on sunday walk normal",
      "Mi cyaan at the guard man did a direct traffic with a frozen treats stick",
      "Boring after the first minute but the parking flip is funny still",
    ],
  },
  {
    candidateId: "cand-market-change-006",
    comments: [
      "Dead 🤣",
      "Everybody doing maths now",
      "Lmao",
      "Mi dead at the man did a count change with him two hand like piano",
      "The mental maths 😂 faster than any bank app",
      "Crying at the lady did bargain five dollar down and gift back ten",
      "Too accurate, no change ever ready on a saturday morning",
      "Mi weak at the small boy did a calculate faster than the calculator man",
      "Hahahaha the receipt is a fig leaf, everything happen in the head",
      "The scene is boring the third time, but the maths logic is proper",
    ],
  },
  {
    candidateId: "cand-remote-control-007",
    comments: [
      "Crying 😂",
      "That is me",
      "Lmao the remote did in the fridge next to the butter",
      "Mi dead at the whole family did a point at the tv with the remote upside down",
      "Weak!! The battery bite trick is universal",
      "🤣 the way the father hold the remote like a microphone and nobody dare ask",
      "This is accurate for every household, no discussion",
      "Why is this so accurate, the remote always under somebody",
      "Nuh normal how one small device control the whole house mood 💀",
      "Big up to the one who tape the remote to the table, that is proper leadership",
    ],
  },
  {
    candidateId: "cand-domino-table-008",
    comments: [
      "Mi cyaan 🤣",
      "The confidence lol",
      "Dead",
      "Mi dead when the man did a stack him tile like is a bank vault",
      "Lmao two man and one rule book and three opinion",
      "Weak!! The partner sign language is a whole degree program",
      "😂 the way the table quiet when the big hand come out",
      "This is accurate, every corner have one table and one coach",
      "I am crying at the man did blame the wind for him own hand 🤣",
      "Boring stretch in the middle but the final slap is worth it still",
    ],
  },
  {
    candidateId: "cand-group-photo-010",
    comments: [
      "🤣",
      "How every photo goes",
      "Weak",
      "Lmao the front row squat is always the longest part",
      "Mi dead at the hand flash did cover the only short person full face",
      "Crying 😂 everybody fix them clothes except one man",
      "This is accurate for every family event since forever",
      "Why is this so accurate, the count down start without two people",
      "Mi cyaan at the uncle did a walk into frame after the flash done",
      "The mid photo joke is boring now, but the blink run is funny still",
    ],
  },
];

const knownCandidateIds = new Set(
  candidateFixtures.map((candidate) => candidate.id),
);

const corpusRegistrySchema = z
  .array(commentCorpusEntrySchema)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.candidateId)).size ===
      entries.length,
    { message: "comment corpora must list each candidate at most once" },
  )
  .refine(
    (entries) =>
      entries.every((entry) => knownCandidateIds.has(entry.candidateId)),
    { message: "comment corpora must reference known candidates" },
  )
  .refine(
    (entries) =>
      entries.every((entry) => entry.comments.length === demoCorpusSize),
    {
      message: `each comment corpus must hold exactly ${demoCorpusSize} comments`,
    },
  )
  .refine(
    (entries) =>
      entries.every((entry) => {
        const candidate = candidateFixtures.find(
          (candidate) => candidate.id === entry.candidateId,
        );
        if (!candidate) {
          return false;
        }
        return entry.comments
          .slice(0, candidate.commentExcerpts.length)
          .every(
            (comment, index) => comment === candidate.commentExcerpts[index],
          );
      }),
    {
      message:
        "each comment corpus must start with the candidate's persisted excerpts in order",
    },
  )
  .refine(
    (entries) => {
      const candidatesWithExcerpts = candidateFixtures.filter(
        (candidate) => candidate.commentExcerpts.length > 0,
      );
      return (
        entries.length === candidatesWithExcerpts.length &&
        candidatesWithExcerpts.every((candidate) =>
          entries.some((entry) => entry.candidateId === candidate.id),
        )
      );
    },
    {
      message:
        "comment corpora must cover every candidate that has persisted excerpts",
    },
  );

const validatedCorpora = corpusRegistrySchema.parse(commentCorpora);

export function commentCorpusForCandidate(candidateId: string): string[] {
  const entry = validatedCorpora.find(
    (corpus) => corpus.candidateId === candidateId,
  );
  return entry ? [...entry.comments] : [];
}

export function hasCommentCorpus(candidateId: string): boolean {
  return validatedCorpora.some((corpus) => corpus.candidateId === candidateId);
}
