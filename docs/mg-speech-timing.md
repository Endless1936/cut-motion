# MG internal speech timing

Multi-element MGs reveal independent content in spoken order. Bind each spoken element to its own keyword onset; do not use template sample intervals or text-length interpolation. A value and its unit can form one semantic element. Context headings and decorative rules may enter at the beat start; attribution, connectors and strikes may follow a content cue by a short explicit frame delay. Use the existing exit anchor and fade, and keep the final content readable before exit.

The approved main-timeline preview provides phrase timing. Its generated `words[0]` / `:word-001` is a whole-entry timing unit, not word-level alignment. Authored phrase caption cues also do not prove a keyword onset.

Apply this during the first composition, after ordinary plan delivery; do not wait for final-video feedback. It is preparation within the existing phase, with no extra approval or workflow state. A single isolated note can use its passage anchor directly.

## Existing ChatCut timing first

Use clip placement from the final approved cut, including any rough-cut review revisions. Reuse the saved timeline-only snapshot that confirmed the last editing batch; if it predates a change, save the current `preview_timeline({views:["timeline"]})` pages once. Refresh `state/timeline-source-windows.json` with `node scripts/prepare-rough-cut.mjs <job> windows <saved-timeline-pages.json>...`. This converts source ranges, frame placement and explicit playback rates without scanning audio, recalculating tightening or editing ChatCut. It also works when tightening was skipped or only partly applied. Use the actual timeline, not the proposed tightening mapping; the main transcript snapshot and source windows must describe the same approved edit. This command handles one source video track; retain an explicit source mapping for other arrangements.

Request `find_transcript` on the approved timeline with `includeWordTimestamps:true` for MG keyword phrases only. Save a private `state/mg-word-lookups.json` with `schemaVersion:1`, `provider:"chatcut.find_transcript"`, project/timeline/asset IDs, and `lookups:[{query,text}]`; `text` is the returned word-bearing response text, without browser handoff URLs. Use `inspect_asset` source transcript ranges if a lookup needs a wider context. Neither route retranscribes the audio.

Run `node scripts/prepare-mg-speech-timing.mjs <job> <job>/state/mg-word-lookups.json --write`. It clips source word timestamps to the locked media windows, maps them through playback rate, and binds them to generated main entries in preview order. Multiple transcript entries can share a single clip. Reveal on the first frame at or after the keyword onset; frame quantization adds less than one frame, separate from ASR alignment accuracy.

In `templateData.revealCues`, provide one cue per fragment `data-at` slot, in DOM order:

- `{keyword:"文案",segmentId:"main-003"}` for spoken content. The keyword is the recorded ASR wording; on-screen copy may be an approved paraphrase.
- `{atStart:true}` for contextual/decorative content.
- `{after:0,delayFrames:6}` for a nonspeech embellishment following the earlier slot at index 0.

Assembly derives template `revealTimes`; composition binds the same resolved timings into custom fragments. Keep custom animation code reading `data-at`. Missing or repeated keyword matches, changed approved snapshots, slot-count differences and reveals outside the beat window fail explicitly. Fetch/refine the affected anchor rather than guessing. Existing jobs without bindings retain their authored timings; those timings alone do not satisfy speech alignment.

## Additional alignment only if necessary

If existing source words are absent or inaccurate on listening, align only affected audio ranges against the corrected spoken text. First check whether the current transcription provider can expose word timing. Otherwise compare a word-timestamp transcription endpoint with forced alignment: retranscription can change wording, whereas alignment preserves a verified transcript. Do not introduce a paid API, new full-video ASR step or mandatory model dependency when existing timing is sufficient. Record the selected provider and source-to-timeline mapping with the result.
