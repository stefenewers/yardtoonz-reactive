# Demo media fixtures

Committed demo media for the three-minute walkthrough demo. Everything here
is rights-cleared for demo use — nothing is downloaded from a social
platform.

| File                             | What it is                                                 | Provenance                                                                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asisay-boss-demo.mp4`           | 6-second source fixture, 360×640, H.264 + AAC              | Trimmed from the owner-delivered `AsISayBoss.mov` project file (`fl_b54xLVTT`, 10.7 MB, 17.9s). The owner cleared this clip for Yard Toonz demo use. Trim parameters: seek 1s, duration 6s, scaled and padded to 360×640 @ 24fps, libx264 CRF 28, AAC 96k, faststart. |
| `keyframes/keyframe-{1,2,3}.jpg` | Frames sampled at 0.5s, 3s, and 5.5s of the trim           | Candidate thumbnails for the pinned walkthrough candidate (`cand-rain-laundry-003`).                                                                                                                                                                                  |
| `known-good-output.mp4`          | Recorded known-good FINAL_VIDEO (6s, 360×640, H.264 + AAC) | Produced by a real MOCK/MOCK pipeline run (rights-confirmed → source upload → full stage pipeline to COMPLETE) on `asisay-boss-demo.mp4`, segment 0–6s. Committed as the worst-case demo-failure fallback output.                                                     |

Regenerating any of these is a local FFmpeg job against the owner's source
file — no network fetch, no scraping.
