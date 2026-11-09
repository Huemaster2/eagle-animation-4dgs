import assert from 'node:assert/strict';

import { clampCenter, magnifierCrop } from '../../src/renderer/core/magnifier.js';

// Canon 5D Mark II live view is 1024×680
const base = { srcW: 1024, srcH: 680, aspect: 0.5 };
assert.deepEqual(magnifierCrop({ ...base, cx: 0.5, cy: 0.5, zoom: 4 }), { sx: 384, sy: 276, sw: 256, sh: 128 });
// Pushed into a corner, the crop stays inside the picture
assert.deepEqual(magnifierCrop({ ...base, cx: 0, cy: 1, zoom: 4 }), { sx: 0, sy: 552, sw: 256, sh: 128 });
// A very tall view is limited by the picture height and keeps its shape
const tall = magnifierCrop({ srcW: 1024, srcH: 680, cx: 0.5, cy: 0.5, zoom: 2, aspect: 2 });
assert.equal(tall.sh, 680);
assert.equal(tall.sw, 340);
// Clamped centre matches the crop actually shown
assert.deepEqual(clampCenter({ ...base, cx: 0, cy: 0, zoom: 4 }), { cx: 128 / 1024, cy: 64 / 680 });
console.log('magnifier ok');
