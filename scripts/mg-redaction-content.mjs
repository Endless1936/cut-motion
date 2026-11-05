/** Redaction groups with fixed-size rectangles and optional position tracks. */
export function redactionContent(data, beat) {
  const finite = (value, name, minimum = -Infinity) => {
    if (!Number.isFinite(value) || value < minimum) throw new Error(`${beat.id}: ${name} must be finite and >= ${minimum}`);
    return value;
  };
  const dimension = (value, name) => {
    finite(value, name, 0);
    if (!value) throw new Error(`${beat.id}: ${name} must be positive`);
    return value;
  };
  const color = value => {
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${beat.id}: mask color needs a six-digit hex color`);
    return value;
  };
  const opacity = value => {
    finite(value, "mask opacity", 0);
    if (value > 1) throw new Error(`${beat.id}: mask opacity must be <= 1`);
    return value;
  };
  const frame = {x:0,y:0,width:1080,height:1920,...data.frame};
  finite(frame.x,"frame.x");finite(frame.y,"frame.y");
  dimension(frame.width,"frame.width");dimension(frame.height,"frame.height");
  const coordinateSize = {width:frame.width,height:frame.height,...data.coordinateSize};
  dimension(coordinateSize.width,"coordinateSize.width");dimension(coordinateSize.height,"coordinateSize.height");
  const fill = color(data.color ?? "#2b2a2c"), alpha = opacity(data.opacity ?? 1);
  if (!Array.isArray(data.masks) || !data.masks.length) throw new Error(`${beat.id}: redaction-mask needs masks`);
  const duration = dimension(beat.end - beat.start,"beat duration"), identifiers = new Set();
  const percent = (value, size) => `${Number((value / size * 100).toFixed(7))}%`;
  const masks = data.masks.map((mask,index) => {
    const id = mask.id ?? `mask-${index+1}`;
    if (typeof id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/i.test(id) || identifiers.has(id)) throw new Error(`${beat.id}: mask IDs must be unique identifiers`);
    identifiers.add(id);
    const maskColor = color(mask.color ?? fill), maskOpacity = opacity(mask.opacity ?? alpha);
    if (!Array.isArray(mask.rects) || !mask.rects.length) throw new Error(`${beat.id}: each mask needs rectangles`);
    const rects = mask.rects.map(rect => {
      const {x,y,width,height} = rect;
      finite(x,"rectangle.x",0);finite(y,"rectangle.y",0);
      dimension(width,"rectangle.width");dimension(height,"rectangle.height");
      if (x+width>coordinateSize.width || y+height>coordinateSize.height) throw new Error(`${beat.id}: mask rectangle exceeds coordinateSize`);
      const radius = finite(rect.radius ?? 2,"rectangle.radius",0);
      if (radius > Math.min(width,height)/2) throw new Error(`${beat.id}: mask radius exceeds rectangle`);
      const positions = rect.positions;
      if (positions !== undefined) {
        if (!Array.isArray(positions) || !positions.length) throw new Error(`${beat.id}: positions needs at least one [time, x, y] keyframe`);
        let previousTime = -1;
        for (const position of positions) {
          if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) throw new Error(`${beat.id}: positions needs [time, x, y] keyframes`);
          const [time,left,top] = position;
          if (time < 0 || time <= previousTime || time > duration + 1e-6) throw new Error(`${beat.id}: position times must increase within the beat`);
          if (left < 0 || top < 0 || left+width > coordinateSize.width || top+height > coordinateSize.height) throw new Error(`${beat.id}: tracked rectangle exceeds coordinateSize`);
          previousTime = time;
        }
      }
      return {x,y,width,height,radius,...(positions ? {positions} : {})};
    });
    const fade = Math.min(.1,duration/2);
    const windows = mask.windows ?? [[0,fade,duration-fade,duration]];
    if (!Array.isArray(windows) || !windows.length) throw new Error(`${beat.id}: each mask needs timing windows`);
    let previousEnd = 0;
    for (const window of windows) {
      if (!Array.isArray(window) || window.length !== 4 || !window.every(Number.isFinite)) throw new Error(`${beat.id}: windows need four finite relative times`);
      const [start,covered,out,clear] = window;
      if (!(start>=previousEnd && start<=covered && covered<=out && out<=clear && clear<=duration && clear>start)) throw new Error(`${beat.id}: mask windows must be ordered, nonoverlapping and inside the beat`);
      previousEnd=clear;
    }
    return {id,rects,windows:windows.map(window=>[...window]),color:maskColor,opacity:maskOpacity};
  });
  const rectMarkup = ({x,y,width,height,radius,positions}) => {
    const left = value => percent(value,coordinateSize.width);
    const top = value => percent(value,coordinateSize.height);
    const track = positions ? ` data-positions='${JSON.stringify(positions.map(([time,x,y])=>[time,left(x),top(y)]))}'` : "";
    return `<i class="redaction-rect"${track} style="left:${left(x)};top:${top(y)};width:${left(width)};height:${top(height)};border-radius:${percent(radius,width)} / ${percent(radius,height)}"></i>`;
  };
  const body = `<div class="redaction-frame" style="left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px">${masks.map(mask=>`<div class="redaction-region" data-mask-id="${mask.id}" data-windows='${JSON.stringify(mask.windows)}' data-opacity="${mask.opacity}" style="--redaction-color:${mask.color}">${mask.rects.map(rectMarkup).join("")}</div>`).join("")}</div>`;
  return {body,copy:[],axis:"vertical",normalizedData:{frame,coordinateSize,color:fill,opacity:alpha,masks}};
}
