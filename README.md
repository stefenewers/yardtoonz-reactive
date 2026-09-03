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

| Command                      | Purpose                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                | Start the development server                                     |
| `npm run build`              | Build the production application                                 |
| `npm run start`              | Start the built application                                      |
| `npm run test`               | Run Vitest tests                                                 |
| `npm run test:tools`         | Verify the package-managed FFmpeg and FFprobe binaries           |
| `npm run test:e2e`           | Run the Playwright browser smoke test against a production build |
| `npm run playwright:install` | Provision and verify the platform-selected Chromium runtime      |
| `npm run check`              | Run formatting, lint, types, tests, build, and browser QA        |

CI runs `npm run playwright:install` followed by the same `npm run check` command contributors run locally.

## Environment validation

Server configuration is parsed by Zod in `src/lib/env-schema.ts` and loaded only through `src/lib/env.ts`. Invalid numeric values fail startup. Image and animation providers are selected independently, so mock/mock, OpenAI/mock, mock/Runway, and OpenAI/Runway configurations are representable. OpenAI settings are required only when `IMAGE_PROVIDER=OPENAI`; Runway settings are required only when `ANIMATION_PROVIDER=RUNWAY`. Live adapters remain intentionally outside this PR.

The public health endpoint reports the selected providers plus safe media-tool categories (`available`, `binary-unavailable`, `timed-out`, or `execution-failed`). Filesystem paths, raw process errors, and version output remain server-internal.

## Source documents

The approved Product, UX, Technical, Brand, and Demo documents are copied under `docs/`. Each file starts with its published Obvious artifact ID so later implementation work can trace requirements to the exact source.
