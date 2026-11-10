import assert from 'node:assert/strict';

import { frameFolderName, heightOrder, nearestShot, nextSequenceNumber, planSequence, runSequence, shotAngle, shotBaseName } from '../../src/renderer/core/captureSequence.js';

const REV = (200 * 198) / 13;

assert.equal(frameFolderName(7), 'Frame_0007');
assert.equal(shotBaseName(2, 0), 'H2_01');
assert.equal(shotBaseName(3, 24), 'H3_25');

// Serpentine: back down only when the camera already sits at the top
assert.deepEqual(heightOrder(3, null), [1, 2, 3]);
assert.deepEqual(heightOrder(3, 3), [3, 2, 1]);
assert.deepEqual(heightOrder(3, 3, false), [1, 2, 3]);
assert.deepEqual(heightOrder(1, 1), [1]);

// 25 per turn, 3 heights, full circle
const plan = planSequence({ start: 1000, stepsPerRev: REV, shotsPerPass: 25, heights: 3 });
assert.equal(plan.total, 75);
assert.equal(plan.passes.length, 3);
assert.equal(plan.passes[0].shots[0].steps, 1000);
assert.equal(plan.passes[0].shots[1].offset, 14.4);
// Equal spacing within one step of the exact value, every pass starting on the same angle
for (const pass of plan.passes) {
  pass.shots.forEach((s, i) => assert.ok(Math.abs(s.steps - (pass.shots[0].steps + (i * REV) / 25)) <= 1));
}
plan.passes.forEach((pass, p) => assert.ok(Math.abs(pass.shots[0].steps - (1000 + p * REV)) <= 0.5));
assert.equal(plan.passes[0].end, plan.passes[1].shots[0].steps);
// No drift: after many frames the end stays within half a step of the exact revolution count
const far = planSequence({ start: 1000 + 400 * REV, stepsPerRev: REV, shotsPerPass: 25, heights: 3 });
assert.ok(Math.abs(far.passes[2].end - (1000 + 403 * REV)) <= 0.5);
assert.equal(planSequence({ start: 0, stepsPerRev: REV, shotsPerPass: 25, heights: 3, currentHeight: 3 }).endHeight, 1);

assert.equal(nextSequenceNumber([]), 1);
assert.equal(nextSequenceNumber([{ sequence: { number: 4 } }, {}, { sequence: { number: 2 } }]), 5);
assert.equal(shotAngle(REV / 4, REV), 90);
assert.equal(shotAngle(-REV / 4, REV), 270);

// nearestShot prefers the main height, wraps around 0°
const seq = {
  heroHeight: 2,
  shots: [
    { height: 1, angle: 90, link: 'a' },
    { height: 2, angle: 0, link: 'b' },
    { height: 2, angle: 345.6, link: 'c' },
    { height: 2, angle: 180, link: 'd' },
  ],
};
assert.equal(nearestShot(seq, 350).link, 'c');
assert.equal(nearestShot(seq, 100).link, 'd');
assert.equal(nearestShot(seq, 90, 1).link, 'a');
assert.equal(nearestShot({ shots: [] }, 0), null);

// Runner with a fake table: order of moves, prompts, captures; stop keeps what was shot
const small = planSequence({ start: 0, stepsPerRev: 400, shotsPerPass: 4, heights: 2 });
const log = [];
let position = 0;
const moveTo = async (s) => {
  log.push(`move ${s}`);
  position = s;
  return s;
};
const capture = async (shot) => {
  log.push(`shoot H${shot.height}#${shot.index} @${position}`);
  return { height: shot.height, index: shot.index };
};
const result = await runSequence({ plan: small, moveTo, settle: async () => log.push('settle'), settleMs: 10, capture, askHeight: async (h) => log.push(`ask ${h}`) && true });
assert.equal(result.complete, true);
assert.equal(result.shots.length, 8);
assert.equal(result.endHeight, 2);
assert.deepEqual(log.filter((l) => l.startsWith('shoot')), ['shoot H1#0 @0', 'shoot H1#1 @100', 'shoot H1#2 @200', 'shoot H1#3 @300', 'shoot H2#0 @400', 'shoot H2#1 @500', 'shoot H2#2 @600', 'shoot H2#3 @700']);
assert.deepEqual(log.filter((l) => l.startsWith('ask')), ['ask 2']);
assert.equal(position, 800);
// The camera never fires while the table is between stops: every shoot follows a settle
log.forEach((l, i) => l.startsWith('shoot') && assert.equal(log[i - 1], 'settle'));

// Declining the height prompt stops after the first pass with its 4 shots kept
const kept = [];
const stopped = await runSequence({ plan: small, moveTo, settle: async () => {}, capture, askHeight: async () => false, shots: kept });
assert.equal(stopped.complete, false);
assert.equal(kept.length, 4);

// Pausing holds before a shot and never moves the table meanwhile; resuming carries on where it left off
const paused = [];
let held = 0;
let moves = 0;
const pausedRun = await runSequence({
  plan: small,
  shots: paused,
  moveTo: async (s) => {
    moves += 1;
    position = s;
    return s;
  },
  settle: async () => {},
  capture,
  askHeight: async () => true,
  gate: async (shot) => {
    if (shot.height !== 1 || shot.index !== 2) return;
    held += 1;
    const movesWhilePaused = moves;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(moves, movesWhilePaused);
  },
});
assert.equal(held, 1);
assert.equal(pausedRun.complete, true);
assert.equal(paused.length, 8);

// Stopping while paused keeps the shots taken so far and takes no more
const stoppedWhilePaused = [];
let release = null;
let stop = false;
const run = runSequence({
  plan: small,
  shots: stoppedWhilePaused,
  moveTo,
  settle: async () => {},
  capture,
  askHeight: async () => true,
  isStopped: () => stop,
  gate: (shot) => (shot.height === 1 && shot.index === 2 ? new Promise((resolve) => (release = resolve)) : Promise.resolve()),
});
await new Promise((resolve) => setTimeout(resolve, 20));
stop = true;
release();
const afterStop = await run;
assert.equal(afterStop.complete, false);
assert.equal(stoppedWhilePaused.length, 2);

// A table that stops short is an error, and the shots before it are still in the caller's list
const partial = [];
await assert.rejects(
  runSequence({ plan: small, moveTo: async (s) => (s === 200 ? 150 : s), settle: async () => {}, capture, askHeight: async () => true, shots: partial }),
  /stopped at 150/
);
assert.equal(partial.length, 2);
console.log('captureSequence ok');
