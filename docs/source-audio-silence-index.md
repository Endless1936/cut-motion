# Source-Audio Candidate and Waveform Seam Checks

Use this file for waveform-index format and targeted seam-lookup mechanics. The sole rough-cut policy is [`talking-head-trim-standard.md`](talking-head-trim-standard.md). Start building or reusing the index as soon as the source is probed; continue ChatCut import and semantic editing while it builds. The default calculator uses this index after candidate cleanup; run the targeted batch lookup only for a user-reported seam or a specific diagnosis request.

## Candidate-scan invocation

Follow the candidate criteria and classification in the Golden Standard. For the dB candidate scan, run `scripts/detect-silence.sh <original-source>` once with its default `-30`, `-35`, and `-40 dB` thresholds and 0.45-second minimum duration. Map detections to source time and consider only intervals overlapping retained footage. This script reports intervals; it does not classify sounds or authorize edits.

## Build once

Keep the original source unchanged and decode its audio once for the waveform index:

```bash
node scripts/index-source-silence.mjs input/source.mov --output state/source-audio-waveform-index.json
```

The schema-v4 index stores a 10 ms per-channel waveform envelope with peak, RMS, zero-crossing, and exact-zero features. It uses no amplitude threshold and creates no cut recommendations. Exact-zero runs can corroborate a trace but are uncommon in lossy audio. The dB candidate sweep is a separate whole-timeline pass. Legacy trim-plan validation applies only to explicit FFmpeg trim-plan output, not ChatCut timelines. The source SHA-256 is checked before and after decoding.

Reuse a prior schema-v3 or schema-v4 index when its source SHA-256 matches the untouched job source and it contains the full per-channel waveform windows. Schema-v3 threshold fields are ignored and omitted from strict lookup output. Do not decode the same source again just to build a second timeline's seam map.

Do not pass a `--summary` output to `--lookup`; summaries intentionally omit the waveform windows.

## Targeted seam lookup

Use the batch lookup below only when the user reports that the default clip-edge pass still leaves a rough seam, or asks for a specific seam diagnosis. It provides localized evidence for the existing audio-led review; it does not replace the default calculator or choose a cut frame.

```json
{
  "schemaVersion": 2,
  "sourceSha256": "<sha256 from waveform index>",
  "timelineFps": { "numerator": 30, "denominator": 1 },
  "sourceMap": {
    "chatcutAssetId": "<asset id>",
    "originalSourceSha256": "<same sha256>",
    "offsetUs": 0,
    "scaleNumerator": 1,
    "scaleDenominator": 1,
    "assetDurationUs": 466934000,
    "operatorVerification": {
      "method": "manual-chatcut-asset-metadata-review",
      "chatcutAssetId": "<same asset id>",
      "originalSourceSha256": "<same source sha256>",
      "originalSourceDurationUs": 466933333,
      "assetDurationUs": 466934000,
      "offsetUs": 0,
      "scaleNumerator": 1,
      "scaleDenominator": 1,
      "evidence": "Inspected this exact ChatCut asset ID and matched its filename, duration, and timebase to the probed job source.mov."
    }
  },
  "timelineSeams": [
    {
      "timelineFrame": 84,
      "leftItemId": "<item id>",
      "rightItemId": "<item id>",
      "leftAssetEndUs": 4993333,
      "rightAssetStartUs": 11116667
    }
  ]
}
```

```bash
node scripts/index-source-silence.mjs \
  --lookup state/source-audio-waveform-index.json \
  state/chatcut-seams.json \
  --output state/seam-waveform-lookup.json
```

The result contains per-channel waveform envelopes around every clip seam or candidate blank span and exact-digital-silence corroboration. The default lookup window is one second on each side so a large residual gap is not missed; set `lookupPaddingMs` in the manifest to narrow it when needed. It contains no dB runs or boundary recommendations. The lookup never changes ChatCut or writes a trim plan.

For edge interpretation and accepted cut placement, follow the Golden Standard. AAC silence may sit at a stable nonzero floor, so an empty exact-zero-run list does not classify the sound. This index returns waveform evidence; it does not decide whether a plateau is removable or move an edge automatically.

The Golden Standard defines edge placement and ambiguity handling. This index supplies waveform evidence only.

## Lookup contract

The utility checks source hashes, operator-attested source-time map fields, item IDs, and edge-time ranges for consistency. It does not verify the remote ChatCut asset bytes or decide whether an edge should move. Use the batch traces for targeted triage under the Golden Standard; exhaustive per-seam playback and boundary confirmation are not required.

## Default clip-edge calculator

After semantic and gap-candidate cleanup, run `scripts/compute-seam-tightening.mjs` across the retained clips. It only refines edges of clips ChatCut has already selected; it never decides what content to keep or edits the timeline. Save `state/timeline-source-windows.json` with one record per retained video item, using `preview_timeline` for item, source, and timeline ranges and `inspect_item` to confirm `playbackRate: 1` for every item. Use the source SHA-256 and duration from the waveform index and the exact ChatCut asset ID.

```json
{
  "schemaVersion": 1,
  "sourceSha256": "<waveform-index source hash>",
  "sourceDurationUs": 120000000,
  "sourceAssetId": "<ChatCut asset ID>",
  "timelineFps": { "numerator": 30, "denominator": 1 },
  "clips": [
    {
      "itemId": "<timeline item ID>",
      "assetId": "<same ChatCut asset ID>",
      "timelineStartFrame": 0,
      "durationFrames": 90,
      "srcStartUs": 577000,
      "srcEndUs": 3577000,
      "playbackRateNumerator": 1,
      "playbackRateDenominator": 1
    }
  ]
}
```

```bash
node scripts/compute-seam-tightening.mjs \
  --index state/source-audio-waveform-index.json \
  --windows state/timeline-source-windows.json \
  --out state/seam-tightening-plan.json
```

For each retained source interval, the script finds the first and last sustained primary activity (RMS16 200 over three 10 ms windows, using the louder channel). It retains one timeline frame at each proposed edge and backs off to sustained lower-level activity (RMS16 100) when present. These thresholds measure signal level; they do not label speech, breath, or noise. The scan uses `audio.startTimeUs` and exact sample bounds, stays within each clip's source interval, and quantizes to timeline frames only at the end. It rejects source/hash/duration mismatches, intervals outside indexed audio, non-contiguous timeline positions, duration/rate mismatches, and output overwrites. Apply nonzero edge trims through ChatCut `edit_item` using the plan's frame counts, adjusted timeline starts, and durations. This is the default rough-cut closure pass; it adds no workflow gate.
