import { stepsToDegrees } from '@core/turntableMath';

// Full-rotation capture: for each camera height, the table makes one forward turn stopping
// `shotsPerPass` times at equal angles, then completes the circle back to where it started.

const pad = (n, width) => `${n}`.padStart(width, '0');

export const frameFolderName = (number) => `Frame_${pad(number, 4)}`;

export const shotBaseName = (height, index) => `H${height}_${pad(index + 1, 2)}`;

// Heights 1..n, reversed when the camera already sits at the top so it isn't carried back down
export const heightOrder = (heights, currentHeight = null, serpentine = true) => {
  const up = Array.from({ length: Math.max(1, heights) }, (_, i) => i + 1);
  return serpentine && currentHeight === heights && heights > 1 ? up.reverse() : up;
};

// Every stop of the sequence as absolute motor steps. `start` may be fractional (an exact revolution
// multiple); targets are rounded from it so rounding never accumulates over passes or frames.
export const planSequence = ({ start, stepsPerRev, shotsPerPass, heights, currentHeight = null, serpentine = true }) => {
  const n = Math.max(1, Math.round(shotsPerPass));
  const order = heightOrder(heights, currentHeight, serpentine);
  const passes = order.map((height, p) => {
    const base = start + p * stepsPerRev;
    return {
      height,
      shots: Array.from({ length: n }, (_, i) => ({
        height,
        index: i,
        steps: Math.round(base + (i * stepsPerRev) / n),
        offset: (i * 360) / n,
      })),
      // Completing the circle brings the table back to the start angle, still turning forward
      end: Math.round(base + stepsPerRev),
    };
  });
  return { passes, stepsPerRev, total: passes.length * n, endHeight: order[order.length - 1] };
};

export const nextSequenceNumber = (pictures = []) => pictures.reduce((max, p) => Math.max(max, Number(p?.sequence?.number) || 0), 0) + 1;

// Circular distance between two angles in degrees
export const angleGap = (a, b) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};

// Shot of a frame's rotation closest to a table angle, preferring the frame's main height
export const nearestShot = (sequence, angle, height = sequence?.heroHeight) => {
  const shots = (sequence?.shots || []).filter((s) => s.link || s.filename);
  if (!shots.length) return null;
  const sameHeight = shots.filter((s) => s.height === height);
  const pool = sameHeight.length ? sameHeight : shots;
  return pool.reduce((best, s) => (angleGap(s.angle, angle) < angleGap(best.angle, angle) ? s : best), pool[0]);
};

// The photo of a frame's rotation that stands for a view: the one picked by hand for this frame, else the one
// picked for every frame, else the photo nearest the view's motor angle (null when the view has neither)
export const shotForView = (sequence, view, angle = null, defaults = {}) => {
  const usable = (sequence?.shots || []).filter((s) => s.link || s.filename);
  if (!usable.length) return null;
  const find = (pick) => (pick ? usable.find((s) => s.height === pick.height && s.index === pick.index) : null);
  const own = find(sequence?.viewShots?.[view]);
  const picked = own || find(defaults?.[view]);
  if (picked) return { shot: picked, picked: own ? 'frame' : 'all' };
  if (angle === null || angle === undefined) return null;
  const nearest = nearestShot(sequence, angle);
  return nearest ? { shot: nearest, picked: null } : null;
};

export const shotAngle = (steps, stepsPerRev) => {
  const deg = stepsToDegrees(steps, stepsPerRev) % 360;
  return Math.round((deg < 0 ? deg + 360 : deg) * 100) / 100;
};

// Thrown by a capture or a move the user chose to abandon so the whole height can be re-shot
export const redoHeightError = () => Object.assign(new Error('Re-shooting this height'), { redo: true });

// Runs a plan with injected hardware and prompts; records go into the caller's `shots`, so a stop or error keeps them
export const runSequence = async ({
  plan,
  moveTo,
  settle,
  settleMs = 0,
  capture,
  askHeight,
  gate = async () => {},
  redoRequested = () => false,
  redoDone = () => {},
  onPassStart = async () => {},
  onPassEnd = async () => {},
  onProgress = () => {},
  isStopped = () => false,
  needsFirstHeight = false,
  shots = [],
}) => {
  let done = 0;
  let lastHeight = null;
  // Extra full turns made by re-shot heights; added to every target so the table only ever turns forwards
  let turns = 0;
  const at = (steps) => Math.round(steps + turns * plan.stepsPerRev);
  const report = (extra) => onProgress({ done, total: plan.total, ...extra });

  for (let p = 0; p < plan.passes.length;) {
    const pass = plan.passes[p];
    const kept = shots.length;
    const fromDone = done;
    if (p > 0 || turns > 0 || needsFirstHeight) {
      report({ phase: 'height', height: pass.height });
      const go = await askHeight(pass.height, p === 0 && turns === 0);
      if (!go || isStopped()) return { shots, complete: false, endHeight: lastHeight };
    }
    lastHeight = pass.height;
    let redo = false;
    for (const shot of pass.shots) {
      if (isStopped()) return { shots, complete: false, endHeight: lastHeight };
      // Holds here while the run is paused, so the table never moves under a hand
      await gate(shot);
      if (isStopped()) return { shots, complete: false, endHeight: lastHeight };
      if (redoRequested()) {
        redo = true;
        break;
      }
      try {
        report({ phase: 'moving', height: pass.height, index: shot.index });
        const arrived = await moveTo(at(shot.steps));
        if (arrived !== at(shot.steps)) throw new Error(`Turntable stopped at ${arrived} instead of ${at(shot.steps)}`);
        if (settleMs) await settle(settleMs);
        if (isStopped()) return { shots, complete: false, endHeight: lastHeight };
        // The table stands at the first angle of this height: the caller may check and note where it really is
        if (shot === pass.shots[0]) {
          await onPassStart(pass, at(shot.steps));
          if (isStopped()) return { shots, complete: false, endHeight: lastHeight };
        }
        report({ phase: 'shooting', height: pass.height, index: shot.index });
        shots.push(await capture(shot));
        done += 1;
      } catch (err) {
        // A move or a photo the user gave up on: the rest of this height is dropped and shot again
        if (!err?.redo) throw err;
        redo = true;
        break;
      }
    }
    if (!redo) {
      report({ phase: 'returning', height: pass.height });
      const back = await moveTo(at(pass.end));
      if (back !== at(pass.end)) throw new Error(`Turntable stopped at ${back} instead of ${at(pass.end)}`);
      // A full turn later the table should stand exactly where the first photo was taken
      await onPassEnd(pass, at(pass.end));
    }
    if (redo || redoRequested()) {
      // This height starts over: its photos so far are dropped and the table carries on to the same
      // angles one turn further round, so nothing ever has to run backwards
      shots.splice(kept);
      done = fromDone;
      turns += 1;
      redoDone();
      report({ phase: 'returning', height: pass.height });
      try {
        await moveTo(at(pass.shots[0].steps));
      } catch (err) {
        if (!err?.redo) throw err;
      }
      continue;
    }
    p += 1;
  }
  report({ phase: 'done' });
  return { shots, complete: true, endHeight: lastHeight };
};

// Smaller JPEG copy of a captured frame for the timeline strip and per-view playback (originals stay untouched)
export const downscaleFrame = async (frame, maxSide = 1920, quality = 0.88) => {
  const blob = frame instanceof Blob ? frame : new Blob([frame.buffer], { type: frame.type || 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const out = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode preview'))), 'image/jpeg', quality));
  return { type: 'image/jpeg', buffer: await out.arrayBuffer() };
};
