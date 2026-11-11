// Turntable alignment from AprilTags seen by the camera. The tags ride on the table and the camera stands still,
// so the table is back at an earlier angle exactly when every tag corner is back where it was in the picture.

// A reference keeps corner positions as fractions of the picture width, so it outlives a change of live-view size
export const toReference = ({ width, height, tags }) => ({
  width,
  height,
  tags: tags.map((tag) => ({ id: tag.id, corners: tag.corners.map((c) => ({ x: Math.round((c.x / width) * 1e6) / 1e6, y: Math.round((c.y / width) * 1e6) / 1e6 })) })),
});

// Corners by "tag:corner" key, in pixels of a picture 1000 wide
const cornerMap = (reference) => {
  const map = new Map();
  for (const tag of reference?.tags || []) tag.corners.forEach((c, i) => map.set(`${tag.id}:${i}`, { x: c.x * 1000, y: c.y * 1000 }));
  return map;
};

// How far the tags are from the reference: root-mean-square corner distance, over tags seen in both
export const tagOffset = (reference, current) => {
  const a = cornerMap(reference);
  const b = cornerMap(current);
  let sum = 0;
  let count = 0;
  const ids = new Set();
  for (const [key, p] of a) {
    const q = b.get(key);
    if (!q) continue;
    sum += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    count += 1;
    ids.add(key.split(':')[0]);
  }
  return count ? { rms: Math.sqrt(sum / count), tags: ids.size } : null;
};

// Closed loop: look, turn a little, look again. The first small turn shows which way and how far the tags move
// per motor step; after that each look gives the steps still missing. Stops when less than half a step is left.
export const alignToTags = async ({ reference, measure, moveBy, isStopped = () => false, log = () => {}, maxIterations = 12, maxStep = 160, probe = 6, tolerance = 1.2 }) => {
  const want = cornerMap(reference);
  if (!want.size) return { ok: false, reason: 'no-reference', moved: 0 };
  let seen = cornerMap(await measure());
  let motion = null; // picture movement of each corner per motor step
  let moved = 0;
  let first = null;
  let last = null;
  for (let i = 0; i <= maxIterations; i++) {
    let sum = 0;
    let count = 0;
    let num = 0;
    let den = 0;
    for (const [key, target] of want) {
      const now = seen.get(key);
      if (!now) continue;
      const dx = target.x - now.x;
      const dy = target.y - now.y;
      sum += dx * dx + dy * dy;
      count += 1;
      const m = motion?.get(key);
      if (m) {
        num += dx * m.x + dy * m.y;
        den += m.x * m.x + m.y * m.y;
      }
    }
    if (!count) return { ok: false, reason: first === null ? 'no-match' : 'lost', moved, start: first, residual: last };
    last = Math.sqrt(sum / count);
    if (first === null) first = last;
    if (isStopped()) return { ok: false, reason: 'stopped', moved, start: first, residual: last };

    let steps;
    if (motion && den > 1e-9) {
      steps = Math.round(num / den);
      // Converged: the table is as close as one step allows, even if something else keeps the tags a little off
      if (steps === 0) return { ok: last <= tolerance, converged: true, reason: last <= tolerance ? null : 'residual', moved, start: first, residual: last, iterations: i };
    } else if (motion) {
      // The table was told to turn and the tags did not move at all
      return { ok: false, reason: 'no-motion', moved, start: first, residual: last };
    } else {
      steps = probe;
    }
    if (i === maxIterations) break;
    steps = Math.max(-maxStep, Math.min(maxStep, steps));
    log(`Tags off by ${last.toFixed(2)}: turning ${steps > 0 ? '+' : ''}${steps} steps`);
    const before = seen;
    await moveBy(steps);
    moved += steps;
    seen = cornerMap(await measure());
    const next = new Map();
    for (const [key, p] of before) {
      const q = seen.get(key);
      if (q) next.set(key, { x: (q.x - p.x) / steps, y: (q.y - p.y) / steps });
    }
    // Keep the earlier estimate for corners that dropped out of sight this time
    if (next.size) motion = next;
    else if (!motion) return { ok: false, reason: 'lost', moved, start: first, residual: last };
  }
  return { ok: last <= tolerance, reason: last <= tolerance ? null : 'residual', moved, start: first, residual: last, iterations: maxIterations };
};
