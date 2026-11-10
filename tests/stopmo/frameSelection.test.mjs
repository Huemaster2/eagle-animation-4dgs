import assert from 'node:assert/strict';

import { pruneSelection, selectionClick, selectionStep } from '../../src/renderer/core/frameSelection.js';

const order = ['a', 'b', 'c', 'd', 'e', 'f'];
let s = { order, selected: [], anchor: null };

// Plain click: one frame
s = { order, ...selectionClick(s, 'c') };
assert.deepEqual(s.selected, ['c']);
// Shift-click: everything between anchor and click, either direction
s = { order, ...selectionClick(s, 'e', { shift: true }) };
assert.deepEqual(s.selected, ['c', 'd', 'e']);
s = { order, ...selectionClick(s, 'a', { shift: true }) };
assert.deepEqual(s.selected, ['a', 'b', 'c']);
assert.equal(s.anchor, 'c');
// Cmd/Ctrl-click toggles non-adjacent frames, in timeline order
s = { order, ...selectionClick(s, 'f', { toggle: true }) };
assert.deepEqual(s.selected, ['a', 'b', 'c', 'f']);
s = { order, ...selectionClick(s, 'b', { toggle: true }) };
assert.deepEqual(s.selected, ['a', 'c', 'f']);
assert.equal(s.anchor, 'b');
// Cmd+Shift adds a range to what's there
s = { order, ...selectionClick({ order, selected: ['a'], anchor: 'c' }, 'e', { shift: true, toggle: true }) };
assert.deepEqual(s.selected, ['a', 'c', 'd', 'e']);
// Unknown id leaves things alone
assert.deepEqual(selectionClick(s, 'zz').selected, s.selected);
// Deleted frames drop out
assert.deepEqual(pruneSelection(['a', 'd', 'e'], ['e', 'c', 'a']), ['a', 'e']);

// Arrow keys
let k = selectionStep({ order, selected: [], anchor: null, focus: null }, 1);
assert.deepEqual(k.selected, ['a']);
k = selectionStep({ order, ...k }, 1, { shift: true });
assert.deepEqual(k.selected, ['a', 'b']);
k = selectionStep({ order, ...k }, 1, { shift: true });
assert.deepEqual(k.selected, ['a', 'b', 'c']);
k = selectionStep({ order, ...k }, -1);
assert.deepEqual(k.selected, ['b']);
k = selectionStep({ order, selected: ['f'], anchor: 'f', focus: 'f' }, 1);
assert.deepEqual(k.selected, ['f']);
console.log('frameSelection ok');
