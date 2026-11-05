<h1 align="center"><img src="assets/logo.png" alt="cut-motion icon" width="48" align="absmiddle"> cut-motion</h1>

## 🤖 Let your Agent set it up

Using cut-motion for the first time? Copy this prompt into **Codex or an Agent that can work on your computer**:

```text
Set up cut-motion on this computer:
https://github.com/Endless1936/cut-motion

Use the existing checkout if there is one, or clone the repository. Read AGENTS.md and docs/agent-setup.md, run the local environment check, and confirm the current session can call the ChatCut tools.
If ChatCut is missing, follow the official setup guide for my client. Ask before installing a plugin or system tools, changing global Agent settings, or signing in.
Use the project's pinned versions of HyperFrames and GSAP when the job reaches composition.
Tell me which checks passed and what still needs my input. Wait for my local video path before starting an edit.
```

## 🎬 Turn a recording into a finished video

cut-motion is an open-source editing workflow for Agents. ChatCut handles the editable rough cut. HyperFrames adds captions and motion graphics and renders the final video. Give the Agent a local recording and describe the edit you want in plain language.

The [ChatCut setup guides](docs/agent-setup.md#environment-preflight) cover the ChatGPT desktop app's Work and Codex tabs, Claude Code, and WorkBuddy.

## ✂️ From rough cut to final video

1. **Transcribe and cut** — The Agent aligns the transcript with the recording and trims mistakes, repeated takes, and long pauses.
2. **Review the edit and style** — In the default `review` mode, you check the rough cut first, then review the caption, motion, and visual style plans together.
3. **Render and revise** — The Agent exports an MP4. You can adjust captions, layout, or pacing in the same job.

Explicitly choose `auto` to let the Agent continue through the review points. [See the full workflow](docs/workflow.md)

## ✨ Two caption styles

- **With subtitles** — Show the spoken words as readable subtitles and add motion where it helps, such as a card switch between two screenshots.
- **Motion text** — Build the spoken words into the animated layout, styled for the video.

The Agent uses the job defaults when you leave the style open. [Browse the motion templates](templates/motion-graphics/README.md) · [See the visual language](docs/visual-language.md)

## 📎 What you can provide

A local video path is enough to start. You can also share:

- 📝 A script or transcript. Add scene notes in `【】` after a phrase to keep them out of the captions.
- 🖼️ Product screenshots, screen recordings, or visual references.
- 📐 Caption preferences, a publishing platform, or an aspect ratio.

## 💬 Try asking

- “Edit `/path/to/video.mov` and keep the pacing natural.”
- “Add subtitles and show screenshots or recordings when I demonstrate the product.”
- “Keep the rough cut and use the card switch for the two opening images.”

## 🛠️ For Agents and contributors

[`AGENTS.md`](AGENTS.md) · [Setup and maintenance](docs/agent-setup.md) · [中文说明](README.md)

## 📄 License

cut-motion code, documentation, and reusable templates are released under [Apache-2.0](LICENSE). Third-party tools, fonts, and user media remain subject to their own licenses. See [NOTICE](NOTICE).
