<!-- Source artifact: art_ocJIIoS8 -->

# YardToonz Reactive — Product Specification

**Status:** Draft for human approval  
**Version:** 1.0  
**Date:** 2026-09-03  
**Product owner:** Stefen Ewers  
**Build context:** Obvious Frontier Build Atlanta

## 1. Product definition

Yard Toonz is a Jamaican AI-cartoon entertainment brand that turns culturally relevant moments into expressive, claymation-style comedy. It is not a children's gardening brand. In this product, **Reactive** means shortening the time between a culturally relevant moment and a publish-ready Yard Toonz cartoon.

YardToonz Reactive is an internal creator workflow for finding promising moments, deciding what is worth adapting, and moving one approved source through a traceable cartoon-production pipeline.

## 2. User problem

Producing a Yard Toonz video currently requires several disconnected decisions and tools: finding a relevant moment, judging whether the audience is responding to it, deciding whether it fits the brand, selecting a usable segment, transforming the visual style, animating it, restoring audio, and reviewing the result. The handoffs are manual and difficult to track. By the time the cartoon is ready, the cultural moment may have passed.

The problem is not a lack of creative judgment. The problem is production latency and fragmented execution.

## 3. Outcome

A Yard Toonz producer can move from a list of candidate moments to one reviewable, downloadable vertical cartoon through a single guided workflow, while retaining human control over creative selection, rights clearance, and final approval.

The MVP optimizes for **time to first reviewable cartoon**, not unattended publishing or maximum throughput.

## 4. Primary user

The initial user is a Yard Toonz producer who:

- understands Jamaican culture and the Yard Toonz comedic voice;
- decides which trends are relevant and appropriate;
- can confirm that source media and audio are authorized for use;
- needs production assistance without surrendering editorial control.

This is an internal creator tool. Multi-user collaboration is not required in the MVP.

## 5. Core workflow

1. Import at least ten candidate moments using seeded demo data, a CSV, or manual entry.
2. Review transparent scores for viral momentum, humor response, and Yard Toonz fit.
3. Select one candidate and explicitly confirm rights clearance.
4. Upload an authorized source video.
5. Choose or accept a suggested 5–8 second segment.
6. Start production and watch the job move through extraction, styling, animation, and audio muxing.
7. Preview the result, approve or reject it, and download the final 9:16 MP4.

## 6. Scoring model

The system must keep these judgments separate:

| Score | Question answered | MVP inputs |
| --- | --- | --- |
| Viral momentum | Is attention accelerating relative to the video's age? | Age, views, likes, comments, shares, saves when supplied |
| Humor response | Are viewers reacting as though the moment is funny? | Laugh language, emojis, quoted phrases, and supplied comment excerpts |
| Yard Toonz fit | Can this become a recognizable, concise Yard Toonz cartoon? | Clear premise, short payoff, usable audio, visual simplicity, cultural relevance |

Each score must be shown on a 0–100 scale with a short explanation. The MVP may use deterministic scoring rules and seeded explanations. It must not present the scores as objective truth.

The default overall score is:

`0.40 × viral momentum + 0.30 × humor response + 0.30 × Yard Toonz fit`

The individual scores remain visible because a high overall score must not conceal poor brand fit or unusable rights.

## 7. Success criteria

A human reviewer must be able to verify all of the following:

1. The user can load at least ten candidates from seeded data or a valid CSV and see source metadata, age, supplied engagement metrics, all three scores, an overall score, and scoring explanations.
2. The user can sort the candidate list, inspect one candidate, approve or reject it, and no media-processing job can start until rights clearance is explicitly confirmed.
3. The user can upload an MP4, preview it, and choose a segment between 5 and 8 seconds.
4. Starting production creates one traceable job whose current stage and completed stages are visible without reading logs.
5. In mock mode, the workflow produces a playable 9:16 MP4 with audio and a downloadable output without requiring OpenAI or Runway credentials.
6. A failed stage displays a useful error, preserves completed work, and can be retried without creating duplicate downstream assets.
7. The final output screen preserves the input, extracted clip, keyframe, styled frame, animation, and final video as a visible artifact lineage.

## 8. Locked product decisions

- **Human approval must remain in the loop.** The product recommends and orchestrates; it does not independently decide what Yard Toonz publishes.
- **Rights clearance is a hard gate.** No uploaded source may enter production without an explicit confirmation recorded with a timestamp.
- **No TikTok scraping in the MVP.** Candidate intake must use seeded data, CSV upload, or manual entry. Future discovery providers must plug into a provider interface.
- **Mock mode is a first-class path.** The complete demo must work without paid AI-provider keys or external network access.
- **Scoring dimensions must stay separate.** Sentiment alone is not a proxy for virality or humor.
- **Reactive means culturally timely.** The name does not imply a required frontend framework, although React may be selected in the technical specification.
- **Nothing publishes automatically.** Download is the final MVP action.

## 9. Not in scope

The MVP must not include:

- scraping TikTok, Instagram, YouTube, or other platforms;
- direct posting or scheduling to a social platform;
- automated downloading of third-party videos;
- authentication, teams, permissions, subscriptions, or billing;
- a general-purpose video editor;
- long-form episodes, multi-scene storytelling, or guaranteed character continuity across many shots;
- training a custom image or video model;
- claims that engagement scores predict future performance;
- unattended bulk generation.

## 10. Safety and editorial constraints

- Source media and audio must be owned, licensed, public-domain, or otherwise authorized by the operator.
- The workflow must not infer legal permission from a public URL.
- Generated content must remain subject to human review before download or publication.
- Satire must not be presented as factual reporting.
- The tool should preserve Jamaican specificity without turning language, accents, or people into generic caricatures.
- The MVP should avoid content involving private individuals, minors, active tragedies, or unsupported allegations.

## 11. Product analytics for the MVP

The local demo should record:

- number of candidates imported;
- number approved and rejected;
- time from production start to final output;
- success or failure by pipeline stage;
- whether mock or real providers were used.

No external analytics vendor is required.

## 12. Future direction

After the vertical slice is proven, later initiatives may add approved trend-data providers, better comment classification, a reusable character library, batch review, collaborative approvals, publishing integrations, and production-grade job infrastructure. None of those should expand the first initiative.

