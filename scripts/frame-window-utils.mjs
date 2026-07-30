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
