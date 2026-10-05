# cut-motion

[中文](README.md)

A lightweight talking-head editing Skill. ChatCut provides the editable rough cut; HyperFrames handles captions, motion graphics and rendering. The pack retains 13 variable-content MG templates and two A/B stage modules.

Open the repository in a Skill-capable Agent and provide a local video path. An optional reference script helps correct recognition errors while preserving what was actually spoken.

Review is the default: approve the rough cut, then approve one combined caption and motion plan. Explicit Auto mode continues without those waits, using the same production methods. Defaults are vertical video, independent subtitles and A-roll MG overlays. Motion Copy presents complete speech as animated text without a separate subtitle layer.

Each job has one authored `jobs/<id>/plan.json`. Tools generate composition HTML, screenshots and the final movie. Cards stay horizontally centered in the upper-middle area, retain their final size from entry and reveal content at spoken keyword onsets, clear of subtitles.

The execution target for an ordinary two-minute recording is 20 minutes excluding user waits. This is a target awaiting measurement.

Agents start with the [Skill](.agents/skills/cut-motion/SKILL.md). See [integration instructions](.agents/skills/cut-motion/references/chatcut.md) for ChatCut and local tools. Project-local HyperFrames/GSAP installation needs no additional approval; global changes and authentication do.

For template development, `node dev/template-preview.mjs` generates a scrubbable gallery. The preview and privacy utilities in `dev/` are repository tools, not steps in each video job.

Code, documentation and templates use [Apache-2.0](LICENSE). See [NOTICE](NOTICE) for third-party licensing.
