# ChatCut and local finishing

## Connect and import

Use the installed ChatCut connector and its asset-import helper. Client setup guides are [Codex / ChatGPT desktop](https://chatcut.io/chatgpt), [Claude Code](https://chatcut.io/claude) and [WorkBuddy](https://chatcut.io/workbuddy).

Use the plugin's same-machine local-media helper with `import_media action=from_editor` when available. Otherwise use its supported upload-session helper. Follow that client's documented arguments; do not copy flags between helpers. Reuse a ready/existing asset instead of uploading again. Keep the editor open for synchronization and transcription.

Honor existing upload authorization. Ask before a new external upload only when consent is absent; global/system installations, global Agent configuration and OAuth need user authorization. Project-local HyperFrames/GSAP installation is already within normal production scope. Keep credentials out of responses, process output and Git.

If the connector is unavailable, report it and use the client setup guide; do not enumerate endpoints during editing. On a local port permission failure, use the supported escalation once and reuse the confirmed command. Avoid persistent preview services when snapshots suffice.

## Read and lock timing

Use `read_script` and `apply_script` for transcript-driven editing. Script text has no word timing.

After the last editing batch, obtain the approved timeline's transcript/structure once, following `nextOffset` only when returned and retaining the same timeline and filters. Save complete structured responses inside the job; inspect local summaries rather than printing full JSON.

If the locked timeline already has a Caption Program, reuse `read_captions` with `words:true`. Follow its returned pagination contract: use `nextOffset` when provided, or advance `offset` by `returned` when `hasMore` is true; keep the same timeline, revision and filters. Use the original-language audible source, positive-duration absolute token frames and known timing provenance; divide frames by the actual timeline FPS.

Without a Caption Program, query only the needed phrases with `find_transcript includeWordTimestamps:true`, targeted to the locked timeline. Use measured timeline word frames or the returned timeline placements for keyword anchors. Source timestamps need placement mapping before use. A whole-entry `words[0]` from a transcript preview is not word-level timing. If existing timing is still insufficient, align the affected locked-cut audio range through an available tool. Do not estimate keyword times from text length or retranscribe the entire video by default.

Creating a native Caption Program is a fallback when complete caption tokens are actually needed: call non-destructive `edit_captions action=enable`, read `words:true` and its pages, then `edit_captions action=disable` before clean export. Use `refresh` only when the tool reports stale data; never use destructive `reset` for routine timing. Existing native captions must also be disabled for clean A-roll.

Save the full tool result directly. Prefer `structuredContent`; if it is absent, retain the actual text response for the timing helper rather than treating a clipped tool display as JSON. The helper normalizes supported saved responses; a sentence-level timestamp remains sentence-level.

## Export the correct cut

Start or resume one clean A-roll export after rough-cut approval, while preparing the plan. Use a job-specific filename and retain returned project/timeline/render identity in `plan.chatcut`. Recover a completed output before submitting another render.

Before using the downloaded file, match it to that export's filename (allow browser collision suffixes) and reported size when available. Keep the original source separately. Do not substitute an older export from another project.

## Local finishing

From the repository root:

```sh
node .agents/skills/cut-motion/scripts/setup.mjs jobs/<id>
node .agents/skills/cut-motion/scripts/timing.mjs jobs/<id>/chatcut-timing.json jobs/<id>/timing.json --fps 30
node .agents/skills/cut-motion/scripts/compose.mjs jobs/<id>/plan.json jobs/<id>/composition
node .agents/skills/cut-motion/scripts/mg-frames.mjs jobs/<id>/composition jobs/<id>/previews
node .agents/skills/cut-motion/scripts/render.mjs jobs/<id>/composition jobs/<id>/output/final.mp4
```

Use the actual FPS instead of assuming 30 in timing conversion. Timing output is a reusable evidence cache; it does not rewrite approved captions. Setup reuses pinned dependencies. Compose reads the single plan, preserves source audio and generates its HTML plus mechanical rendering metadata. With output arguments omitted, compose writes beside the plan to `composition/`, screenshots to the job's `previews/mg/`, and render to `output/final.mp4`.

View the screenshot images before the full render; a missing image needs a working snapshot route, not a fabricated success claim. Do not replace a failed mandatory subtitle or audio layer with a silent omission. Simplify optional decoration when needed and continue; report what was actually delivered.

Keep generated artifacts and private media inside the job. Revisions change the affected plan content and regenerate derived output; do not hand-patch several caption and transcript files.

For a custom MG, use `template:"custom"` and `data.module` pointing to a job-local directory containing `fragment.html`, `style.css` and `timeline.mjs`. Keep content in the plan; the fragment may interpolate `{{copy[n]}}`. Its root uses `data-motion-group`; reveal slots use `data-at`, replaced from the motion's actual `revealAt`. Timeline code receives `root`, `select`, `beat` and the shared `timeline`, with absolute group timing in `beat.start`/`beat.end`.
