import assert from 'node:assert/strict';
const { getOnionLayers } = await import('@core/onionSkin');
const { resolvePerspectiveLink, referenceMatchesPerspective } = await import('@core/perspectives');
const pictures = [
  { id: 'a', link: 'A.jpg', perspective: 'FRONT' },
  { id: 'b', link: 'B.jpg', perspective: 'FRONT' },
  { id: 'c', link: 'C.jpg' },
];
const views = { a: { RIGHT: { link: 'A-right.jpg' } }, b: {} };
const layers = (p) => getOnionLayers({ pictures, currentFrameId: false, config: { ENABLED: true, PREVIOUS_COUNT: 3 }, resolveLink: (f) => resolvePerspectiveLink(f, p, views) }).map((l) => l.link);
assert.deepEqual(layers(null), ['A.jpg', 'B.jpg', 'C.jpg']);
assert.deepEqual(layers('FRONT'), ['A.jpg', 'B.jpg', 'C.jpg']);
assert.deepEqual(layers('RIGHT'), ['A-right.jpg', 'C.jpg']); // B was shot from FRONT and has no RIGHT snapshot
assert.ok(referenceMatchesPerspective({}, 'LEFT'));
assert.ok(referenceMatchesPerspective({ perspective: 'LEFT' }, null));
assert.ok(!referenceMatchesPerspective({ perspective: 'LEFT' }, 'RIGHT'));
console.log('perspective onion OK');
