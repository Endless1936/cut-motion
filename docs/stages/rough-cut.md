# Stage: rough-cut

Load this when `workflow-state.mjs` enters `rough-cut` — **including after a `revise` from `rough-cut-review`**, where it must be worked from the top rather than resumed from memory. Do not carry rules from other stages into it; the one historical failure in this stage came from exactly that.

## Enters with

- A transcript reconciled against the recording (`state/source-transcript.json`).
- An original-source waveform index, per [`source-audio-silence-index.md`](../source-audio-silence-index.md).
- A ChatCut project with an editable timeline.

## Do, in order

Work the [Talking-Head Rough-Cut Golden Standard](../talking-head-trim-standard.md) fast path. Each step below ends with the evidence that must exist before moving on.

1. **Semantic selection.** Remove misspeaks, failed starts, retries, repeated takes.
   *Evidence:* every retained row has been re-read **backwards** for a residual take. ASR merges a failed attempt into the same row as the good delivery (`[s15] 结果这两天结果这两天我发现…`), so a row-level keep/drop hides it. Delete in-row leftovers with Script's `~~…~~`. Step 6 checks forward only and will not catch this.
2. **Filler cleanup.** Chinese speech: never `clean_script({only:"fillers"})` — its fixed list eats the lexical `额` in `免费额度`.
3. **Terminal-tail pass. Mandatory.**
   *Evidence:* `state/chatcut-roughcut.json` records that it ran, with per-seam trim counts.
   Cut point comes from **source-audio waveform evidence**; ASR only locates the candidate. Do not cut at the aligned ASR word end and do not use `max(ASR end, waveform end)` — ASR word ends overshoot real energy, so that formula preserves the blank this step removes.
   `clean_script` silence compression is **not** a substitute: it keeps a preserved floor and cannot remove a tail.
4. **Other gap candidates**, then 5. **classify and protect**, 6. **completeness check**.

## Do not

- Skip step 3. There is a rule elsewhere — in the optional seam-refinement stage — that says *do not run an exhaustive edge-tightening pass*. **That bounds that optional stage. It is not permission to skip step 3 here.** This confusion happened once and cost a full review round-trip.
- Delete a complete correct phrase because its wording differs from ASR or the reference.
- Trim heads, internal pauses, or between-word gaps using the terminal-tail rule.

## Exits with

- `state/chatcut-roughcut.json`: every mandatory step recorded as run. **A record that says a mandatory step was skipped does not advance** — fix and re-record rather than reporting it as a known omission.
- Timeline with closed seams and no unexplained gap.
- A listen-through by you, on headphones, at every seam before you call it done. Two defects in this stage were caught by the user, not by the agent.
