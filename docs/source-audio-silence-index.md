# Source-Audio Candidate and Waveform Seam Checks

Use this file for waveform-index format and batch-lookup mechanics. The sole rough-cut and seam policy is [`talking-head-trim-standard.md`](talking-head-trim-standard.md). Start building or reusing the index as soon as the source is probed; continue ChatCut import and semantic editing while it builds, then batch-lookup the edited seams after cleanup. The index must be ready before that lookup.

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

## Batch lookup

After ChatCut has completed semantic and candidate cleanup, put every retained cut in/out edge in one manifest: each seam records the outgoing clip's source end and the incoming clip's source start. This checks waveform padding inside both clips, even when timeline items touch with no timeline gap. Candidate discovery stays in the preceding step; do not use this seam lookup to enumerate unrelated pauses. Add a same-item candidate span only for a specific unresolved blank or transient; set `leftAssetEndUs` to the candidate start and `rightAssetStartUs` to its end, and set `lookupPaddingMs` to at least half that candidate's source-time span. The lookup rejects a same-item span when the padding would leave its middle uninspected. The manifest must carry the source SHA-256, timeline frame rate, both item IDs, asset-clock edge times, and an operator-attested asset-to-source map based on a fresh ChatCut asset inspection and the original-file probe. The script checks that the attested ID, hash, duration, offset, and scale agree with the map; this consistency check does not independently prove the remote asset's identity. Schema v2 is the only accepted lookup format. Do not downgrade to legacy schema v1. dB intervals may be used to find regions for inspection, never to choose the physical edge returned by this lookup.

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
