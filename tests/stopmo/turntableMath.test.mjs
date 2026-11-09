import assert from 'node:assert/strict';
import * as m from '@core/turntableMath';
const R = m.DEFAULT_STEPS_PER_REV;
// 19 shots from 0 to 3046 (just under a full turn) -> endpoints exact, 18 intervals
let s = m.interpolateShots({ start: 0, end: 2885, shots: 19 });
assert.equal(s.length, 19); assert.equal(s[0], 0); assert.equal(s[18], 2885);
const gaps = s.slice(1).map((v, i) => v - s[i]); assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, gaps);
// wrap: start 3000 end 100 -> forward through zero
s = m.interpolateShots({ start: 3000, end: 100, shots: 3, current: 3000 });
assert.deepEqual(s, [3000, 3073, 3146]); // 3146 ≈ 100 + one rev (3146.15)
// current several turns later: starts on nearest equivalent
s = m.interpolateShots({ start: 0, end: 1523, shots: 2, current: 9200 });
assert.equal(s[0], Math.round(3 * R)); assert.equal(s[1] - s[0], 1523);
// equal angles = full turn
assert.equal(m.forwardSpan(500, 500), Math.round(R));
assert.equal(m.nearestEquivalent(100, 3100), Math.round(100 + R));
assert.equal(m.nearestEquivalent(3000, 50), Math.round(3000 - R));
assert.equal(Math.round(m.angleOf(-Math.round(R / 4))), 270);
assert.equal(m.degreesToSteps(90), Math.round(R / 4));
assert.deepEqual(m.parseLine('STATUS pos=-12 target=40 moving=1 enabled=1').kv, { pos: -12, target: 40, moving: 1, enabled: 1 });
assert.equal(m.parseLine('DONE 1523').args[0], '1523');
assert.equal(m.parseLine('   '), null);
console.log('turntable math OK');
