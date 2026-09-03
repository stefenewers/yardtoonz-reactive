<!-- Source artifact: art_37lEeMmB -->

# YardToonz Reactive — Technical Specification

**Status:** Draft for human approval  
**Version:** 1.0  
**Date:** 2026-09-03  
**Depends on:** `01-product-spec.md`, `02-ux-spec.md`  
**Repository:** `stefenewers/yardtoonz-reactive`

## 1. Technical objective

Build a local-first, end-to-end vertical slice that turns an approved candidate and authorized source MP4 into a traceable, downloadable 9:16 video. The architecture must demonstrate durable engineering boundaries—typed contracts, a state machine, idempotent stages, provider abstractions, artifact lineage, tests, and human gates—without requiring production infrastructure or paid AI APIs for the demo.

The repository is greenfield. Paths in this specification are the intended source of truth for the initial structure.

## 2. Architecture decisions

### 2.1 Application shape

Use one TypeScript repository with:

- Next.js App Router for the creator dashboard and HTTP API;
- a separate Node.js worker process for media and provider stages;
- SQLite for local persistent state;
- Drizzle ORM for schema and typed database access;
- Zod for all external and cross-process input validation;
- FFmpeg/FFprobe installed on the host for media inspection and transformation;
- local filesystem artifact storage behind an interface;
- Vitest for unit and integration tests;
- Playwright for the single critical-path browser test if the environment supports it.

Use `npm` scripts so a new contributor can run the project without adopting additional workspace tooling.

### 2.2 Why this shape

- A single language reduces event-day integration overhead.
- A separate worker prevents long media jobs from occupying web requests.
- Database-backed job claiming survives browser refreshes and makes state visible.
- SQLite and local artifact storage make the demo deterministic and credential-free.
- Interfaces around discovery, image styling, animation, and storage preserve a path to production services later.

### 2.3 Deployment boundary

The MVP is a local demonstration. It must not claim production readiness or assume a serverless environment can run long-lived FFmpeg jobs. A later initiative may move the worker, database, and artifact storage to managed services without changing domain contracts.

## 3. Required repository structure

```text
/
├── AGENTS.md
├── README.md
├── .env.example
├── package.json
├── drizzle.config.ts
├── docs/
│   ├── product-spec.md
│   ├── ux-spec.md
│   ├── technical-spec.md
│   ├── brand-style-guide.md
│   └── demo-runbook.md
├── fixtures/
│   ├── candidates.csv
│   ├── comments.json
│   └── media/
├── public/
│   └── brand/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── candidates/route.ts
│   │   │   ├── candidates/import/route.ts
│   │   │   ├── productions/route.ts
│   │   │   ├── productions/[id]/route.ts
│   │   │   ├── productions/[id]/source/route.ts
│   │   │   ├── productions/[id]/start/route.ts
│   │   │   ├── productions/[id]/retry/route.ts
│   │   │   ├── productions/[id]/decision/route.ts
│   │   │   └── artifacts/[id]/route.ts
│   │   ├── candidates/[id]/page.tsx
│   │   ├── productions/[id]/page.tsx
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── candidate-table.tsx
│   │   ├── score-breakdown.tsx
│   │   ├── rights-gate.tsx
│   │   ├── segment-selector.tsx
│   │   ├── pipeline-timeline.tsx
│   │   └── artifact-lineage.tsx
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema.ts
│   │   └── migrations/
│   ├── domain/
│   │   ├── candidate.ts
│   │   ├── production.ts
│   │   ├── scoring.ts
│   │   └── state-machine.ts
│   ├── providers/
│   │   ├── contracts.ts
│   │   ├── candidate/
│   │   ├── image/
│   │   ├── animation/
│   │   └── storage/
│   ├── services/
│   │   ├── candidate-service.ts
│   │   ├── production-service.ts
│   │   ├── artifact-service.ts
│   │   └── media-service.ts
│   ├── worker/
│   │   ├── index.ts
│   │   ├── claim-job.ts
│   │   └── stages/
│   └── lib/
│       ├── env.ts
│       ├── errors.ts
│       └── logger.ts
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

If the selected framework version requires small path adjustments, record them in the technical-spec PR before dependent implementation begins.

## 4. Domain contracts

These contracts are normative. Implement equivalent Zod schemas at system boundaries.

```ts
export type CandidateStatus = "NEW" | "APPROVED" | "REJECTED";
export type SourcePlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "OTHER";

export interface EngagementMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}

export interface ScoreEvidence {
  score: number; // integer, 0–100
  explanation: string;
  inputsUsed: string[];
}

export interface CandidateScores {
  viralMomentum: ScoreEvidence;
  humorResponse: ScoreEvidence;
  yardToonzFit: ScoreEvidence;
  overall: number; // rounded weighted score, 0–100
  scoringVersion: string;
}

export interface Candidate {
  id: string;
  platform: SourcePlatform;
  sourceUrl?: string;
  sourceLabel: string;
  caption: string;
  publishedAt?: string;
  observedAt: string;
  metrics: EngagementMetrics;
  commentExcerpts: string[];
  adaptationNote?: string;
  scores: CandidateScores;
  status: CandidateStatus;
  decisionReason?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

```ts
export type ProviderMode = "MOCK" | "LIVE";

export type ProductionStatus =
  | "DRAFT"
  | "RIGHTS_CONFIRMED"
  | "QUEUED"
  | "EXTRACTING"
  | "STYLING"
  | "ANIMATING"
  | "MUXING"
  | "VALIDATING"
  | "COMPLETE"
  | "FAILED";

export type StageName =
  | "INGEST_SOURCE"
  | "EXTRACT_MEDIA"
  | "SELECT_KEYFRAME"
  | "STYLE_IMAGE"
  | "ANIMATE_IMAGE"
  | "MUX_AND_NORMALIZE"
  | "VALIDATE_OUTPUT";

export type StageStatus = "WAITING" | "RUNNING" | "COMPLETE" | "FAILED";

export interface RightsConfirmation {
  confirmed: true;
  confirmedAt: string;
  confirmationTextVersion: string;
}

export interface SegmentSelection {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number; // must be between 5 and 8 inclusive
}

export interface ProductionJob {
  id: string;
  candidateId: string;
  status: ProductionStatus;
  providerMode: ProviderMode;
  segment: SegmentSelection;
  creativeDirection?: string;
  rights?: RightsConfirmation;
  activeStage?: StageName;
  attempt: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

```ts
export type ArtifactKind =
  | "SOURCE_VIDEO"
  | "EXTRACTED_CLIP"
  | "EXTRACTED_AUDIO"
  | "KEYFRAME"
  | "STYLED_FRAME"
  | "SILENT_ANIMATION"
  | "FINAL_VIDEO";

export interface ArtifactRecord {
  id: string;
  productionId: string;
  stage: StageName;
  kind: ArtifactKind;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  parentArtifactIds: string[];
  provider: string;
  providerRequestId?: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}
```

## 5. Provider interfaces

```ts
export interface CandidateProvider {
  import(input: unknown): Promise<Candidate[]>;
}

export interface ImageStyleProvider {
  readonly name: string;
  style(input: {
    keyframePath: string;
    prompt: string;
    productionId: string;
  }): Promise<{ outputPath: string; requestId?: string }>;
}

export interface AnimationProvider {
  readonly name: string;
  animate(input: {
    imagePath: string;
    durationSeconds: number;
    prompt: string;
    productionId: string;
  }): Promise<{ outputPath: string; requestId?: string }>;
}

export interface ArtifactStore {
  put(input: {
    sourcePath: string;
    storageKey: string;
    mimeType: string;
  }): Promise<{ storageKey: string; byteSize: number; sha256: string }>;

  resolve(storageKey: string): Promise<string>;
}
```

Required implementations:

| Interface | MVP implementation | Optional live implementation |
| --- | --- | --- |
| `CandidateProvider` | Seeded fixture, CSV, manual entry | Approved social-data provider later |
| `ImageStyleProvider` | Deterministic fixture or local stylization fallback | OpenAI image edit/generation adapter |
| `AnimationProvider` | FFmpeg pan/zoom animation from styled frame | Runway image-to-video adapter |
| `ArtifactStore` | Local filesystem under configured data directory | Object storage later |

The application must choose providers from validated environment configuration, not conditional logic scattered across pages or stages.

## 6. Scoring behavior

Implement scoring as pure functions in `src/domain/scoring.ts`.

### Viral momentum

Use only supplied data. Normalize engagement relative to source age when `publishedAt` is present. Treat missing metrics as missing—not zero—and lower confidence in the explanation. Cap individual features before combining them so a single extreme count does not dominate.

### Humor response

For the deterministic MVP, count configured laugh expressions, emojis, and positive comedic reaction patterns in supplied comment excerpts. The explanation must disclose when no comments were supplied. Do not label general positive sentiment as laughter.

### Yard Toonz fit

Use an explicit checklist supplied in the candidate fixture or manual review:

- clear premise;
- recognizable subject or scenario;
- payoff within eight seconds;
- usable authorized audio;
- visually simple enough for a single-shot adaptation;
- culturally relevant to the target audience.

Do not invent brand-fit evidence from engagement counts.

### Overall score

Use the locked 40/30/30 weighting from the product spec. Store `scoringVersion` with every result so future formula changes remain auditable.

## 7. State machine and invariants

Allowed forward path:

```text
DRAFT
  → RIGHTS_CONFIRMED
  → QUEUED
  → EXTRACTING
  → STYLING
  → ANIMATING
  → MUXING
  → VALIDATING
  → COMPLETE
```

`FAILED` may be entered from any worker-owned stage. Retry returns to the failed stage after verifying its upstream artifacts.

Hard invariants:

1. `RIGHTS_CONFIRMED` requires a persisted `RightsConfirmation` with a timestamp.
2. A job must never enter `QUEUED` without a valid 5–8 second segment and an approved candidate.
3. At most one worker may own a job stage at a time.
4. A stage marked `COMPLETE` must have every required artifact recorded and present in storage.
5. Retrying a stage must reuse valid upstream artifacts and replace or reuse only the failed stage's incomplete outputs.
6. Repeating the same stage with the same input fingerprint must not create duplicate artifact records.
7. `COMPLETE` requires a successful validation report confirming 9:16 dimensions, duration tolerance, playable video, and an audio stream.

Implement transitions through one domain function. Route handlers and UI components must not directly assign arbitrary production statuses.

## 8. Media pipeline

### 8.1 Ingest source

- Accept MP4 only in the MVP.
- Sanitize filenames and generate internal storage keys; never execute or interpolate user-supplied names.
- Enforce a configurable size limit before persistence.
- Run FFprobe and store duration, dimensions, codecs, and audio-stream presence.

### 8.2 Extract media

- Extract the chosen 5–8 second clip.
- Extract the corresponding authorized audio track.
- Normalize timestamps from zero.
- Record all FFmpeg arguments and exit status in structured internal logs without displaying raw commands to the user.

### 8.3 Select keyframe

- Choose a frame near the temporal midpoint by default.
- Produce a JPEG or PNG suitable for the image provider.
- Store the exact source timestamp in artifact metadata.

### 8.4 Style image

- Build the prompt using the rules in `04-brand-style-guide.md` plus the producer's creative-direction note.
- In mock mode, use a deterministic, repository-controlled demo fixture when available. For arbitrary sources, produce a visibly labeled local fallback rather than pretending an AI transformation occurred.
- In live mode, call the configured image provider once per input fingerprint and persist the provider request ID.

### 8.5 Animate image

- In mock mode, use FFmpeg to create a subtle 5–8 second pan/zoom animation from the styled frame.
- In live mode, submit the styled frame and motion prompt to the animation provider, poll with bounded backoff, and persist the provider request ID.
- Never retry a live submission blindly when its remote outcome is unknown; reconcile by request ID first.

### 8.6 Mux and normalize

- Combine the animation with the extracted authorized audio.
- Output an MP4 in 9:16 orientation, using a broadly playable H.264 video stream and AAC audio stream.
- Fit or pad visual content without stretching faces.
- Keep final duration aligned to the selected segment within a small documented tolerance.

### 8.7 Validate output

FFprobe must confirm:

- output exists and is non-empty;
- output is playable by the probe;
- display aspect ratio is 9:16;
- duration matches the selected segment within tolerance;
- at least one video stream and one audio stream exist.

Only then may the job enter `COMPLETE`.

Invoke FFmpeg and FFprobe with argument arrays through a process API. Do not construct shell command strings from user input.

## 9. Persistence model

Create tables for:

- `candidates`
- `candidate_comments`
- `productions`
- `production_stages`
- `artifacts`
- `editorial_decisions`

Use UTC ISO timestamps at API boundaries and database-native timestamps internally. Use generated opaque IDs. Foreign keys must prevent orphan stage and artifact rows.

`production_stages` stores stage name, status, attempt, input fingerprint, started/completed timestamps, error code, safe error message, and worker lease data.

`editorial_decisions` stores candidate approval/rejection and output approval/rejection separately, with optional notes.

## 10. API contracts

| Method and route | Behavior |
| --- | --- |
| `GET /api/candidates` | List candidates with filters and sort; default overall descending |
| `POST /api/candidates/import` | Import seeded candidates or validated CSV |
| `PATCH /api/candidates/:id` | Approve, reject, or restore a candidate |
| `POST /api/productions` | Create draft production for an approved candidate |
| `POST /api/productions/:id/source` | Upload and probe authorized source MP4 |
| `PATCH /api/productions/:id` | Save segment, creative direction, or rights confirmation |
| `POST /api/productions/:id/start` | Validate gates and atomically queue job |
| `GET /api/productions/:id` | Return job, stages, artifacts, and safe errors |
| `POST /api/productions/:id/retry` | Retry the failed stage idempotently |
| `POST /api/productions/:id/decision` | Approve or reject final output |
| `GET /api/artifacts/:id` | Stream an authorized local artifact with correct content type |

Every mutating route must validate input with Zod and return stable error codes. UI copy maps from error codes; it must not depend on parsing exception messages.

## 11. Environment contract

`.env.example` must include non-secret placeholders for:

```dotenv
DATABASE_URL=file:./.data/yardtoonz.db
ARTIFACT_ROOT=./.data/artifacts
PROVIDER_MODE=MOCK
MAX_UPLOAD_MB=100
WORKER_POLL_MS=1000

# Optional live providers
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=
RUNWAY_API_KEY=
RUNWAY_MODEL=
```

The application must fail fast on invalid configuration. `PROVIDER_MODE=LIVE` must fail startup unless every required live credential and model setting is present. Secrets must never be committed, logged, returned from APIs, or embedded in browser bundles.

## 12. Observability

Use structured logs with:

- request or job ID;
- production ID;
- stage;
- attempt;
- provider and provider mode;
- elapsed time;
- stable error code.

Do not log source file contents, provider credentials, or full user-supplied creative prompts by default.

Expose a small local health endpoint covering database access, artifact-root writability, FFmpeg availability, and worker heartbeat.

## 13. Testing requirements

Tests must ship in the same PR as the behavior they verify.

### Unit tests

- scoring with complete and partial metrics;
- humor scoring without comment evidence;
- overall weighting and score bounds;
- all legal and illegal state transitions;
- segment-duration validation;
- rights gate;
- provider selection from environment;
- input fingerprint and idempotency behavior.

### Integration tests

- import seeded candidates and CSV candidates;
- approve candidate and create production;
- reject start when rights are missing;
- complete all stages with mock providers;
- retry a seeded failed stage without duplicating completed artifacts;
- validate final MP4 contains video and audio when FFmpeg is available.

### Browser test

Cover the acceptance walkthrough in `02-ux-spec.md` with the smallest reliable Playwright flow. If browser automation cannot run in the build environment, record the reason and include an executable manual QA checklist; do not silently omit validation.

### Quality gate

The repository must expose one command, preferably `npm run check`, that runs formatting verification, lint, TypeScript checking, unit tests, integration tests, and production build. Media-dependent tests may be separately tagged but must run in the configured Autobuild sandbox when FFmpeg is installed.

## 14. Security and rights requirements

- Treat uploads as untrusted input.
- Enforce MIME/type checks and inspect actual media with FFprobe.
- Store outside publicly executable paths and serve through controlled routes.
- Prevent path traversal by generating storage keys internally.
- Never download a video merely because a candidate includes a public URL.
- Require the persisted rights confirmation before queueing.
- Rate-limit or otherwise guard repeated production starts in any shared environment.
- Never expose live provider keys to the client.

## 15. Build decomposition and dependencies

Autobuild should propose the initiative using the following reviewable sequence. It may split a feature into smaller executables, but it must preserve these dependencies.

| Order | Feature | Required output | Depends on |
| --- | --- | --- | --- |
| 1 | Repository foundation | Next.js app, scripts, DB schema, configuration, health check, CI/check command | None |
| 2 | Candidate intake and scoring | Domain types, seeded/CSV providers, pure scoring, candidate APIs, tests | 1 |
| 3 | Editorial candidate UI | Candidate table/detail, score explanations, approve/reject flow, UX states | 2 |
| 4 | Production engine | Rights gate, source upload, state machine, worker, artifact store, FFmpeg mock pipeline, tests | 1, 2 |
| 5 | Production UI | Setup, job timeline, artifact lineage, retry, preview, output decision/download | 3, 4 |
| 6 | Live provider adapters and demo hardening | OpenAI/Runway adapters behind env flags, full quality gate, runbook verification | 4, 5 |

Live adapters may be deferred if event time or credentials are insufficient. Mock-mode acceptance is not deferrable.

## 16. Human review gates

- Do not merge a PR with failing checks.
- Require human review before every merge.
- Verify migrations and contracts before merging dependent PRs.
- Verify the rights gate manually before accepting the production-engine PR.
- Run the complete mock demo before enabling live providers.
- If a PR changes a locked product decision, pause and update the appropriate spec before continuing.

## 17. What not to build

Do not add social scraping, platform publishing, authentication, billing, distributed queues, Kubernetes, model training, a timeline editor, multi-scene generation, or generalized workflow-builder abstractions. Do not replace the explicit state machine with an untyped collection of booleans. Do not make live providers a prerequisite for local development or CI.
