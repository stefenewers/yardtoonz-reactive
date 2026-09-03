<!-- Source artifact: art_a8bSEyOy -->

# YardToonz Reactive — UX Specification

**Status:** Draft for human approval  
**Version:** 1.0  
**Date:** 2026-09-03  
**Depends on:** `01-product-spec.md`

## 1. Experience objective

The interface should feel like a focused editorial production desk: culturally confident, visually connected to Yard Toonz, and operationally clear. A producer should always know:

1. what deserves attention;
2. what decision is required next;
3. what the system is currently doing;
4. which artifacts produced the final output.

The UI is an internal adult creator tool. It must not resemble a children's gardening application despite the visual motifs in the logo.

## 2. Information architecture

The MVP contains four primary destinations:

| Destination | Purpose |
| --- | --- |
| Candidates | Import, rank, filter, and inspect potential moments |
| Candidate detail | Review scoring evidence and approve or reject a candidate |
| Production | Confirm rights, upload the source, select a segment, and start processing |
| Job/output detail | Monitor stages, inspect artifacts, retry failures, preview, and download |

A persistent header shows the Yard Toonz logo, product name, current provider mode (`Mock` or `Live`), and a compact system-health indicator.

## 3. Primary happy path

### Step 1 — Candidate inbox

The default screen shows a ranked table. The first visit includes a clear option to load demo candidates so the experience never opens as a dead end.

Each row shows:

- thumbnail or placeholder;
- source platform label;
- creator/source label;
- short caption or premise;
- age of the source;
- supplied views, likes, comments, shares, and saves when available;
- viral momentum score;
- humor response score;
- Yard Toonz fit score;
- overall score;
- status: `New`, `Approved`, or `Rejected`.

The producer can sort by overall score or any component score. Scores use both numbers and labels; color alone must not communicate meaning.

### Step 2 — Candidate review

Selecting a row opens a detail view with:

- source metadata and supplied engagement metrics;
- the three component scores and their explanations;
- comment excerpts used for humor scoring, if provided;
- a concise adaptation note describing the potential Yard Toonz angle;
- `Reject` and `Approve for production` actions.

Approval does not start generation. It creates an approved candidate and moves the user to the production setup.

### Step 3 — Rights and source setup

The production screen presents the rights gate before the start button.

Required controls:

- source MP4 upload;
- video preview;
- start and end controls constrained to a duration of 5–8 seconds;
- an optional creative-direction note;
- a required checkbox: `I confirm Yard Toonz is authorized to use this source video and selected audio.`

The start button remains disabled until the video is valid, the segment is valid, and the rights confirmation is checked. The UI must explain every unmet condition.

### Step 4 — Processing

Starting production navigates to the job detail screen. It shows a vertical stage list:

1. Source ingested
2. Clip and audio extracted
3. Keyframe selected
4. Clay-style frame created
5. Frame animated
6. Audio restored and output normalized
7. Final validation complete

Each stage displays one of: `Waiting`, `Running`, `Complete`, or `Failed`. Completed stages show duration and an artifact link when applicable. The current stage uses motion sparingly and includes text so status remains accessible.

### Step 5 — Review and download

When processing completes, the user sees:

- a playable vertical-video preview;
- key technical facts: duration, dimensions, video codec, audio present, and provider mode;
- a horizontal or stacked artifact-lineage view from source to final output;
- `Approve output`, `Reject output`, and `Download MP4` actions.

Download is enabled once the job is complete. Approval records editorial acceptance but does not publish externally.

## 4. State inventory

### Candidate inbox

| State | Trigger | UI response | Category |
| --- | --- | --- | --- |
| First visit | No candidates exist | Short explanation and primary `Load demo candidates` action | Happy |
| Loading | Candidates are being read or scored | Table skeletons; import actions disabled | Edge |
| Loaded | Candidates available | Ranked table, counts, filters, and import action | Happy |
| Empty import | Valid import contains zero rows | Keep existing data; explain that no rows were found | Edge |
| Invalid CSV | Missing or malformed required fields | Row-level validation summary; import nothing | Error |
| Partial metrics | Optional engagement fields missing | Show `Not supplied`; score explanation states which inputs were unavailable | Edge |
| Import failed | Unexpected error | Preserve existing candidates and show retryable error | Error |

### Candidate review

| State | Trigger | UI response | Category |
| --- | --- | --- | --- |
| New candidate | No decision recorded | Show evidence, `Approve`, and `Reject` | Happy |
| Approved | Producer approves | Confirmation, decision timestamp, and `Continue to production` | Happy |
| Rejected | Producer rejects | Muted state with optional reason and `Restore` action | Happy |
| Missing source URL | Candidate has no external URL | Do not invent one; allow review using supplied data | Edge |
| No comment excerpts | Comments absent | Humor explanation explicitly says no comment evidence was supplied | Edge |

### Production setup

| State | Trigger | UI response | Category |
| --- | --- | --- | --- |
| Awaiting upload | Approved candidate selected | Upload target and rights explanation | Happy |
| Uploading | MP4 transfer active | Progress indicator; prevent duplicate submission | Edge |
| Invalid file | Wrong type, unreadable, or over configured limit | Explain permitted format and limit; preserve other form values | Error |
| Source ready | Valid video probed | Player, duration, suggested segment, rights checkbox | Happy |
| Segment too short/long | Duration outside 5–8 seconds | Inline validation and disabled start button | Edge |
| Rights unchecked | Other inputs valid | Disabled start button with explicit rights requirement | Edge |
| Ready | All gates satisfied | Enabled `Create cartoon` action and provider-mode reminder | Happy |

### Job processing

| State | Trigger | UI response | Category |
| --- | --- | --- | --- |
| Queued | Job created | First unfinished stage marked waiting | Happy |
| Running | Worker owns a stage | Current stage, elapsed time, and safe refresh behavior | Happy |
| Slow provider | Stage exceeds expected time | Continue polling; show `Still working` without falsely failing | Edge |
| Stage failed | Retryable failure | Failed stage, plain-language error, and `Retry stage` action | Error |
| Non-retryable failure | Validation or policy failure | Explain required correction and return path | Error |
| Retry running | User retries | Reuse completed upstream artifacts; prevent a second concurrent retry | Edge |
| Complete | Validation succeeds | Preview, lineage, approval, and download | Happy |
| Page revisited | User returns to existing job | Restore authoritative job state and artifacts | Edge |

### Output review

| State | Trigger | UI response | Category |
| --- | --- | --- | --- |
| Ready for review | Job complete | Playable preview and output facts | Happy |
| Approved | Producer accepts output | Approval timestamp; download remains available | Happy |
| Rejected | Producer rejects output | Optional note and clear option to return to setup or retry an eligible stage | Happy |
| Playback unsupported | Browser cannot play file | Download remains available; show technical metadata | Edge |
| Missing audio | Validation detects no audio | Mark job failed; do not present it as complete | Error |

## 5. Interaction rules

- No destructive action should occur without confirmation when it would discard an uploaded source or completed artifact.
- A user action must never create two active jobs for the same production request.
- Refreshing the browser must not reset a running or completed job.
- Every disabled primary action must state why it is disabled.
- Provider mode must be visible before production starts and on the final output.
- Errors must describe what the producer can do next; raw stack traces stay out of the UI.
- All scores require a numeric value, text label, and explanation.
- Rights status must remain visible throughout production and output review.

## 6. Visual direction

- Use a dark charcoal or warm off-black workspace so bright Yard Toonz colors feel intentional rather than childish.
- Use yellow for primary actions and active progress, red for destructive/rejection states, and green for confirmed/complete states.
- Use thick black outlines or compact sticker-like treatments selectively for thumbnails, score chips, and stage icons.
- Keep data tables, forms, and status text restrained and professional.
- The claymation content is the visual hero; interface decoration must not compete with it.
- Design mobile-responsive screens, but optimize the production workflow for laptop use at the event.

Detailed brand rules live in `04-brand-style-guide.md`.

## 7. Accessibility and responsiveness

- Meet WCAG AA contrast for normal text and controls.
- All interactive controls must be keyboard accessible and show visible focus.
- Status and score meaning must not rely on color alone.
- Videos require accessible control labels; autoplay must be muted if used at all.
- Tables may become stacked candidate cards below tablet width without hiding scoring evidence.
- Long-running status must remain understandable to screen readers through polite live-region updates.

## 8. Acceptance walkthrough

A reviewer should be able to screen-record this sequence without edits:

1. Open an empty workspace and load ten demo candidates.
2. Sort by overall score and open the highest-ranked candidate.
3. Read the three separate scoring explanations and approve the candidate.
4. Upload the authorized demo MP4 and select a valid segment.
5. Attempt to start with rights unchecked and observe the explicit gate.
6. Confirm rights and start the job in mock mode.
7. Watch every stage complete and open at least the keyframe and styled-frame artifacts.
8. Preview the final video, confirm audio is present, approve it, and download it.
9. Open a seeded failed job, retry its failed stage, and verify completed upstream work is preserved.

## 9. Artifacts to attach in Obvious

After upload, record the Obvious artifact IDs in this section and reference those IDs from the implementation initiative:

- Yard Toonz logo: `[artifact ID pending]`
- Three representative finished cartoons: `[artifact IDs pending]`
- Authorized demo source MP4: `[artifact ID pending]`
- Source-to-finished example, if available: `[artifact IDs pending]`
- Candidate CSV fixture: `[artifact ID pending]`

