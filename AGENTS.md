# YardToonz Reactive Agent Guide

## Source of truth

Read the five documents in `docs/` before changing product behavior. Their opening comments record the published Obvious artifact IDs. The locked MVP is a local-first, human-directed creator workflow; do not substitute unrelated project material.

## Required quality gate

- Use Node.js 20.20.2 and npm 10.8.2 or compatible patch releases.
- Install dependencies with `npm ci`.
- Install the pinned Playwright browser with `npm run playwright:install`.
- Run `npm run check` before pushing. It verifies formatting, lint, TypeScript, unit/integration tests, the production build, and the critical browser smoke test.
- Behavior and its tests belong in the same PR.

## Architecture boundaries

- Keep domain transformations pure and independently tested.
- Validate environment variables and every external input with Zod.
- Keep secrets server-side. Never expose provider credentials through `NEXT_PUBLIC_*`, logs, fixtures, or API responses.
- Invoke FFmpeg and FFprobe through argument arrays, never shell strings built from user input.
- Use generated storage keys for uploads and artifacts; user filenames are untrusted.
- Future production status changes must go through one typed state-machine function.

## Locked product constraints

- Mock mode must remain deterministic and credential-free.
- Do not add live OpenAI or Runway integrations without explicit approval.
- Rights confirmation is a persisted hard gate before media processing.
- Do not add social scraping, automatic third-party downloads, publishing, authentication, billing, or multi-scene generation.
- Image and animation provider selections must be disclosed independently and honestly in the UI and output metadata.

## Review and merge

- Use conventional commits.
- Every PR requires green CI and human review before squash merge.
- Do not weaken checks, rights gates, or mock-mode support to make a build pass.
