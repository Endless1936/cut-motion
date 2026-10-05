---
name: cut-motion
description: Edit a local talking-head recording using ChatCut for editable rough cutting and speech timing, then HyperFrames for corrected captions, speech-synchronized motion graphics and final rendering. Use for Cut Motion jobs, talking-head editing, reference-script caption correction and MG finishing.
---

# Cut Motion

Use one forward pass: **rough cut → one caption and motion plan → compose and deliver**. Keep one authored `jobs/<id>/plan.json`; tools own derived files. Read [editing](references/editing.md) when cutting or planning, and [ChatCut integration](references/chatcut.md) when importing, obtaining timing or exporting.

## Defaults and working method

- A local video is required. Preserve it; use supplied preferences and otherwise proceed with defaults.
- Defaults: `mode:"review"`, `captionMode:"subtitles"`, 1080×1920, 30 FPS, A-roll overlays and Smiley Sans where available.
- Review waits twice: after the complete rough cut, then after one combined caption/MG plan. Remember approval already given. Explicit `mode:"auto"` skips those waits; it does not change creative defaults or authoring requirements.
- For an ordinary two-minute talking-head video, aim for 7 minutes rough cutting, 5 minutes planning and 8 minutes finishing, excluding user waits. These are execution targets, not gates or a measured promise.
- Keep raw responses, media, composition, previews and logs inside the job. Do not add workflow states, approval receipts, fingerprints, audit documents or full validation passes to production.
- Reuse existing imports, export tasks, files and dependencies. Process tool responses locally and return short summaries; do not repeatedly print complete transcripts or JSON.

## 1. Rough cut

Import into a separately named ChatCut project when requested. Use Script for content selection: retain the clearest take, remove mistakes, redundant wording and irrelevant process, and preserve the argument and natural delivery.

Make one semantic edit, one pause-cleanup batch and one targeted cut-edge tightening batch. `clean_script` is silence-only: `only:"silence"`. Save the current `preview_timeline` pages and run `node .agents/skills/cut-motion/scripts/roughcut.mjs <original-video> <preview-pages.json> <job>/cache/tightening.json`; apply its clip trims once in one ChatCut batch. The helper measures retained source intervals with one waveform decode; do not add a separate waveform audit or keep tightening repeatedly.

Deliver the editable ChatCut link. In Review, wait for rough-cut approval; prepare only useful MG content choices while the user listens. After approval, start or reuse one clean A-roll export and prepare the plan in parallel.

## 2. Plan once

Obtain timing for the locked edit. Correct the complete current-cut wording against any supplied reference script before delivering the plan. The recording remains authoritative; `【】` contains visual notes, ordinary `[]` remains spoken text. Listen locally only where a difference is ambiguous. Do not postpone known corrections to composition.

Author readable, naturally grouped captions and template content directly in `plan.json`. Use measured word timing for MG keyword entries; keep corrected display text separate from raw ASR evidence. The plan is the only published wording source.

Use this shape, omitting unused fields:

```json
{
  "mode": "review",
  "captionMode": "subtitles",
  "source": {"video": "roughcut.mp4", "original": "/absolute/path/source.mov"},
  "width": 1080, "height": 1920, "fps": 30,
  "captions": [{"text": "修正后的口播", "start": 1.2, "end": 3.4}],
  "motions": [{
    "id": "mg-01", "template": "ordered-steps",
    "start": 8, "end": 14,
    "copy": [],
    "data": {"title": "生产流程", "items": ["文案", "画面", "音频", "剪辑"]},
    "revealAt": [8, 8.5, 9.8, 11.2, 12.7]
  }],
  "chatcut": {"projectId": "...", "timelineId": "...", "renderId": "...", "filename": "..."}
}
```

All times are seconds on the locked rough cut. `revealAt` follows template slot order, including a heading or decoration when present. Context headings may enter at the group start; spoken elements enter at their actual keyword onsets. Example times demonstrate the format, not fixed animation intervals.

In `subtitles`, captions carry complete speech; supplementary MG organizes information. In `motion-copy`, captions carry complete speech as animated paragraphs, without an independent subtitle band. Optional `lines:[{text,at,emphasis?}]` uses measured phrase onsets; when present, correct the displayed `lines[].text` and omit a duplicate `caption.text`.

Show one concise combined plan covering corrected captions, MG choices and overall treatment; do not produce three synchronized plan files. In Review, obtain one package approval and retain it if the A-roll export is still running.

## 3. Compose and deliver

Run the Skill's `scripts/setup.mjs <job>` once to reuse or install project-local dependencies. Composition begins after the approved plan and the corresponding clean A-roll are ready; Auto needs only the ready media. Use [tool commands](references/chatcut.md#local-finishing).

Inspect one fully expanded, not-yet-exiting HTML snapshot per MG. Correct local layout defects and recapture affected groups only; this is ordinary making work without another approval, score threshold or blocking audit. Render the full film once, preserve its dialogue audio and deliver the absolute file path.

MG authoring requirements:

- Default to the upper-middle area, starting at 280 px on a 1080×1920 canvas. The whole MG and its background card stay horizontally centered; internal content may align left or right.
- Keep the background at its final width and height from the first frame. Reveal internal content, not a growing card. Preserve translucent black, mint and yellow accents with opaque text.
- Avoid subtitles; eyes and mouths need no clearance. Compact, move upward or split tall content rather than pushing the card into a corner.
- Preserve the spoken item count and relationship direction. Two or more independent elements reveal at their actual keyword onsets and have a designed exit; do not mechanically stagger all elements or advance speech times for animation.
- Use the retained 13 templates with variable items. Custom MG is appropriate when the information requires another structure; note the reason briefly in the plan summary.

When resuming, read the existing plan and relevant output once. Continue the unfinished stage; do not regenerate settled decisions. If a tool path stalls, report its impact and next step, use a known working route, and continue independent work.
