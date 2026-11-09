import assert from 'node:assert/strict';

import { computeHistogram, computePeaking, peakingThreshold } from '../../src/renderer/core/focusPeaking.js';

// Minimal canvas stand-ins: the "source" is a canvas whose pixels we define
globalThis.ImageData = class {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
};
const makeSource = (w, h, fn) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
};
const makeWork = () => {
  const work = { width: 0, height: 0 };
  let src = null;
  work.getContext = () => ({
    drawImage: (s) => (src = s),
    getImageData: () => {
      if (src.tainted) throw new Error('SecurityError');
      return { data: src.data };
    },
  });
  return work;
};

// A hard vertical edge at x=20 lights up only next to the edge
const edge = makeSource(40, 10, (x) => (x < 20 ? 0 : 255));
const out = computePeaking(edge, makeWork(), { color: '#ffe000', sensitivity: 0.5 });
const lit = (x, y) => out.data[(y * 40 + x) * 4 + 3] === 255;
assert.ok(lit(19, 5) && lit(20, 5));
assert.ok(!lit(5, 5) && !lit(35, 5));
assert.deepEqual([...out.data.slice((5 * 40 + 20) * 4, (5 * 40 + 20) * 4 + 3)], [255, 224, 0]);

// A soft gradient stays dark at low sensitivity and lights up at high sensitivity
const soft = makeSource(40, 10, (x) => x * 6);
const count = (img) => img.data.filter((v, i) => i % 4 === 3 && v === 255).length;
assert.equal(count(computePeaking(soft, makeWork(), { sensitivity: 0.1 })), 0);
assert.ok(count(computePeaking(soft, makeWork(), { sensitivity: 1 })) > 0);
assert.ok(peakingThreshold(1) < peakingThreshold(0));

// Tainted (no CORS) source: null, no throw
assert.equal(computePeaking({ ...edge, tainted: true }, makeWork()), null);

// Histogram: half black, half white
const hist = computeHistogram(edge, makeWork());
assert.equal(hist.total, 400);
assert.equal(hist.bins[0], 200);
assert.equal(hist.bins[255], 200);
assert.equal(hist.shadows, 0.5);
assert.equal(hist.highlights, 0.5);
assert.equal(computeHistogram({ ...edge, tainted: true }, makeWork()), null);
console.log('liveAnalysis ok');
