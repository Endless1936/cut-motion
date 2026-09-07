export const quantizeFrameWindow = (start, end, fps, totalFrames) => ({
  startFrame: Math.max(0, Math.min(totalFrames, Math.floor(Number(start) * fps))),
  endFrame: Math.max(0, Math.min(totalFrames, Math.ceil(Number(end) * fps)))
});

export const captionFrameWindow = (cue, totalFrames = Number.POSITIVE_INFINITY) => {
  const startFrame = Number(cue?.startFrame);
  const endFrame = Number(cue?.endFrame);
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame)
    || startFrame < 0 || endFrame <= startFrame || endFrame > totalFrames) {
    throw new Error(`${cue?.id ?? "Caption cue"} requires a positive half-open integer frame window`);
  }
  return { startFrame, endFrame };
};

export const intersectFrameWindows = (left, right) => {
  const startFrame = Math.max(left.startFrame, right.startFrame);
  const endFrame = Math.min(left.endFrame, right.endFrame);
  return endFrame > startFrame ? { startFrame, endFrame } : null;
};

export const frameWindowsOverlap = (left, right) => intersectFrameWindows(left, right) !== null;

export const assertCaptionSequence = (cues, totalFrames = Number.POSITIVE_INFINITY) => {
  if (!Array.isArray(cues)) throw new Error("Caption cues must be an array");
  const ids = new Set();
  let previous = null;
  for (const cue of cues) {
    const window = captionFrameWindow(cue, totalFrames);
    if (typeof cue.id !== "string" || !cue.id || ids.has(cue.id)) throw new Error(`Duplicate or missing caption ID: ${cue.id}`);
    if (previous && window.startFrame < previous.endFrame) throw new Error(`${cue.id}: overlaps or precedes the previous caption cue`);
    ids.add(cue.id);
    previous = window;
  }
};

// Both attributes derive from the same absolute endpoints. Independent rounding
// or (endFrame - startFrame) / fps can leave the outgoing cue visible at the seam.
export const frameWindowTiming = (window, fps) => {
  captionFrameWindow(window);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Timeline fps must be positive");
  const start = window.startFrame / fps;
  const end = window.endFrame / fps;
  let duration = end - start;
  if (start + duration > end) duration -= Number.EPSILON * Math.max(1, duration);
  if (!(duration > 0) || start + duration > end) throw new Error("Frame window cannot be represented safely");
  return { start, end, duration };
};
