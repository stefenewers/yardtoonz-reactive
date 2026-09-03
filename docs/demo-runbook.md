<!-- Source artifact: art_PHtWViaT -->

# YardToonz Reactive — Build and Demo Runbook

**Status:** Draft for human approval  
**Version:** 1.0  
**Date:** 2026-09-03  
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

Run these checks before the first full demo. Commands are expected contracts; adjust only if the approved technical-spec PR records a different command.

```bash
npm ci
npm run db:migrate
npm run seed
npm run check
ffmpeg -version
ffprobe -version
```

Start the required processes:

```bash
npm run dev
npm run worker
```

Verify:

- provider mode displays `Mock`;
- health endpoint confirms database, artifact directory, FFmpeg, and worker heartbeat;
- ten seeded candidates exist;
- the demo source opens and contains an audio stream;
- the artifact directory is writable;
- no API credentials are required for the mock path.

## 9. Three-minute demonstration script

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

The repository should expose a non-destructive demo reset that:

- clears only application-owned local demo records and artifacts;
- recreates the database schema;
- reloads the ten candidates;
- restores the known-good mock fixtures;
- never targets the repository root or an unresolved environment path.

Expected command:

```bash
npm run demo:reset
```

The implementation must validate the configured data directory before deleting application-owned contents.

## 12. Final acceptance checklist

- [ ] Ten candidates load from seeded data or CSV.
- [ ] Three component scores and explanations display separately.
- [ ] Candidate approval persists.
- [ ] Rights clearance is a hard processing gate.
- [ ] Source MP4 probes successfully.
- [ ] Segment is between 5 and 8 seconds.
- [ ] One job moves through every defined stage.
- [ ] Failed stage can be retried without duplicating upstream artifacts.
- [ ] Final output is playable 9:16 MP4 with audio.
- [ ] Artifact lineage is visible.
- [ ] Provider mode is disclosed.
- [ ] Final output can be approved, rejected, and downloaded.
- [ ] `npm run check` passes.
- [ ] No secrets are committed or exposed.
- [ ] All merged PRs received human review.

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

