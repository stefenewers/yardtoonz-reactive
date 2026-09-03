import { describe, expect, it } from "vitest";

import {
  aggregateSentiment,
  analyzeCommentCorpus,
  commentCorpusAnalysisSchema,
  createHumorAnalysisRequestSchema,
  demoCorpusSize,
  detectMarkers,
  humorAnalysisQuerySchema,
  humorAnalysisResourceSchema,
  laughterMarkerCategories,
  sentimentNegationWindow,
  smallCorpusThreshold,
  topMarkerLimit,
} from "@/domain/humor-analysis";

import {
  commentCorpora,
  commentCorpusForCandidate,
  commentsPerCorpusFixture,
  hasCommentCorpus,
} from "../../fixtures/comment-corpora";
import { candidateFixtures } from "../../fixtures/candidates";

const markerIds = (text: string) =>
  detectMarkers(text).map((marker) => marker.id);

describe("laughter marker detection", () => {
  it("detects direct laughter expressions", () => {
    expect(markerIds("Lol this is funny")).toContain("lol");
    expect(markerIds("LMAO the notebook disappear")).toContain("lmao");
    expect(markerIds("lmaooo he did it again")).toContain("lmao");
    expect(markerIds("ROFL")).toContain("rofl");
    expect(markerIds("Hahahaha the pencil record")).toContain("hahaha");
    expect(markerIds("I'm dead")).toContain("im-dead");
    expect(markerIds("I’m dead")).toContain("im-dead");
    expect(markerIds("Dying at this one")).toContain("dying");
    expect(markerIds("you got me crying")).toContain("crying");
    expect(markerIds("that had me weak")).toContain("crying");
  });

  it("matches elongated laughter without matching its fragments", () => {
    expect(markerIds("haha")).toEqual(["hahaha"]);
    expect(markerIds("hehehe")).toEqual(["hehe"]);
    expect(markerIds("loool")).toEqual(["lol"]);
    expect(markerIds("ha")).toEqual([]);
    expect(markerIds("he")).toEqual([]);
  });

  it("respects word boundaries", () => {
    expect(markerIds("deadly serious")).toEqual([]);
    expect(markerIds("the weaker one")).toEqual([]);
    expect(markerIds("lollipop")).toEqual([]);
  });

  it("detects patois idioms with precedence over generic fragments", () => {
    expect(markerIds("Mi dead")).toEqual(["mi-dead"]);
    expect(markerIds("mi weak")).toEqual(["mi-weak"]);
    expect(detectMarkers("Mi dead")).not.toContainEqual(
      expect.objectContaining({ id: "dead" }),
    );
    expect(detectMarkers("mi weak")).not.toContainEqual(
      expect.objectContaining({ id: "weak" }),
    );
  });

  it("detects the remaining patois idioms", () => {
    expect(markerIds("yuh kill mi")).toContain("yuh-kill-me");
    expect(markerIds("yuh done kill me")).toContain("yuh-kill-me");
    expect(markerIds("this kills mi")).toContain("kills-mi");
    expect(markerIds("mi belly a me")).toContain("mi-belly");
    expect(markerIds("nuh normal how the bus run")).toContain("nuh-normal");
  });

  it("detects laughter emoji and collapses repeats to one marker", () => {
    expect(markerIds("😂")).toEqual(["😂"]);
    expect(markerIds("🤣🤣")).toEqual(["🤣"]);
    expect(markerIds("💀💀💀 the confidence")).toEqual(["💀"]);
  });

  it("detects hyperbole expressions", () => {
    expect(markerIds("too accurate")).toContain("too-accurate");
    expect(markerIds("called me out")).toContain("called-me-out");
    expect(markerIds("why is this so real")).toContain("why-is-this");
    expect(markerIds("not the official receipt")).toContain("not-the");
  });

  it("suppresses overlapping matches so idioms win", () => {
    // The standalone "dead" inside the idiom span is suppressed, while a
    // separate "dead" outside the span still counts.
    expect(markerIds("I'm dead at the ending")).toEqual(["im-dead"]);
    expect(markerIds("I'm dead, and that dead ending")).toEqual([
      "im-dead",
      "dead",
    ]);
  });

  it("keeps first occurrence per marker id in position order", () => {
    const markers = detectMarkers("Dead 😂 and mi dead again");
    expect(markers.map((marker) => marker.id)).toEqual([
      "dead",
      "😂",
      "mi-dead",
    ]);
  });

  it("classifies every marker into a known category", () => {
    for (const text of [
      "Lol mi dead 😂",
      "Too accurate 🤣",
      "Nuh normal 💀",
      "hahaha",
    ]) {
      for (const marker of detectMarkers(text)) {
        expect(laughterMarkerCategories).toContain(marker.category);
      }
    }
  });
});

describe("sentiment aggregation", () => {
  it("reads positive and negative language", () => {
    expect(aggregateSentiment("This is great")).toEqual({
      sentiment: "POSITIVE",
      basis: ["great"],
    });
    expect(aggregateSentiment("Totally boring")).toEqual({
      sentiment: "NEGATIVE",
      basis: ["boring"],
    });
  });

  it("flips polarity for negated language", () => {
    expect(aggregateSentiment("not accurate at all")).toEqual({
      sentiment: "NEGATIVE",
      basis: ["accurate (negated)"],
    });
    expect(aggregateSentiment("mi cyaan love this one")).toEqual({
      sentiment: "NEGATIVE",
      basis: ["love (negated)"],
    });
  });

  it("only negates within a three-token window", () => {
    expect(aggregateSentiment("never in a boring way")).toEqual({
      sentiment: "POSITIVE",
      basis: ["boring (negated)"],
    });
    expect(aggregateSentiment("never in a month boring")).toEqual({
      sentiment: "NEGATIVE",
      basis: ["boring"],
    });
  });

  it("matches patois sentiment phrases before unigrams", () => {
    expect(aggregateSentiment("Big up to the driver")).toEqual({
      sentiment: "POSITIVE",
      basis: ["big up"],
    });
    expect(aggregateSentiment("the ending was nuh good")).toEqual({
      sentiment: "NEGATIVE",
      basis: ["nuh good"],
    });
  });

  it("consumes the second token of a matched phrase", () => {
    expect(aggregateSentiment("big big up")).toEqual({
      sentiment: "POSITIVE",
      basis: ["big up"],
    });
  });

  it("counts sentiment emoji", () => {
    expect(aggregateSentiment("this one ❤️")).toEqual({
      sentiment: "POSITIVE",
      basis: ["1 positive emoji"],
    });
    expect(aggregateSentiment("👎")).toEqual({
      sentiment: "NEGATIVE",
      basis: ["1 negative emoji"],
    });
  });

  it("nets out to neutral when positive and negative balance", () => {
    expect(aggregateSentiment("great but boring")).toEqual({
      sentiment: "NEUTRAL",
      basis: ["great", "boring"],
    });
  });

  it("returns neutral with no basis when no language matches", () => {
    expect(aggregateSentiment("The bus came")).toEqual({
      sentiment: "NEUTRAL",
      basis: [],
    });
  });
});

describe("corpus analysis", () => {
  it("analyzes each comment with position, markers, sentiment, and explanation", () => {
    const analysis = analyzeCommentCorpus(["Mi dead 😂", "The bus came"]);
    expect(analysis.corpusSize).toBe(2);

    const [first, second] = analysis.comments;
    expect(first).toMatchObject({
      position: 0,
      text: "Mi dead 😂",
      isLaughter: true,
      sentiment: "NEUTRAL",
      sentimentBasis: [],
    });
    expect(first?.explanation).toContain('"Mi dead"');
    expect(first?.explanation).toContain("Neutral sentiment");

    expect(second).toMatchObject({
      position: 1,
      text: "The bus came",
      isLaughter: false,
      sentiment: "NEUTRAL",
    });
    expect(second?.explanation).toContain("Detected no laughter markers");
  });

  it("aggregates coverage, dominant sentiment, and category counts", () => {
    const analysis = analyzeCommentCorpus([
      "Mi dead 😂",
      "lol",
      "The bus came",
      "not accurate",
      "Big up to the driver",
    ]);

    expect(analysis.summary.laughterCommentCount).toBe(2);
    expect(analysis.summary.laughterCoverage).toBe(0.4);
    expect(analysis.summary.sentimentCounts).toEqual({
      POSITIVE: 1,
      NEUTRAL: 3,
      NEGATIVE: 1,
    });
    expect(analysis.summary.dominantSentiment).toBe("NEUTRAL");
    expect(analysis.summary.categoryCommentCounts.patois).toBe(1);
    expect(analysis.summary.categoryCommentCounts.direct).toBe(1);
    expect(analysis.summary.categoryCommentCounts.emoji).toBe(1);
    expect(analysis.summary.categoryCommentCounts.hyperbole).toBe(0);
    expect(analysis.summary.averageMarkersPerComment).toBe(0.6);
  });

  it("computes the laughter signal from coverage and positive share", () => {
    const analysis = analyzeCommentCorpus([
      "Mi dead 😂",
      "lol",
      "The bus came",
      "not accurate",
      "Big up to the driver",
    ]);

    const { laughterCommentCount, laughterCoverage, sentimentCounts } =
      analysis.summary;
    const laughter = analysis.comments
      .filter((comment) => comment.isLaughter)
      .filter((comment) => comment.sentiment === "POSITIVE").length;
    const positiveShare =
      laughterCommentCount === 0 ? 0 : laughter / laughterCommentCount;
    const expected = Math.round(
      100 * (0.7 * laughterCoverage + 0.3 * positiveShare),
    );

    expect(analysis.summary.laughterSignal).toBe(expected);
    expect(analysis.summary.laughterSignal).toBe(28);
    void sentimentCounts;
  });

  it("zeroes the laughter signal for an empty corpus", () => {
    const analysis = analyzeCommentCorpus([]);
    expect(analysis.summary.laughterSignal).toBe(0);
  });

  it("limits and ranks top markers", () => {
    // Six distinct markers across the corpus so the limit actually cuts one.
    const analysis = analyzeCommentCorpus([
      "lol a",
      "lol b",
      "hahaha c",
      "😂 d",
      "🤣 e",
      "mi dead f",
      "too accurate g",
    ]);

    expect(analysis.summary.topMarkers).toHaveLength(topMarkerLimit);
    expect(analysis.summary.topMarkers[0]).toMatchObject({
      markerId: "lol",
      count: 2,
    });
    // Exactly one of the six distinct markers is cut by the limit; which
    // one is a tie-break detail the list contract does not promise.
    const corpusMarkerIds = [
      "lol",
      "hahaha",
      "😂",
      "🤣",
      "mi-dead",
      "too-accurate",
    ];
    const ranked = analysis.summary.topMarkers.map((m) => m.markerId);
    const dropped = corpusMarkerIds.filter((id) => !ranked.includes(id));
    expect(dropped).toHaveLength(1);
  });

  it("returns the empty-corpus path with honest evidence gaps", () => {
    const analysis = analyzeCommentCorpus([]);

    expect(analysis.corpusSize).toBe(0);
    expect(analysis.comments).toEqual([]);
    expect(analysis.summary.laughterCommentCount).toBe(0);
    expect(analysis.summary.summaryExplanation).toBe(
      "The corpus is empty, so no laughter or sentiment evidence can be read.",
    );
    expect(analysis.evidenceGaps).toEqual([
      "No comment excerpts were supplied, so there is no corpus to analyze.",
      "No sentiment language was matched, so the corpus aggregated to neutral.",
    ]);
    expect(analysis.confidence).toBeCloseTo(0.15, 5);
  });

  it("flags the small-corpus and no-marker gaps", () => {
    const analysis = analyzeCommentCorpus(["One", "Two", "Three"]);

    expect(analysis.evidenceGaps).toContain(
      `Fewer than ${smallCorpusThreshold} comments were supplied, so coverage shares are a hint rather than a measurement.`,
    );
    expect(analysis.evidenceGaps).toContain(
      "No configured laughter markers appeared in the corpus, so the laughter signal is zero by evidence.",
    );
    expect(analysis.confidence).toBeCloseTo(0.5, 5);
  });

  it("keeps confidence below certainty for rich corpora", () => {
    const busStop = commentCorpusForCandidate("cand_bus-stop-001");
    const analysis = analyzeCommentCorpus(busStop);

    expect(analysis.confidence).toBeLessThanOrEqual(0.95);
    expect(analysis.evidenceGaps).toEqual([]);
  });

  it("explains the corpus in plain language without scoring claims", () => {
    const analysis = analyzeCommentCorpus(["Mi dead 😂", "lol", "mi weak"]);

    expect(analysis.summary.summaryExplanation).toBe(
      "3 of 3 comments carried laughter markers (100% coverage). Sentiment runs neutral (0 positive, 3 neutral, 0 negative). Patois laughter led with 2 comments. Laughter signal 70/100 is an evidence metric for the analyst panel; it does not feed the locked candidate scoring.",
    );
  });

  it("is deterministic across runs", () => {
    const corpus = commentCorpusForCandidate("cand-domino-table-008");
    expect(analyzeCommentCorpus(corpus)).toEqual(analyzeCommentCorpus(corpus));
  });
});

describe("demo comment corpora", () => {
  const candidatesWithExcerpts = candidateFixtures.filter(
    (candidate) => candidate.commentExcerpts.length > 0,
  );

  it("covers exactly the candidates with persisted excerpts", () => {
    expect(commentCorpora).toHaveLength(candidatesWithExcerpts.length);
    for (const candidate of candidatesWithExcerpts) {
      expect(hasCommentCorpus(candidate.id)).toBe(true);
    }
  });

  it("carries ten comments per corpus", () => {
    expect(commentsPerCorpusFixture).toBe(demoCorpusSize);
    for (const corpus of commentCorpora) {
      expect(corpus.comments).toHaveLength(demoCorpusSize);
    }
  });

  it("opens each corpus with the persisted excerpts in order", () => {
    for (const corpus of commentCorpora) {
      const candidate = candidateFixtures.find(
        (candidate) => candidate.id === corpus.candidateId,
      );
      expect(candidate).toBeDefined();
      expect(
        corpus.comments.slice(0, candidate?.commentExcerpts.length),
      ).toEqual(candidate?.commentExcerpts);
    }
  });

  it("leaves the no-excerpt candidate on the honest empty path", () => {
    expect(hasCommentCorpus("cand-grocery-bag-009")).toBe(false);
    expect(commentCorpusForCandidate("cand-grocery-bag-009")).toEqual([]);
  });

  it("returns a defensive copy of the corpus", () => {
    const corpus = commentCorpusForCandidate("cand_bus-stop-001");
    corpus.pop();
    expect(commentCorpusForCandidate("cand_bus-stop-001")).toHaveLength(
      demoCorpusSize,
    );
  });

  it("produces valid analyses for every demo corpus", () => {
    for (const corpus of commentCorpora) {
      const analysis = analyzeCommentCorpus(corpus.comments);
      expect(() => commentCorpusAnalysisSchema.parse(analysis)).not.toThrow();
      expect(analysis.summary.laughterCommentCount).toBeGreaterThan(0);
    }
  });
});

describe("persistence contracts", () => {
  it("round-trips a corpus analysis through the resource schema", () => {
    const analysis = analyzeCommentCorpus([
      "Mi dead 😂",
      "lol",
      "boring but accurate",
    ]);
    const resource = {
      id: "analysis_cand_bus-stop-001",
      candidateId: "cand_bus-stop-001",
      corpusSource: "DEMO_CORPUS",
      createdAt: "2026-09-03T10:00:00.000Z",
      analysis,
    };

    const parsed = humorAnalysisResourceSchema.parse(resource);
    expect(parsed.analysis.corpusSize).toBe(3);
    expect(parsed.corpusSource).toBe("DEMO_CORPUS");
  });

  it("requires candidateId on create requests", () => {
    expect(() => createHumorAnalysisRequestSchema.parse({})).toThrow();
    expect(() =>
      createHumorAnalysisRequestSchema.parse({
        candidateId: "cand_bus-stop-001",
      }),
    ).not.toThrow();
  });

  it("validates the candidateId query contract", () => {
    expect(() => humorAnalysisQuerySchema.parse({})).toThrow();
    expect(() =>
      humorAnalysisQuerySchema.parse({ candidateId: "cand_bus-stop-001" }),
    ).not.toThrow();
  });

  it("rejects unknown corpus sources", () => {
    const analysis = analyzeCommentCorpus(["Mi dead 😂"]);
    expect(() =>
      humorAnalysisResourceSchema.parse({
        id: "analysis_x",
        candidateId: "cand_bus-stop-001",
        corpusSource: "MADE_UP",
        createdAt: "2026-09-03T10:00:00.000Z",
        analysis,
      }),
    ).toThrow();
  });
});

describe("module constants", () => {
  it("keeps the documented tuning values", () => {
    expect(sentimentNegationWindow).toBe(3);
    expect(smallCorpusThreshold).toBe(5);
    expect(topMarkerLimit).toBe(5);
    expect(demoCorpusSize).toBe(10);
  });
});
