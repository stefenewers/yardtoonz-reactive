<!-- Source: Obvious artifact art_2yKin00n; durable snapshot 75a492970ad21538500738143b6b442cae975a3d. -->

# YardToonz Reactive — Provider and Runtime Architecture Amendment

This repository mirror records the normative decisions published in **Obvious artifact `art_2yKin00n`**, durable snapshot **`75a492970ad21538500738143b6b442cae975a3d`**. The published artifact remains the authoritative presentation.

## Supersedes named sections only

This amendment supersedes only the following sections and concepts. All other requirements and provenance remain in force.

- Technical Specification `art_37lEeMmB` §4: replace global `ProviderMode` assumptions in `ProductionJob` and `ArtifactRecord`; retain lineage and request-ID concepts.
- Technical Specification `art_37lEeMmB` §5: replace global provider selection with independent image and animation selections.
- Technical Specification `art_37lEeMmB` §11: replace `PROVIDER_MODE` with conditional `IMAGE_PROVIDER` and `ANIMATION_PROVIDER` validation.
- Technical Specification `art_37lEeMmB` §2.1 and §12: use package-managed media tooling, platform-aware Chromium, and safe public diagnostics.
- UX Specification `art_a8bSEyOy` §2 header, §3 production/output wording, §4 production reminder, and §5 visibility rule: show separate **Image provider** and **Animation provider** labels.
- Initiative Brief `art_9vDxr93f` §§7–8 are refined, not relaxed: mock/mock stays credential-free and optional live adapters remain outside the mock MVP completion gate.

## Normative provider and persistence contract

```ts
export type ImageProvider = "MOCK" | "OPENAI";
export type AnimationProvider = "MOCK" | "RUNWAY";
export type ArtifactProvider =
  | "USER_UPLOAD"
  | "FFMPEG"
  | ImageProvider
  | AnimationProvider;

export interface ProductionJob {
  imageProvider: ImageProvider;
  animationProvider: AnimationProvider;
}

export interface ArtifactRecord {
  provider: ArtifactProvider;
  providerRequestId?: string;
}
```

Resolve validated server configuration when a production job is created and store both selections on that job. Later environment changes must not alter an existing job's selections. Every artifact stores the provider that actually produced it: user upload, FFmpeg, the selected image provider, or the selected animation provider. A mock artifact must never claim an AI provider produced it.

## Configuration and runtime contract

- `IMAGE_PROVIDER=MOCK|OPENAI` and `ANIMATION_PROVIDER=MOCK|RUNWAY` vary independently.
- `OPENAI_API_KEY` and `OPENAI_IMAGE_MODEL` are required only for `IMAGE_PROVIDER=OPENAI`.
- `RUNWAY_API_KEY` and `RUNWAY_MODEL` are required only for `ANIMATION_PROVIDER=RUNWAY`.
- No provider credentials are required for mock/mock.
- FFmpeg and FFprobe are installed and resolved through repository-managed packages.
- Linux CI and sandboxes use Sparticuz Chromium; non-Linux development uses Playwright's native managed browser.
- Public health responses expose only bounded status categories, never secrets, filesystem paths, version output, or raw exceptions.
- User-visible setup and output facts show **Image provider** and **Animation provider** separately.

## Required verification

- Test mock/mock, both hybrid directions, and live/live configuration.
- Test that only selected live providers require credentials.
- Test stored job records for both provider selections and artifact records for actual producer attribution, including FFmpeg and mock outputs.
- Test Linux versus non-Linux browser selection without requiring every browser installation in unit tests.
- Verify package-managed FFmpeg and FFprobe execution.
- Capture UI evidence showing separate image and animation labels.

## Provenance retained

- Initiative Brief — `art_9vDxr93f`
- Product Specification — `art_ocJIIoS8`
- UX Specification — `art_a8bSEyOy`
- Technical Specification — `art_37lEeMmB`
- Brand and Visual Style Guide — `art_1LwAYmSU`
- Build and Demo Runbook — `art_PHtWViaT`

These artifacts remain authoritative except for the specifically superseded sections named above. Product scope, rights gates, scoring, mock-first delivery, and the no-publishing boundary are unchanged.