# cut-motion

[中文说明](README.md)

cut-motion is an open Agent workflow that turns a talking-head recording into a tightly edited, captioned, motion-designed video.

## How to use it

You do not need to learn video-editing software, code, or terminal commands. Open this repository in Codex, Claude Code, or a similar coding Agent and describe what you want in natural language.

For example:

```text
Use cut-motion to edit this video:
/Users/your-name/Desktop/video.mov
```

The Agent checks the local environment first. If anything needs to be installed or authenticated, it explains why and asks for your permission before continuing.

## What happens next

1. You provide the local path to the talking-head video.
2. The Agent transcribes it, removes mistakes, repeated takes, reading pauses, and unnecessary dead air.
3. You review the first edited version and the Agent's recommended caption and visual treatment.
4. When animation needs approval, the Agent presents one visual plan with the storyboard, wording, timing, and style.
5. You review the finished preview. After approval, the Agent creates the high-quality final video and tells you its exact file location.
6. If you request changes later, the Agent only redoes the affected parts instead of starting over.

## Two caption styles

- **With subtitles** — the default. Spoken content appears as readable captions, with animation added only where it improves understanding.
- **Without subtitles** — spoken phrases become part of the motion design instead of appearing in a separate subtitle band.

You do not need to choose in advance. If you have no preference, the Agent recommends a suitable mode after reviewing the footage.

## What you can provide

Only the video path is required. You may also provide:

- a script or transcript;
- a preferred caption style;
- visual references;
- an aspect ratio or publishing platform;
- supporting screenshots, product footage, or other material.

Missing preferences do not block the workflow. The Agent analyzes the footage and makes a recommendation.

A reference script may add local visual preferences after a phrase with full-width `【】`, for example `using only AI【MG: cross out AE, Premiere, and CapCut】`. These notes stay out of captions and remain advisory; the Agent still analyzes every unannotated passage for editing and motion opportunities.

## Example requests

- “Edit this talking-head video and keep the pacing natural.”
- “Use subtitles and add motion graphics only at the important explanations.”
- “Do not use subtitles; turn the spoken phrases into motion design.”
- “This version feels too fast. Reopen the same job and relax the pacing.”
- “Keep the edit, but revise the motion layout.”

## For Agents and contributors

The operating contract is in [`AGENTS.md`](AGENTS.md). Environment setup and maintenance commands are in [`docs/agent-setup.md`](docs/agent-setup.md).

## License

cut-motion code, documentation, and reusable templates are released under [Apache-2.0](LICENSE). Third-party tools, fonts, and user media remain subject to their own licenses. See [NOTICE](NOTICE).
