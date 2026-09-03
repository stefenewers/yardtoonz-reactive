<!-- Source artifact: art_1LwAYmSU -->

# Yard Toonz — Brand and Visual Style Guide

**Status:** Draft for human approval  
**Version:** 1.0  
**Date:** 2026-09-03  
**Applies to:** YardToonz Reactive interface and generated-cartoon prompts

## 1. Brand truth

Yard Toonz is a Jamaican AI-cartoon entertainment brand built around culturally specific comedy, expressive characters, and a tactile claymation look. The brand turns recognizable moments into short visual jokes that feel fast, local, and shareable.

It is **not** a children's gardening or educational brand. The yard-tool imagery in the wordmark is graphic personality, not the product category. Interfaces and generated imagery must not default to children, gardening lessons, toy packaging, or nursery aesthetics.

## 2. Audience

The primary audience is Jamaican adults and the wider Caribbean diaspora who recognize the language, personalities, social cues, and everyday situations being referenced. Broader audiences may enjoy the visual comedy, but authenticity to the core audience takes priority over flattening the work for universal comprehension.

## 3. Brand attributes

Yard Toonz should feel:

- unmistakably Jamaican;
- quick and culturally alert;
- funny without trying too hard;
- handcrafted despite being AI-assisted;
- bold, expressive, and slightly mischievous;
- contemporary rather than nostalgic by default;
- creator-led rather than machine-led.

Yard Toonz should not feel:

- generic “island” content;
- like a children's TV network;
- like an AI-model demo with no editorial perspective;
- polished to the point that the clay loses tactile character;
- exploitative of accents, poverty, conflict, or stereotypes;
- automatically authoritative about real people or events.

## 4. Voice and language

### Voice principles

- Lead with the joke or recognizable situation.
- Keep explanations short; the visual and audio should carry the moment.
- Use Jamaican speech patterns only when they are natural to the source and approved creative direction.
- Preserve specific language rather than replacing it with generic internet slang.
- Let characters be expressive without making every expression grotesque.

### Patois and cultural specificity

Jamaican Patois must not be fabricated by mechanically changing English spelling. When a line is adapted, a culturally competent human should approve the wording, rhythm, and implication. If the authorized original audio already carries the joke, do not add unnecessary dialogue.

### Editorial caution

- Parody and satire should remain recognizable as parody or satire.
- Do not write unsupported factual accusations into a joke.
- Avoid turning private individuals into recurring characters without permission.
- Avoid content involving minors, active tragedies, or humiliating vulnerable people in the MVP.

## 5. Logo interpretation and use

The supplied logo is a bubbly Yard Toonz wordmark with a Jamaican red/yellow/green palette, heavy black outlines, starburst/splat energy, and crossed yard tools.

Use it as an identity mark—not as instructions to build a gardening-themed interface.

Logo rules:

- Preserve the original proportions.
- Do not redraw the lettering with a generic font.
- Do not remove the black outline when it is needed for contrast.
- Do not place the full logo repeatedly throughout the interface.
- Use the full logo in the header and branded empty state; use simplified color cues elsewhere.
- Give the mark clear space so it does not collide with table controls or video content.

## 6. Color direction

Sample exact colors from the supplied logo before final UI polish. Until those values are recorded, use semantic tokens rather than guessed hard-coded brand hex values.

| Token | Intended role |
| --- | --- |
| `--yt-surface` | Warm near-black creator workspace |
| `--yt-surface-raised` | Cards, panels, and table headers |
| `--yt-text` | Warm off-white primary text |
| `--yt-text-muted` | Secondary metadata |
| `--yt-yellow` | Primary actions, active stages, selected scores |
| `--yt-green` | Confirmed rights, success, completed stages |
| `--yt-red` | Rejection, destructive actions, blocking failures |
| `--yt-outline` | Black or deep charcoal graphic outlines |

Yellow, red, and green must have semantic jobs in the product. Do not place all three on every component. Accessibility contrast takes precedence over exact logo color.

## 7. Creator-tool UI direction

- Default to a mature dark workspace with clean typography.
- Use colorful sticker-like accents sparingly around thumbnails, score chips, and stage icons.
- Tables and forms should remain professional and highly legible.
- Avoid grass textures, gardening illustrations, cartoon clouds, primary-school typography, or excessive bouncing animation.
- Give vertical media generous space and neutral framing.
- Make mock/live provider mode visible; the interface must never imply that a local fallback came from an external AI provider.

## 8. Cartoon visual language

### Required qualities

- stop-motion-inspired clay characters and sets;
- tactile fingerprints, small surface imperfections, and hand-shaped forms;
- expressive faces with readable eyes, mouths, and silhouettes;
- warm, cinematic lighting with clear subject separation;
- saturated but controlled color;
- Jamaican environmental details only when relevant and supported by the source;
- a composition that reads immediately on a phone.

### Avoid

- glossy 3D plastic or videogame-render aesthetics;
- photoreal human skin;
- flat vector-cartoon output;
- generic tropical backgrounds added without reason;
- text baked into generated frames unless explicitly requested;
- extra fingers, duplicated accessories, illegible signage, or warped facial features;
- automatically changing a person's ethnicity, complexion, age, or key identity markers;
- using the logo as a watermark inside every scene.

## 9. Format and composition

- Primary canvas: 9:16 vertical video.
- MVP duration: 5–8 seconds.
- Design for safe viewing on a phone with critical faces and actions near the central region.
- Preserve headroom for future platform UI overlays and captions.
- Prefer one clear subject/action over crowded scenes.
- The first frame should establish the premise quickly; the final beat should hold long enough for the joke to register.

## 10. Character continuity

For a single-shot MVP:

- preserve the subject's approximate pose, clothing colors, defining accessories, complexion, and facial identity from the approved reference;
- keep character count unchanged unless creative direction explicitly says otherwise;
- describe fixed visual anchors in the generation prompt;
- use the approved styled keyframe as the sole visual reference for the animation stage;
- avoid camera moves that reveal unseen sides of a character or set when consistency is uncertain.

The MVP must not promise long-form or multi-scene character consistency.

## 11. Image-style prompt contract

The production system should assemble prompts from controlled sections rather than one unstructured string.

### Base style

> Transform the approved reference into a handcrafted stop-motion claymation scene for Yard Toonz, a Jamaican adult comedy brand. Preserve the subject count, pose, complexion, clothing colors, defining accessories, and overall composition. Use tactile clay surfaces, expressive but recognizable facial features, miniature practical sets, warm cinematic lighting, and a strong silhouette that reads in a vertical mobile frame.

### Scene direction

Insert the producer's approved creative-direction note. It may clarify expression, setting, prop, or comic emphasis. It must not override rights, identity, or safety rules.

### Negative direction

> Do not create a children's gardening aesthetic. No glossy plastic, photoreal skin, flat vector art, generic tropical decorations, extra characters, duplicated limbs, warped hands, illegible text, watermarks, or unrequested captions.

### Output requirement

> Compose for 9:16 vertical output. Keep faces and essential action within the central safe area. Return one clean styled frame suitable for image-to-video animation.

## 12. Animation-direction contract

Animation prompts should request limited, believable motion:

- one primary facial or body action;
- subtle secondary environmental motion;
- stable character identity and clothing;
- restrained camera push, pan, or handheld stop-motion feel;
- no scene cuts in the MVP;
- no new characters, limbs, props, or text;
- duration matched to the authorized audio segment.

Example:

> Animate the approved clay frame as one continuous stop-motion shot. Preserve every character and identity detail. The central character reacts with a quick side-eye and slight head turn while background elements move subtly. Use a gentle camera push. Do not introduce new objects, characters, dialogue, text, or cuts.

## 13. Audio treatment

- Use only the explicitly authorized selected audio segment.
- Do not alter the meaning of speech through deceptive cuts.
- Keep speech intelligible and prevent clipping during final normalization.
- Do not generate imitation voices in the MVP.
- The final validation must confirm an audio stream exists.

## 14. Reference-pack requirements

Attach the following artifacts in Obvious and reference their exact artifact IDs in the UX and technical specs:

1. The original Yard Toonz logo.
2. Three to five representative finished cartoons showing the target clay look.
3. At least one approved source-to-finished example.
4. One rights-cleared source MP4 for the build-day demo.
5. Optional character close-ups demonstrating complexion, facial proportions, and tactile finish.

When the references disagree, the product owner selects the authoritative example. Agents must not average conflicting visual styles without asking.

## 15. Human approval checklist

Before a generated frame advances to animation, verify:

- the joke/premise remains recognizable;
- the character is recognizable and respectfully represented;
- the image reads as claymation rather than generic 3D art;
- no unintended characters, limbs, props, or text appeared;
- Jamaican cues are specific and relevant rather than generic decoration;
- the composition works at phone size;
- the source and audio remain authorized.

