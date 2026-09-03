# YardToonz Reactive

YardToonz Reactive is a local-first creator workflow for turning an approved, rights-cleared source moment into a traceable Yard Toonz cartoon. This foundation PR establishes the Next.js/TypeScript application, validated server configuration, repository quality gate, and locally provisioned media/browser tooling. Product features arrive in later reviewed PRs.

## Requirements

- Node.js 20.20.2
- npm 10.8.2

No globally installed FFmpeg or FFprobe is required. `npm ci` installs platform-specific binaries through `ffmpeg-static` and `@ffprobe-installer/ffprobe`. Playwright browser provisioning is explicit by host platform: Linux CI and sandboxes use `@sparticuz/chromium` 147 with its package-bundled libraries, while macOS and Windows use Playwright's standard managed Chromium matched to Playwright 1.59. `npm run playwright:install` provisions and executes the selected browser without modifying the sandbox image.

The tradeoff is a larger dependency install and browser downloads that differ by platform. The benefit is a reproducible package-local Linux path without privileged installation while retaining the supported Playwright path for non-Linux contributors. Pure selection tests cover Linux, macOS, and Windows without requiring every browser binary to be installed during the unit suite.

## Setup

```bash
npm ci
cp .env.example .env.local
npm run playwright:install
npm run dev
```

Open <http://localhost:3000>. The default `IMAGE_PROVIDER=MOCK` and `ANIMATION_PROVIDER=MOCK` configuration requires no OpenAI or Runway credentials.

## Commands

| Command                      | Purpose                                                           |
| ---------------------------- | ----------------------------------------------------------------- |
| `npm run dev`                | Start the development server                                      |
| `npm run build`              | Build the production application                                  |
| `npm run start`              | Start the built application                                       |
| `npm run worker`             | Start the local production worker and its heartbeat               |
| `npm run test`               | Run Vitest tests                                                  |
| `npm run test:tools`         | Verify the package-managed FFmpeg and FFprobe binaries            |
| `npm run test:e2e`           | Run the Playwright browser smoke test against a production build  |
| `npm run playwright:install` | Provision and verify the platform-selected Chromium runtime       |
| `npm run db:generate`        | Generate an additive migration from the Drizzle schema            |
| `npm run db:seed`            | Seed candidate fixtures when the configured database is empty     |
| `npm run db:reset`           | Recreate local demo data and seed the same candidate fixtures     |
| `npm run demo:reset`         | Alias the guarded database and artifact reset for demo rehearsals |
| `npm run check`              | Run formatting, lint, types, tests, build, and browser QA         |

CI runs `npm run playwright:install` followed by the same `npm run check` command contributors run locally.

## Local persistence

SQLite migrations create the six specification tables for candidates, comments, productions, stages, artifacts, and editorial decisions, plus the existing rights-confirmation hard gate and the operational `worker_heartbeats` table used by the health endpoint. Production timestamps use SQLite integer milliseconds internally, while the candidate API continues to expose UTC ISO timestamps.

`npm run db:reset` removes only the configured database, SQLite sidecar files, and artifact directory when all paths resolve inside the application directory. It then applies every migration and loads the deterministic candidate fixtures. The command refuses in-memory databases, repository-root deletion, and paths outside the application directory.

## Candidate intake

Candidate intake plugs into a provider interface (`src/server/candidates/intake.ts`) with three implementations, matching the no-scraping MVP constraint: `SEEDED` (the validated fixtures in `fixtures/candidates.ts`), `CSV` (uploaded text), and `MANUAL` (a single entry). `importCandidates` validates every payload with Zod, computes scores through the shared scoring domain, refuses duplicate ids, and persists each batch in one transaction without touching existing candidates or comments — importing zero rows is a no-op, and a failed import leaves data unchanged.

The CSV provider accepts a header row plus one row per candidate. Required columns: `platform`, `sourceLabel`, `caption`, `observedAt`, and the six fit-checklist booleans (`clearPremise`, `recognizableScenario`, `payoffWithinEightSeconds`, `authorizedAudio`, `visuallySimple`, `culturallyRelevant`). Optional columns: `id` (generated when omitted), `sourceUrl`, `publishedAt`, `views`, `likes`, `comments`, `shares`, `saves`, `adaptationNote`, and `commentExcerpts` — multiple excerpts ride in one cell separated by `;;`. Unknown or missing columns are rejected with the offending column names.

## Environment validation

Server configuration is parsed by Zod in `src/lib/env-schema.ts` and loaded only through `src/lib/env.ts`. Invalid numeric values fail startup. Image and animation providers are selected independently, so mock/mock, OpenAI/mock, mock/Runway, and OpenAI/Runway configurations are representable. OpenAI settings are required only when `IMAGE_PROVIDER=OPENAI`; Runway settings are required only when `ANIMATION_PROVIDER=RUNWAY`. Live adapters remain intentionally outside this PR.

Validated stored-record contracts in `src/lib/production-records.ts` freeze both resolved selections onto each production job and require every artifact to name its actual producer (`USER_UPLOAD`, `FFMPEG`, `MOCK`, `OPENAI`, or `RUNWAY`). These contracts establish the persistence boundary for the later SQLite/Drizzle implementation without introducing live provider calls in the foundation.

## Health and observability

`GET /api/health` aggregates four checks and reports only bounded diagnostic categories — never secrets, filesystem paths, version output, or raw exceptions:

| Check            | Categories                                                                  |
| ---------------- | --------------------------------------------------------------------------- |
| Database         | `available`, `unavailable`                                                  |
| Artifact root    | `writable`, `unwritable`                                                    |
| Media tools      | `available`, `binary-unavailable`, `timed-out`, `execution-failed` per tool |
| Worker heartbeat | `fresh`, `stale`, `unknown`                                                 |

The aggregate `status` degrades only when the web service itself cannot serve: an unavailable database, an unwritable artifact root, or an unavailable media tool. The worker heartbeat is observational — `unknown` means no worker has reported yet (normal for web-only sessions and CI), and `stale` means a worker stopped reporting. A heartbeat is stale after 30 seconds or 30 worker poll intervals, whichever is longer.

`npm run worker` starts the local worker process. It opens the database, verifies the artifact root, checks the package-managed FFmpeg and FFprobe binaries, and records a heartbeat into `worker_heartbeats` on every poll interval (`WORKER_POLL_MS`, default 1000 ms). Job claiming and stage processing arrive with the production engine; the heartbeat is the foundation the health endpoint observes. The worker fails fast with a stable error code (`WORKER_DB_OPEN_FAILED`, `WORKER_ARTIFACT_ROOT_UNWRITABLE`) when a dependency is broken.

### Manual process and health check

Verify the full stack locally before a demo:

```bash
npm run build
npm run start &          # web server on http://localhost:3000
npm run worker           # heartbeats into the configured database
curl -s http://localhost:3000/api/health | jq
```

With the worker running, the report shows `worker: "fresh"` and `status: "ok"`. Stop the worker, wait past the staleness window, and request the endpoint again — the report shows `worker: "stale"` while the web service remains `ok`. Every server and worker event is a single-line JSON log with a timestamp, level, message, and structured context (request or job ID, worker ID, production ID, stage, attempt, provider, elapsed time, and stable error codes). Source file contents, provider credentials, and creative prompts are never logged.

Filesystem paths, raw process errors, and version output remain server-internal for every check.

## Source documents

Repository mirrors under `docs/` retain published Obvious artifact IDs so later implementation work can trace requirements to the exact source. The amendment supersedes only its named sections; every other requirement in the original artifacts remains authoritative.

| Source                                      | Artifact ID                                                          | Repository mirror                                 |
| ------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| Initiative Brief                            | `art_9vDxr93f`                                                       | Provenance retained in the amendment mirror       |
| Product Specification                       | `art_ocJIIoS8`                                                       | `docs/product-spec.md`                            |
| UX Specification                            | `art_a8bSEyOy`                                                       | `docs/ux-spec.md`                                 |
| Technical Specification                     | `art_37lEeMmB`                                                       | `docs/technical-spec.md`                          |
| Brand and Visual Style Guide                | `art_1LwAYmSU`                                                       | `docs/brand-style-guide.md`                       |
| Build and Demo Runbook                      | `art_PHtWViaT`                                                       | `docs/demo-runbook.md`                            |
| Provider and Runtime Architecture Amendment | `art_2yKin00n` (snapshot `75a492970ad21538500738143b6b442cae975a3d`) | `docs/provider-runtime-architecture-amendment.md` |
