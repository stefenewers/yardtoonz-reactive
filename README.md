# YardToonz Reactive

YardToonz Reactive is a local-first creator workflow for turning an approved, rights-cleared source moment into a traceable Yard Toonz cartoon. This foundation PR establishes the Next.js/TypeScript application, validated server configuration, repository quality gate, and locally provisioned media/browser tooling. Product features arrive in later reviewed PRs.

## Requirements

- Node.js 20.20.2
- npm 10.8.2

No globally installed FFmpeg, FFprobe, or browser is required. `npm ci` installs platform-specific FFmpeg and FFprobe binaries through `ffmpeg-static` and `@ffprobe-installer/ffprobe`. It also installs a Chromium 147 runtime through `@sparticuz/chromium`, matched to Playwright 1.59. `npm run playwright:install` extracts and executes that browser with its package-bundled Linux libraries; it does not modify the sandbox image or assume host browser packages.

The tradeoff is a larger dependency install and Linux-focused browser provisioning limited to the packages' published architectures. The benefit is a reproducible path in the minimal Autobuild sandbox and Ubuntu CI without privileged package installation. `npm run test:tools` executes both media binaries, while the Playwright provisioning command and browser smoke test fail explicitly when the current platform is unsupported.

## Setup

```bash
npm ci
cp .env.example .env.local
npm run playwright:install
npm run dev
```

Open <http://localhost:3000>. Mock mode uses the defaults in `.env.example` and requires no OpenAI or Runway credentials.

## Commands

| Command                      | Purpose                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                | Start the development server                                     |
| `npm run build`              | Build the production application                                 |
| `npm run start`              | Start the built application                                      |
| `npm run test`               | Run Vitest tests                                                 |
| `npm run test:tools`         | Verify the package-managed FFmpeg and FFprobe binaries           |
| `npm run test:e2e`           | Run the Playwright browser smoke test against a production build |
| `npm run playwright:install` | Provision and verify the pinned package-local Chromium runtime   |
| `npm run check`              | Run formatting, lint, types, tests, build, and browser QA        |

CI runs `npm run playwright:install` followed by the same `npm run check` command contributors run locally.

## Environment validation

Server configuration is parsed by Zod in `src/lib/env-schema.ts` and loaded only through `src/lib/env.ts`. Invalid numeric values fail startup. `PROVIDER_MODE=LIVE` also fails unless all four future live-provider values are present, even though live adapters are intentionally outside this PR.

## Source documents

The approved Product, UX, Technical, Brand, and Demo documents are copied under `docs/`. Each file starts with its published Obvious artifact ID so later implementation work can trace requirements to the exact source.
