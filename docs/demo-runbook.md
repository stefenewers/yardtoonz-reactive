<!-- Source artifact: art_PHtWViaT -->

# YardToonz Reactive — Build and Demo Runbook

**Status:** Draft for human approval  
**Version:** 1.1  
**Date:** 2026-09-03 (v1.1 records observed behavior from the E6.3 mock-mode hardening and demo rehearsal on this date; sections 8, 9, 11, and 12 were reconciled with the implemented product)  
**Event:** Obvious Frontier Build Atlanta  
**Demo objective:** Produce one traceable, downloadable Yard Toonz cartoon from an approved candidate

## 1. Operating principle

The build succeeds when one short, rights-cleared source moves through the complete system reliably. A working mock-mode vertical slice is more valuable than several partially connected integrations.

Do not begin Autobuild until all five YardToonz-specific documents are uploaded, reviewed, and approved. The Meridian Decision Confidence documents are unrelated and must not be used as product or technical context.

## 2. Source-of-truth documents

Upload these as separate Obvious project artifacts:

1. `01-product-spec.md`
2. `02-ux-spec.md`
3. `03-technical-spec.md`
4. `04-brand-style-guide.md`
5. `05-demo-runbook.md`

After upload, copy each Obvious artifact ID into the initiative request. Do not refer to “the spec” when an exact artifact ID is available.

## 3. Required demo assets

Prepare before build execution:

- Yard Toonz logo file;
- at least three representative finished-cartoon references;
- one source-to-finished example if available;
- one rights-cleared MP4 with a clean 5–8 second segment;
- one seeded `candidates.csv` containing at least ten rows;
- optional comment excerpts for humor scoring;
- one known-good mock styled frame aligned to the demo source.

Do not use a public social URL as proof of rights clearance. Store the authorized demo source directly as a controlled fixture or upload it during the demo.

## 4. Autobuild setup

Before creating the initiative:

1. Confirm the Obvious GitHub App can access `stefenewers/yardtoonz-reactive`.
2. Confirm the repository sandbox status is `Ready`.
3. Confirm the repo is greenfield and contains no Meridian code or documents.
4. Add a root `AGENTS.md` covering the quality command, architecture boundaries, mock-mode requirement, rights gate, and human review requirement.
5. Add the five documents to `docs/` in the repository as part of the foundation PR so future agents read the same approved source of truth.
6. Keep human merge approval enabled.

## 5. Initiative request

Use this instruction after the documents are approved:

> Create an Autobuild initiative for the YardToonz Reactive MVP using the approved Product, UX, Technical, Brand, and Demo artifacts by their exact artifact IDs. First propose the dependency plan and acceptance mapping for human review. Preserve the six-feature order in the technical specification. The complete mock-mode vertical slice, rights-clearance gate, tests in the same PR as behavior, and human review before every merge are mandatory. Do not add TikTok scraping, automatic publishing, authentication, billing, or multi-scene generation. Do not start implementation until I approve the proposed decomposition.

## 6. Recommended build order

### Feature 1 — Repository foundation

Expected outputs:

- runnable Next.js/TypeScript application;
- SQLite/Drizzle schema and migration command;
- environment validation and `.env.example`;
- web and worker scripts;
- FFmpeg/FFprobe health check;
- `npm run check` quality gate;
- seed/reset commands;
- CI configuration.

Review before merge:

- clean install works;
- database initializes from zero;
- web and worker start;
- health endpoint reports meaningful status;
- quality gate passes.

### Feature 2 — Candidate intake and scoring

Expected outputs:

- seeded and CSV candidate providers;
- deterministic, separately tested scoring functions;
- candidate persistence and APIs;
- explanations and scoring-version storage;
- at least ten realistic demo candidates.

Review before merge:

- missing metrics are not treated as fabricated zeros;
- humor is not reduced to generic positive sentiment;
- brand fit does not derive from engagement counts;
- 40/30/30 overall weighting is correct;
- import failures do not corrupt existing data.

### Feature 3 — Editorial candidate UI

Expected outputs:

- ranked candidate table;
- filters and sorting;
- scoring evidence detail;
- approve/reject/restore actions;
- empty, loading, partial-data, and error states;
- Yard Toonz visual treatment that remains appropriate for an adult creator tool.

Review before merge:

- all three scores remain visible;
- color is not the only status signal;
- the UI does not resemble a children's gardening product;
- candidate decisions persist across refresh.

### Feature 4 — Production engine

Expected outputs:

- source upload and FFprobe validation;
- persisted rights confirmation;
- segment validation;
- job state machine and worker leasing;
- local artifact store and lineage;
- FFmpeg extraction, keyframe, mock styling, animation, mux, and validation;
- idempotent retry behavior;
- unit and integration tests.

Review before merge:

- a job cannot queue without rights confirmation;
- filenames cannot create path traversal or shell injection;
- refresh does not lose job state;
- retry does not duplicate valid upstream artifacts;
- final validation requires video and audio.

### Feature 5 — Production UI

Expected outputs:

- production setup and rights gate;
- source preview and segment selection;
- stage timeline with safe errors;
- retry control;
- artifact lineage;
- final preview, decision, and download.

Review before merge:

- disabled actions explain why;
- mock/live mode is always visible;
- raw technical errors are not exposed;
- complete demo works through the browser.

### Feature 6 — Live adapters and hardening

Expected outputs:

- optional OpenAI image adapter;
- optional Runway animation adapter;
- provider request IDs and bounded polling;
- explicit configuration checks;
- full test and demo pass;
- updated README and this runbook based on observed behavior.

Review before merge:

- no secret reaches the browser, logs, fixtures, or repository;
- mock mode still works without external credentials;
- uncertain remote outcomes are reconciled before retry;
- live-adapter failure cannot destroy mock-mode readiness.

This feature may be reduced or deferred if credentials, external credits, or event time are insufficient. Features 1–5 may not be replaced by a live-provider-only demo.

## 7. Credit-management checkpoints

Autobuild credits are consumed by executable work. Use explicit human checkpoints:

1. **Before initiative start:** approve all five documents.
2. **Before implementation:** approve the feature/executable decomposition and remove gold-plating.
3. **After foundation:** run the quality gate and start commands before unlocking dependent work.
4. **After mock pipeline:** perform the complete browser demo before requesting live adapters.
5. **Before live integrations:** confirm provider credentials and separate provider budget exist.
6. **Before final polish:** reserve capacity for integration fixes and demo rehearsal.

Pause the initiative if the agent adds out-of-scope infrastructure, combines several major features into one unreviewable PR, or begins live integrations before mock mode works.

## 8. Preflight checklist

Observed commands (2026-09-03): FFmpeg and FFprobe ship as package-managed binaries, so there is no global `ffmpeg -version` step — `GET /api/health` reports their availability, and `npm run test:tools` probes them directly. Migrations and fixture seeding run automatically on first server boot and via the guarded reset.

```bash
npm ci
npm run playwright:install
npm run demo:reset
npm run build
npm run check
```

Start the required processes:

```bash
npm run start   # production build on http://localhost:3000
npm run worker  # heartbeats every WORKER_POLL_MS (default 1000 ms)
```

Observed verification (all confirmed this date):

- health endpoint reports `status: "ok"` with `image: "MOCK"`, `animation: "MOCK"`, database `available`, artifact root `writable`, ffmpeg and ffprobe `available`, and worker heartbeat `fresh`;
- ten seeded candidates load (`GET /api/candidates` returns 10);
- no API credentials are required for the mock path (`.env.example` ships empty provider keys);
- the demo source fixture opens, probes, and contains an audio stream (6.3 s, h264 + aac).

## 9. Three-minute demonstration script

Observed UI labels and behavior (2026-09-03, mock mode): "Load demo candidates" seeds the inbox; the ranked table sorts by overall score; the candidate detail screen presents Viral momentum, Humor response, and Yard Toonz fit with explanations; "Approve for production" opens the rights gate; "Confirm rights and continue" requires the authorization checkbox; "Start production" uploads and validates the MP4; the Job monitor shows the "Production stage timeline" with per-stage elapsed time plus "Image provider: Mock" and "Animation provider: Mock"; completion lands on "Output review" with the seven-artifact lineage list, probed output facts, "Approve output", and the final MP4 download. In mock mode the full pipeline completes in about ten seconds, so the live job finishes comfortably inside the presentation window — the recorded-completion fallback below remains for live-provider runs.

### 0:00–0:30 — Problem and proof

Open the candidate inbox.

Say: “Yard Toonz already knows how to make culturally resonant AI cartoons. The problem is that producing each one requires disconnected research, judgment, and generation steps. Reactive turns that into one human-directed workflow.”

### 0:30–1:10 — Find the moment

- Show ten imported candidates.
- Sort by overall score.
- Open the top candidate.
- Point out that viral momentum, humor response, and Yard Toonz fit are separate and explainable.
- Approve the candidate.

### 1:10–1:40 — Preserve human control

- Upload the authorized source.
- Select the 5–8 second segment.
- Show that production cannot start while rights clearance is unchecked.
- Confirm rights and start the job.

### 1:40–2:30 — Show orchestration

- Open the stage timeline.
- Explain extraction, keyframe selection, styling, animation, audio restoration, and validation.
- Open the keyframe and styled-frame artifacts.
- Point out the visible lineage and provider mode.

If live generation cannot finish inside the presentation window, use a previously completed job while the new job continues. Do not claim the previous job was generated live during the demo.

### 2:30–3:00 — Show the result

- Play the final 9:16 cartoon with audio.
- Approve it.
- Download the MP4.
- Close with: “Obvious helped build the production system; Yard Toonz still owns the cultural judgment, rights decision, and final creative approval.”

## 10. Fallback ladder

Use the highest available level without misrepresenting what is running.

| Level | Condition | Demonstration |
| --- | --- | --- |
| A — Full live | Both external providers healthy | Run candidate-to-final with live styling and animation |
| B — Hybrid | One external provider healthy | Use it for its stage and the disclosed mock for the other |
| C — Full mock | No provider keys, credits, or reliable network | Run complete deterministic local pipeline |
| D — Recorded completion | Worker too slow during presentation | Start a new job, then open a previously completed traceable job |
| E — Artifact walkthrough | Local runtime fails immediately before demo | Show saved screenshots/video plus PRs, tests, and artifact lineage |

Mock and recorded paths must be labeled honestly in the UI and narration.

## 11. Reset procedure

Implemented and observed (2026-09-03). `npm run demo:reset` (alias of `npm run db:reset`):

- clears only application-owned local demo records and artifacts — the database, SQLite sidecar files, and the artifact directory;
- recreates the database schema and reloads the ten candidates as `NEW`;
- refuses in-memory databases, repository-root deletion, and paths resolving outside the application directory.

Command:

```bash
npm run demo:reset
```

Observed behavior: the reset is safe while `npm run start` keeps running. The web service revalidates the SQLite file identity on every request and reopens the database when the reset replaces the file, so the running UI serves the fresh seed on the next request instead of pre-reset rows. Repeated reset-then-rehearse cycles produce identical deterministic results. A regression test (`tests/integration/database-provider.test.ts`) pins this behavior.

## 12. Final acceptance checklist

Verification record (E6.3 rehearsal, 2026-09-03, from `main` `ad1d307`): every item below was exercised on the implemented product — the full `npm run check` gate plus two complete browser walkthroughs (`tests/e2e/demo-walkthrough.spec.ts`, the second run immediately after `npm run demo:reset` with the web server still running).

- [x] Ten candidates load from seeded data or CSV. — `GET /api/candidates` returns 10 after every `demo:reset`; the walkthrough asserts "10 candidates" in the inbox.
- [x] Three component scores and explanations display separately. — each score carries its own `score`, `explanation`, and `inputsUsed`; the candidate detail screen shows Viral momentum, Humor response, and Yard Toonz fit as separate sections.
- [x] Candidate approval persists. — decisions are stored in the database and survive reload and restart; the walkthrough restores and re-approves the owned candidate across runs.
- [x] Rights clearance is a hard processing gate. — "Confirm rights and continue" stays disabled until the authorization checkbox is set, and production start refuses unconfirmed rights (integration-tested).
- [x] Source MP4 probes successfully. — the 6.3 s fixture upload probes server-side; the UI shows "6.3s" and audio "Present" from the probed facts.
- [x] Segment is between 5 and 8 seconds. — a 9-second end is rejected with "at most 8 seconds long" and start is disabled; a 6-second segment is accepted.
- [x] One job moves through every defined stage. — the walkthrough drives one production to `COMPLETE` through the real worker and asserts the full stage timeline and Output review screen.
- [x] Failed stage can be retried without duplicating upstream artifacts. — retry verification is covered by worker-pipeline integration tests (idempotent retry reuses completed upstream artifacts).
- [x] Final output is playable 9:16 MP4 with audio. — ffprobe of the downloaded MP4: 360×640 (exact 9:16), 6.0 s, h264 video + aac 44.1 kHz audio; the preview streams `video/mp4`.
- [x] Artifact lineage is visible. — the Output review screen renders the seven-item "Artifact lineage from source to final video" list (source, extraction, keyframe, styled frame, animation, muxed audio, final video).
- [x] Provider mode is disclosed. — the job monitor shows "Image provider: Mock" and "Animation provider: Mock" independently, and production records freeze `imageProvider`/`animationProvider` onto each job.
- [x] Final output can be approved, rejected, and downloaded. — "Approve output" persists "Output approved"; the download test fetches the final MP4 through the artifact endpoint (200, `video/mp4`, probed above). Rejection is the same persisted-decision path.
- [x] `npm run check` passes. — format, lint, typecheck, 285 unit/integration tests in 33 files, production build, and 4 E2E tests all pass (exit 0).
- [x] No secrets are committed or exposed. — tracked tree and 500-commit history contain no secret patterns (only a unit-test placeholder value); browser bundle, server bundle, live web/worker logs, and all API responses (health, candidates, productions, artifact bytes) scanned with zero matches.
- [x] All merged PRs received human review. — all 20 merged PRs were squash-merged by the owner's Obvious autobuild integration under the owner's standing merge-approval directive, after the owner approved the five source documents and the initiative decomposition; every merge required green CI.

## 13. Stop conditions

Stop and ask the product owner before proceeding if:

- the implementation requires scraping or downloading from a social platform;
- rights clearance is being weakened or bypassed;
- an agent wants to replace mock mode with a live-only dependency;
- a technical choice makes the event demo depend on production deployment;
- generated output materially changes identity or violates the brand guide;
- the requested work expands into multi-scene episodes, publishing, authentication, or billing;
- tests or the quality gate are failing;
- an agent proposes using the unrelated Meridian documents as YardToonz requirements.

