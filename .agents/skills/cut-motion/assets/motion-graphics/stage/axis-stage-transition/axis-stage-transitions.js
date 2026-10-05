// Promoted from the approved Book Video stage transition.
(() => {
  const DEFAULT_FRAME = { width: 1080, height: 1920 };
  const DEFAULT_PIP = { left: 46, bottom: 184, size: 222 };

  window.addAxisStageTransitions = (
    timeline,
    { root, speaker, intervals, duration = 0.8, frame = DEFAULT_FRAME, pip = DEFAULT_PIP }
  ) => {
    const dimensions = { ...DEFAULT_FRAME, ...frame };
    const pictureInPicture = { ...DEFAULT_PIP, ...pip };
    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const fullRadius = Math.ceil(Math.hypot(centerX, centerY)) + 8;
    const fullClip = `circle(${fullRadius}px at ${centerX}px ${centerY}px)`;
    const pipClip = `circle(${centerX}px at ${centerX}px ${centerY}px)`;
    const scale = pictureInPicture.size / dimensions.width;
    const pipY = pictureInPicture.top ?? dimensions.height - pictureInPicture.bottom - pictureInPicture.size;

    intervals.forEach(([start, end]) => {
      timeline.set(root, { attr: { "data-stage": "true" }, immediateRender: false }, start);
      timeline.set(speaker, { attr: { "data-picture-in-picture": "true" }, immediateRender: false }, start);
      timeline.fromTo(speaker,
        { x: 0, y: 0, scale: 1, borderRadius: 0, clipPath: fullClip },
        { x: pictureInPicture.left, y: pipY, scale, borderRadius: 0, clipPath: pipClip, duration, ease: "power2.inOut", immediateRender: false },
        start);
      timeline.to(speaker,
        { x: 0, y: 0, scale: 1, borderRadius: 0, clipPath: fullClip, duration, ease: "power2.inOut" },
        end - duration);
      timeline.set(speaker, { attr: { "data-picture-in-picture": "false" }, immediateRender: false }, end);
      timeline.set(root, { attr: { "data-stage": "false" }, immediateRender: false }, end);
    });
  };
})();
