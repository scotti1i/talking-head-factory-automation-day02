---
name: talkinghead-edit
description: "End-to-end talking-head video editing: preserve original takes, build a cached word-level transcript, make semantic A-roll cuts, inspect every cut, calibrate captions, add restrained HyperFrames beats and justified B-roll, derive vertical/horizontal/Shorts variants, inspect the final MP4, and deliver files. Use when the user asks to 剪口播、精剪口误、做动态卡版、加字幕或 B-roll、做抖音/YouTube/Shorts 成片，or review the status of that workflow. This is the only active entrypoint; do not route to talking-head-recut or old brandkit generators."
---

# Talking-head edit

Turn raw recordings into reviewable, reproducible deliverables. Treat speech as the main picture. Use judgment for meaning; use scripts for deterministic execution.

## Authority and source of truth

This Skill drives the repository you cloned. Point `FACTORY` at that clone and run every command from its root. Set `TALKINGHEAD_FACTORY` in your shell to skip the prompt each session:

```bash
# Path to the talking-head-video-factory repo you cloned.
FACTORY="${TALKINGHEAD_FACTORY:-$HOME/talking-head-video-factory}"
cd "$FACTORY"
```

Read `$FACTORY/AGENTS.md`, `$FACTORY/docs/data-contract.md`, and the job's `project.md` before editing. Job JSON files are content truth; generated HTML is render truth. Do not hand-edit generated HTML.

Never use:

- `talking-head-recut` for NLE editing.
- legacy Python brandkit generators, per-video generators, project-specific builders, or silence-only automatic EDL as the primary workflow (see `docs/legacy.md`).
- the console as a model runner. The Skill is the entrypoint.

## Non-negotiable gates

1. Preserve untouched recordings under `assets/originals/`.
2. Before transcription, rendering, recording, or batch work, run `df -h`; require at least 50G free.
3. Transcribe each source hash once. Reuse `data/transcripts/index.json` for editing and captions.
4. Cut by semantic completeness. Remove errors, false starts, repeated meaning, and dead air, but keep roughly 0.18–0.35s natural breath when it preserves cadence. Do not optimize for maximum cut count.
5. Inspect every cut image and waveform before approving cut QA. Never approve unseen evidence.
6. Cards and B-roll must explain something difficult to understand from the face alone. If `intent` and `reason` are weak, omit them.
7. Themes come only from `themes/registry.json`. Do not invent per-job palettes.
8. Build vertical and horizontal from the same clean A-roll/EDL, not from a platform-downloaded or already packaged output.
9. Shorts default to stream copy from the high-bitrate vertical master. Re-encode only with explicit user permission.
10. Inspect final MP4 metadata and sampled frames. Require full-playback review by the user or a media-capable reviewer before claiming publish-ready.
11. Horizontal deliverables must fill the 16:9 canvas without synthetic left/right black bars. Never use `contain` plus `pad` as a convenience fix. Re-export natively at 16:9 or use a content-safe proportional fill crop; any pillarbox in final QA is a delivery failure.

## Workflow

### 1. Resolve or create the job

Use the supplied job if one exists. Otherwise:

```bash
cd "$FACTORY"
npm run new -- <slug>
```

Copy or link raw takes into `jobs/<slug>/assets/originals/`. Fill `project.md` with the single audience problem, must-keep claims, must-remove defects, packaging boundary, and deliverables.

### 2. Inventory and cached editor transcript

```bash
cd "$FACTORY"
npm run inventory -- --job jobs/<slug>
npm run transcribe:editor -- --job jobs/<slug>
npm run status -- --job jobs/<slug>
```

Read `data/takes-packed.md`. Open individual transcript JSON only when word timing or confidence is uncertain. For multiple takes, select the clearest complete delivery, not merely the latest take.

### 3. Write and render the semantic EDL

Write `data/rough-cut-edl.json` using the contract in `docs/data-contract.md`. Every kept range needs a short `reason`. Boundaries should avoid phonemes and visible mid-gesture jumps.

Before rendering, check disk space. Start long work in a tracked background session:

```bash
cd "$FACTORY"
npm run roughcut:render -- --job jobs/<slug>
npm run qa:cuts -- --job jobs/<slug>
```

Use image inspection on every `qa/cuts/cut-*.jpg`. Check mouth/gesture continuity, waveform truncation, repeated meaning, and over-tight pacing. Fix the EDL and regenerate until clean. Then and only then:

```bash
npm run qa:cuts:approve -- --job jobs/<slug> --reviewer codex --notes "<what was checked>"
```

### 4. Build captions from the same cache

```bash
npm run captions:build -- --job jobs/<slug>
```

Calibrate names, products, English terms, punctuation, and segmentation in `data/captions.json`. Do not run Whisper again on the rough cut.

### 5. Plan beats and B-roll

Write `data/beats.json` using registered beat types. Favor fewer high-value cards; vary adjacent structures. Captions remain complete even during cards.

Write `data/broll.json` only when useful. Default mode is `fullscreen-pip`, preserving the speaker as a small window. The builder enforces: no first-3-second B-roll without `allowHook`, max 10s per segment, no overlaps, and max 25% total coverage.

For user recordings or screen captures, stage files under `assets/broll/`. For needed images/icons, load `media-use` and resolve them into the job; keep its manifest. Never fabricate a screenshot of a real product UI when an authentic capture is required.

### 6. Build and inspect the compositions

```bash
cd "$FACTORY"
npm run build:beats -- --job jobs/<slug>
npm run build:variants -- --job jobs/<slug>
npm run check:variants -- --job jobs/<slug>
```

Use the local pinned HyperFrames dependency. Snapshot the hook, every beat/B-roll boundary, and exit frames. Inspect the images. Horizontal output must be a real re-layout: talking head on the right, explanatory surface on the left; never stretch or hard-crop a vertical packaged video.

After builder or theme changes, also run `npm run regression` (synthetic regression baseline).

### 7. Review render, final render, and QA

Check disk again. Render a short or draft review first; show it to the user when the edit or visual direction materially changed. After acceptance, start the final render as a tracked background process:

```bash
npm run render:variants -- --job jobs/<slug>
```

Run final QA for each rendered variant. Inspect all QA frames, not only the preview HTML. Report honestly whether full playback was completed or remains a user gate.

After inspecting every frame, record the gate per variant. Set `--fullPlayback true` only when the final MP4 was actually watched end to end:

```bash
npm run qa:final:approve -- --job jobs/<slug>/variants/<id> --reviewer codex --fullPlayback false --notes "<what was checked>"
```

### 8. Shorts and delivery

If `data/shorts.json` exists:

```bash
npm run cut:shorts -- --job jobs/<slug> --mode copy
```

Deliver without deleting user-added cover files:

```bash
npm run deliver:variants -- --job jobs/<slug>
npm run status -- --job jobs/<slug>
```

Publishing is out of scope for this repo: it produces the reviewed MP4s and stops there. If you want to upload to YouTube, Douyin, or elsewhere, wire in your own upload tool and run it against the delivered files — dry-run and confirm the target channel/account before any real upload.

## Completion report

Return:

- job path and Git commit;
- source count, source-to-final duration, and cut count;
- cut QA approval path;
- caption/beat/B-roll counts;
- each variant's resolution, duration, QA path, and delivery path;
- whether full playback and user review are complete;
- any remaining gate before the files are publish-ready.

After an accepted milestone, commit immediately. At project completion, record the executable paths and commands somewhere durable (never secrets).
