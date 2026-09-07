import { assertCaptionSequence, captionFrameWindow } from "./frame-window-utils.mjs";

export const createTimelineCut = (fps, startFrame, endFrame) => {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("A declared positive fps is required; do not infer 30 fps");
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)) throw new Error("Cut boundaries must be integer frames");
  captionFrameWindow({ id: "Cut", startFrame, endFrame });
  return Object.freeze({ fps, startFrame, endFrame, removedFrames: endFrame - startFrame,
    start: startFrame / fps, end: endFrame / fps, removedSeconds: (endFrame - startFrame) / fps });
};

export const cutFromSeconds = (fps, start, end) => {
  const frames = [start, end].map((time) => {
    const exact = time * fps;
    const rounded = Math.round(exact);
    if (!Number.isFinite(time) || !Number.isFinite(exact) || Math.abs(exact - rounded) > 0.0001) {
      throw new Error("Cut seconds must align with the declared fps; choose integer frame boundaries first");
    }
    return rounded;
  });
  return createTimelineCut(fps, ...frames);
};

const placement = (start, end, cutStart, cutEnd, id) => {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error(`${id}: invalid timeline window`);
  if (end <= cutStart) return "before";
  if (start >= cutEnd) return "after";
  if (start >= cutStart && end <= cutEnd) return "removed";
  throw new Error(`${id}: crosses a cut boundary; re-align this item instead of clamping or splitting it automatically`);
};

export const retimeDocument = (document, cut) => {
  const result = structuredClone(document);
  if (Array.isArray(result.cues) && Array.isArray(result.beats)) throw new Error("Pass captions and Beat Maps separately with the same cut");
  const declaredFps = result.source?.fps ?? result.fps;
  if (declaredFps !== undefined && declaredFps !== cut.fps) throw new Error("Document fps differs from the cut fps");
  if (Number.isFinite(result.duration)) {
    if (result.duration + 1e-6 < cut.end) throw new Error("Cut extends beyond the document duration");
    result.duration -= cut.removedSeconds;
  }
  const removedIds = [];
  if (Array.isArray(result.cues)) {
    assertCaptionSequence(result.cues);
    result.cues = result.cues.filter((cue) => {
      const side = placement(cue.startFrame, cue.endFrame, cut.startFrame, cut.endFrame, cue.id);
      if (side === "removed") { removedIds.push(cue.id); return false; }
      if (side === "after") { cue.startFrame -= cut.removedFrames; cue.endFrame -= cut.removedFrames; }
      cue.start = cue.startFrame / cut.fps;
      cue.end = cue.endFrame / cut.fps;
      return true;
    });
    assertCaptionSequence(result.cues);
  } else if (Array.isArray(result.beats)) {
    // Match the seconds-input tolerance, without quantizing semantic times away
    // from a cut. Six-decimal serialization must not turn a seam into a crossing.
    const atBoundary = (time) => {
      if (!Number.isFinite(time)) return time;
      for (const boundary of [cut.start, cut.end]) {
        if (Math.abs(time - boundary) * cut.fps <= 0.0001) return boundary;
      }
      return time;
    };
    result.beats = result.beats.filter((beat) => {
      beat.start = atBoundary(beat.start);
      beat.end = atBoundary(beat.end);
      const side = placement(beat.start, beat.end, cut.start, cut.end, beat.id);
      if (side === "removed") { removedIds.push(beat.id); return false; }
      const shiftTime = (time) => {
        if (!Number.isFinite(time) || time < 0) throw new Error(`${beat.id}: invalid event time`);
        time = atBoundary(time);
        if (time >= cut.start && time < cut.end) throw new Error(`${beat.id}: event lies in the deleted passage; re-align the Beat`);
        if (side === "before" && time > cut.start || side === "after" && time < cut.end) {
          throw new Error(`${beat.id}: event crosses a cut boundary; re-align the Beat`);
        }
        return side === "after" ? time - cut.removedSeconds : time;
      };
      if (beat.audioAnchorTime !== undefined) beat.audioAnchorTime = shiftTime(beat.audioAnchorTime);
      for (const event of beat.microEvents ?? []) event.time = shiftTime(event.time);
      if (side === "after") { beat.start -= cut.removedSeconds; beat.end -= cut.removedSeconds; }
      // Beat schemas use seconds. Reject mixed representations instead of leaving stale frame fields.
      if (beat.startFrame !== undefined || beat.endFrame !== undefined) throw new Error(`${beat.id}: mixed Beat frame/second fields are unsupported`);
      return true;
    });
  } else {
    throw new Error("Only released captions (cues) and Beat Maps (beats) are supported; transcript words and media require their own re-alignment");
  }
  return { document: result, removedIds, cut };
};
