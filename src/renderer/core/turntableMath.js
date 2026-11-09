// Turntable geometry in motor steps. Positions are absolute step counts from the firmware;
// a revolution is a fractional number of steps (200 × 198/13 ≈ 3046.15 with the stock gearing).

export const PERSPECTIVES = ['FRONT', 'RIGHT', 'BACK', 'LEFT'];

export const DEFAULT_STEPS_PER_REV = (200 * 198) / 13;

export const stepsToDegrees = (steps, stepsPerRev = DEFAULT_STEPS_PER_REV) => (Number(steps) / stepsPerRev) * 360;

export const degreesToSteps = (degrees, stepsPerRev = DEFAULT_STEPS_PER_REV) => Math.round((Number(degrees) / 360) * stepsPerRev);

// 0–360° reading of an absolute position, for display
export const angleOf = (steps, stepsPerRev = DEFAULT_STEPS_PER_REV) => {
  const deg = stepsToDegrees(steps, stepsPerRev) % 360;
  return deg < 0 ? deg + 360 : deg;
};

// The same physical angle as `target`, on the revolution closest to `current` (shortest move)
export const nearestEquivalent = (target, current, stepsPerRev = DEFAULT_STEPS_PER_REV) => {
  const turns = Math.round((Number(current) - Number(target)) / stepsPerRev);
  return Math.round(Number(target) + turns * stepsPerRev);
};

// Forward distance from start to end, in (0, one revolution]; equal angles mean a full turn
export const forwardSpan = (start, end, stepsPerRev = DEFAULT_STEPS_PER_REV) => {
  let span = (Number(end) - Number(start)) % stepsPerRev;
  if (span <= 0) span += stepsPerRev;
  return Math.round(span);
};

// N shots from START to END travelling forward: N−1 equal intervals, both endpoints exact.
// The first shot sits on START's angle nearest to `current`.
export const interpolateShots = ({ start, end, shots, current = start, stepsPerRev = DEFAULT_STEPS_PER_REV }) => {
  const n = Math.max(1, Math.round(Number(shots) || 1));
  const first = nearestEquivalent(start, current, stepsPerRev);
  if (n === 1) return [first];
  const span = forwardSpan(start, end, stepsPerRev);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? first + span : first + Math.round((i * span) / (n - 1))));
};

// Firmware replies: "OK …", "ERR …", "DONE <pos>", "POS <pos>", "READY …", "INFO k=v …", "STATUS k=v …"
export const parseLine = (raw = '') => {
  const line = `${raw}`.trim();
  if (!line) return null;
  const [word, ...rest] = line.split(/\s+/);
  const kv = {};
  for (const part of rest) {
    const m = part.match(/^([a-z_0-9]+)=(-?\d+)$/i);
    if (m) kv[m[1]] = Number(m[2]);
  }
  return { type: word.toUpperCase(), args: rest, kv, line };
};
