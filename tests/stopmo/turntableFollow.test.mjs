import assert from 'node:assert/strict';

import { createAngleFollower } from '../../src/renderer/core/turntableFollow.js';

// Fake table: each move takes 20 ms; moving twice at once must never happen
const rev = 3600;
const table = {
  state: { connected: true, position: 0, stepsPerRev: rev, moving: false },
  moves: [],
  async moveTo(steps) {
    assert.equal(this.state.moving, false, 'moveTo called while moving');
    this.state.moving = true;
    this.moves.push(steps);
    await new Promise((r) => setTimeout(r, 20));
    this.state.position = steps;
    this.state.moving = false;
    return steps;
  },
};

const follow = createAngleFollower(table);
// A drag: many targets in quick succession; only the first and the latest should be visited
const done = follow.setTarget(10);
for (let d = 11; d <= 90; d++) follow.setTarget(d);
await done;
assert.deepEqual(table.moves, [100, 900]);

// Wrap-around takes the short way: 350° from 0.5 turns ahead lands just below one turn
table.moves = [];
table.state.position = 100;
await follow.setTarget(350);
assert.deepEqual(table.moves, [-100]);

// Same spot again: no move
await follow.setTarget(350);
assert.deepEqual(table.moves, [-100]);
console.log('turntableFollow ok');
