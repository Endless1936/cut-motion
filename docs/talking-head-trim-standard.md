# Talking-Head Rough Cut

Default: **one semantic pass → one pause-cleanup pass → one edge-tightening pass → deliver the ChatCut project for listening**. For a 5–6 minute recording, target this handoff within 6 minutes, including preparation, tool runtime and recovery. This is an execution budget, not a gate or a target cut duration. Report a blocking tool failure promptly with the usable result so far. The user judges listening quality in `rough-cut-review`.

## Start or resume

Create the job once; this entry point copies the source and creates workflow state:

```bash
./scripts/scaffold-project.sh jobs/<job-id> /absolute/source.mov review
```

Resume from `workflow-state.mjs ... status`. Match the source to its ChatCut asset once. If a usable cut already exists, give the user its project link and apply only requested revisions. Use a supplied reference script to understand intended wording and takes; preserve it for caption correction after approval. Local source-word conversion, transcript spelling edits, reconciliation, Caption Plan and MG planning belong after rough-cut approval.

## Three editing passes

1. **Semantic edit.** Read ChatCut Script and remove misspeaks, failed starts, repeated takes and production chatter. Keep the last complete correct take by default, preserving meaningful emphasis and rhetorical self-correction. Use inline deletion for failed fragments within a row. For Chinese, remove only contextually confirmed standalone fillers. Handle fillers here in Script, where context prevents deleting lexical `额` inside words such as `免费额度`; do not run `clean_script`'s default filler pass before this edit.
2. **Pause cleanup.** Remove empty delays and restart preparation, including pauses inside clips. If using `clean_script`, run it only for this pause pass with `only:"silence"`; its default also removes fixed filler tokens. When useful, at most one read-only sub-agent may identify pause candidates during the semantic pass; it returns source times and nearby transcript context, never edits ChatCut. Do not run both a sub-agent scan and `detect-silence.sh`; skip the extra dB scan unless the retained Script leaves a specific long gap unclear. Apply pause edits once in a batch. Ambiguous breaths or possible quiet words remain for user listening. No classification ledger, pre-cleanup snapshot, per-candidate reason or full speech-coverage report is required.
3. **Edge tightening.** Only after semantic editing and pause cleanup have both been applied, save one timeline-only structured snapshot and run the command below. Request up to 100 items per page; fetch another page only when the tool reports pagination. Apply the resulting plan once in a batch. It handles source bounds, waveform offsets, low-level tails and frame safety margins. ASR intervals are often wider than the physical sound: overlap with an ASR word is not a reason to re-audit every edge or reject the plan. If the mapping is unsupported, keep those edges and disclose that limitation at handoff.

## Edge command

Use a 30 fps timeline by default. Save tool responses directly as JSON under the job; pass multiple files for paginated results:

```bash
node scripts/prepare-rough-cut.mjs jobs/<job-id> tighten jobs/<job-id>/state/chatcut-timeline.json
```

The command builds/reuses the waveform index, converts timeline entries into source windows, and writes `state/seam-tightening-plan.json`. It supports a single source video track at an integer timeline fps with a linear 1x mapping; the source span must agree with each clip's frame duration. Fetch another timeline page only when pagination requires it. Query individual items only to resolve missing or unsupported mapping data.

Load the saved plan as JSON and send its `editItemArgs` directly to `edit_item`. This contains the complete atomic `updates` batch with item/timeline/track IDs, `fromFrame`, `durationInFrames` and source starts in seconds; `projectId` comes from the saved preview. For a legacy preview without `projectId`, add the project ID that produced that snapshot. Keep the supplied frame counts and `ripple:false`: all final positions are already calculated. Do not print the whole plan, translate fields by hand, or derive frame durations with `ceil` from rounded microsecond ranges. If `updates` is empty, skip the call. The companion `timeline-source-windows.proposed.json` contains the resulting mapping: adopt it as `timeline-source-windows.json` only after the batch succeeds. If an edit fails, fetch the actual current timeline once before any recovery rather than reapplying an old batch.

One final timeline read confirms the batch landed; save its structured pages for later source mapping. Deliver immediately; no further scan, ASR-overlap sweep, gap reclassification, per-seam playback or MP4 export precedes listening. This project's three-pass delivery replaces a generic plugin's extra cleanup or global `smooth_audio` step. Audio smoothing is a targeted response to an audible seam problem, not routine rough-cut preparation.

## Handoff

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json review-cut --project-id <project-id> --timeline-id <timeline-id>
```

This generates the rough-cut record and enters the existing `rough-cut-review` from intake, transcription or rough-cut. It checks any existing source-transcript lock but does not demand one to hear the cut. Give the project link, current duration and any skipped operation; then wait for the user's decision. The command records a handoff, not proof that edits or listening occurred.

## After user feedback

Repair only the reported passages. Save the timeline snapshot confirming these edits; composition uses it to refresh source windows following [MG speech timing](mg-speech-timing.md), without another tightening pass. A targeted waveform lookup or `inspect-media-window.mjs` can help with a specific seam; see [audio index mechanics](source-audio-silence-index.md). `classify-gaps.mjs` and `check-gap-candidates.mjs` remain optional diagnostics for a requested cleanup investigation.

For an explicit FFmpeg fallback, use the existing trim-plan commands and their media checks. This is not a second pass on a ChatCut cut.
