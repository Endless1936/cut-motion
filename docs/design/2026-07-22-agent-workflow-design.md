# cut-motion Agent Workflow Design

> Historical design record. `AGENTS.md` and the top-level workflow documentation define current behavior.

## Goal

Given a talking-head video and an optional transcript, an Agent can produce a clean rough cut, phrase-synchronized motion design, and final render without relying on a traditional workflow graph.

## Architecture

`AGENTS.md` controls decisions and stage gates. JSON state files connect stages. Shell scripts perform deterministic media operations. HyperFrames owns composition timing and rendering. Motion recipes preserve quality without turning the system into a fixed-template generator.

## Pipeline

1. Probe source and establish immutable inputs.
2. Transcribe when needed.
3. Build an editable ChatCut rough cut.
4. Detect and conservatively remove dead air with FFmpeg.
5. Generate a phrase-level beat map.
6. Prove the visual language with a short sample.
7. Author a seek-safe HyperFrames and GSAP composition.
8. Validate sync, layout, motion, and audio.
9. Preview and render.

## State boundary

Each stage reads and writes versionable JSON under the job's `state/` directory. Media outputs remain replaceable artifacts; decisions remain inspectable text.

## Quality strategy

The system uses a gold-standard reference plus semantic motion recipes. Recipes define intent, timing behavior, and failure modes—not coordinates or a single look. Automated checks catch timing and layout defects; the visual-language document prevents regressions toward dirty overlays, tiny typography, repetitive PPT transitions, and empty components.

## Extensibility

Additional transcription engines, motion recipes, and render backends can be added without changing the canonical stages. Remotion or Vibe Motion may be optional adapters, but HyperFrames remains the default renderer.
