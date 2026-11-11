import '../vendor/js-aruco2/dictionaries/apriltag_16h5.js';
import '../vendor/js-aruco2/dictionaries/apriltag_25h9.js';
import '../vendor/js-aruco2/dictionaries/apriltag_36h11.js';

import { AR } from '../vendor/js-aruco2/aruco.js';

export const TAG_FAMILIES = [
  { id: 'APRILTAG_36h11', label: '36h11' },
  { id: 'APRILTAG_25h9', label: '25h9' },
  { id: 'APRILTAG_16h5', label: '16h5' },
];

const detectors = {};
const detectorFor = (family) => {
  if (!AR.DICTIONARIES[family]) throw new Error(`Tag family ${family} is not available`);
  // A few wrong bits are tolerated; more than that reads paper texture as a tag
  if (!detectors[family]) detectors[family] = new AR.Detector({ dictionaryName: family, maxHammingDistance: family === 'APRILTAG_16h5' ? 1 : 4 });
  return detectors[family];
};

const toGray = (rgba, n) => {
  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return gray;
};

const sampler = (gray, w, h) => (x, y) => {
  const cx = Math.min(w - 1.001, Math.max(0, x));
  const cy = Math.min(h - 1.001, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * w + x0;
  return gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy) + gray[i + w] * (1 - fx) * fy + gray[i + w + 1] * fx * fy;
};

// Small or steeply tilted tags fall under the detector's size floor; doubling the picture brings them over it
const enlarge = (gray, w, h, factor) => {
  const W = w * factor;
  const H = h * factor;
  const at = sampler(gray, w, h);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0, j = 0; y < H; y++) {
    for (let x = 0; x < W; x++, j += 4) {
      const v = at((x + 0.5) / factor - 0.5, (y + 0.5) / factor - 0.5);
      rgba[j] = v;
      rgba[j + 1] = v;
      rgba[j + 2] = v;
      rgba[j + 3] = 255;
    }
  }
  return { width: W, height: H, data: rgba };
};

// Least-squares line through points, as a point on it and its direction
const fitLine = (pts) => {
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { x: mx, y: my, dx: Math.cos(angle), dy: Math.sin(angle) };
};

const intersect = (a, b) => {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-9) return null;
  const s = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / det;
  return { x: a.x + a.dx * s, y: a.y + a.dy * s };
};

// The detector's corners sit on whole pixels. Each side of the tag is located again from the picture itself
// (where brightness changes fastest across it), and the corners are taken where those four lines cross.
export const refineCorners = (at, corners) => {
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const lines = [];
  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 6) return corners;
    // Unit normal pointing away from the tag
    let nx = (b.y - a.y) / len;
    let ny = -(b.x - a.x) / len;
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const reach = Math.min(4, Math.max(2, len / 8));
    const count = Math.max(6, Math.min(40, Math.round(len / 2)));
    const pts = [];
    for (let i = 0; i < count; i++) {
      const t = 0.15 + (0.7 * i) / (count - 1);
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      // Dark border inside, white paper outside: find the steepest rise along the outward normal
      let best = 0;
      let bestAt = null;
      const profile = [];
      for (let s = -reach; s <= reach + 1e-6; s += 0.5) profile.push(at(px + nx * s, py + ny * s));
      for (let k = 1; k < profile.length - 2; k++) {
        const g = profile[k + 1] - profile[k];
        if (g > best) {
          best = g;
          const before = profile[k] - profile[k - 1];
          const after = profile[k + 2] - profile[k + 1];
          const denom = before - 2 * g + after;
          const shift = Math.abs(denom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / denom)) : 0;
          bestAt = -reach + (k + 0.5 + shift) * 0.5;
        }
      }
      if (bestAt !== null && best > 4) pts.push({ x: px + nx * bestAt, y: py + ny * bestAt });
    }
    if (pts.length < 4) return corners;
    const line = fitLine(pts);
    // Points that do not sit on one straight line were not all on the tag's edge
    const scatter = Math.sqrt(pts.reduce((sum, p) => sum + ((p.x - line.x) * line.dy - (p.y - line.y) * line.dx) ** 2, 0) / pts.length);
    if (scatter > 0.6) return corners;
    lines.push(line);
  }
  const refined = [];
  for (let e = 0; e < 4; e++) {
    const p = intersect(lines[(e + 3) % 4], lines[e]);
    // A refinement that wanders is worse than none
    if (!p || Math.hypot(p.x - corners[e].x, p.y - corners[e].y) > 2.5) return corners;
    refined.push(p);
  }
  return refined;
};

// Finds AprilTags in an RGBA picture. Corners come back in picture pixels, in a fixed order per tag.
export const detectTags = ({ width, height, data }, { family = 'APRILTAG_36h11' } = {}) => {
  const detector = detectorFor(family);
  const gray = toGray(data, width * height);
  const at = sampler(gray, width, height);
  const found = new Map();
  for (const factor of [1, 2]) {
    const image = factor === 1 ? { width, height, data } : enlarge(gray, width, height, factor);
    for (const marker of detector.detect(image)) {
      if (found.has(marker.id)) continue;
      const rough = marker.corners.map((c) => ({ x: (c.x + 0.5) / factor - 0.5, y: (c.y + 0.5) / factor - 0.5 }));
      found.set(marker.id, { id: marker.id, corners: refineCorners(at, rough) });
    }
  }
  return [...found.values()].sort((a, b) => a.id - b.id);
};
