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
  return { passes, total: passes.length * n, endHeight: order[order.length - 1] };
};

export const nextSequenceNumber = (pictures = []) => pictures.reduce((max, p) => Math.max(max, Number(p?.sequence?.number) || 0), 0) + 1;

// Circular distance between two angles in degrees
const angleGap = (a, b) => {
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

export const shotAngle = (steps, stepsPerRev) => {
  const deg = stepsToDegrees(steps, stepsPerRev) % 360;
  return Math.round((deg < 0 ? deg + 360 : deg) * 100) / 100;
};

// Runs a plan with injected hardware and prompts; records go into the caller's `shots`, so a stop or error keeps them
export const runSequence = async ({ plan, moveTo, settle, settleMs = 0, capture, askHeight, onProgress = () => {}, isStopped = () => false, needsFirstHeight = false, shots = [] }) => {
  let done = 0;
  let lastHeight = null;
  const report = (extra) => onProgress({ done, total: plan.total, ...extra });

  for (let p = 0; p < plan.passes.length; p++) {
    const pass = plan.passes[p];
    if (p > 0 || needsFirstHeight) {
      report({ phase: 'height', height: pass.height });
      const go = await askHeight(pass.height, p === 0);
      if (!go || isStopped()) return { shots, complete: false, endHeight: lastHeight };
    }
    lastHeight = pass.height;
    for (const shot of pass.shots) {
      if (isStopped()) return { shots, complete: false, endHeight: lastHeight };
      report({ phase: 'moving', height: pass.height, index: shot.index });
      const arrived = await moveTo(shot.steps);
      if (arrived !== shot.steps) throw new Error(`Turntable stopped at ${arrived} instead of ${shot.steps}`);
      if (settleMs) await settle(settleMs);
      if (isStopped()) return { shots, complete: false, endHeight: lastHeight };
      report({ phase: 'shooting', height: pass.height, index: shot.index });
      shots.push(await capture(shot));
      done += 1;
    }
    report({ phase: 'returning', height: pass.height });
    const back = await moveTo(pass.end);
    if (back !== pass.end) throw new Error(`Turntable stopped at ${back} instead of ${pass.end}`);
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
