# Stage: rough-cut-export

Load this when `workflow-state.mjs` enters `rough-cut-export`.

## Enters with

- An approved rough cut and resolved caption/axis preferences.

## Do

1. Export **once** with `scripts/promote-job-media.mjs`.
2. Run the basic rough-cut/media lock before completing this stage.
3. Produce `roughcut/a-roll.mp4`.

## Do not

- Re-export repeatedly. The approval was for a specific timeline; export it once and lock it.
- Let post-export media or wording checks rewrite ChatCut's actual clip in/out points. Those checks verify; they do not re-edit.
- Skip the media lock.

## Exits with

- `roughcut/a-roll.mp4` present, passed the basic media lock, and recorded as the stage artifact.

After this the timeline is locked. Everything from here — captions, MG, axis composition — belongs to HyperFrames, not ChatCut.
