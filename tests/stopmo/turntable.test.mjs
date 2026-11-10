import assert from 'node:assert/strict';

// Fake StopMo firmware behind a fake Web Serial port (timing compressed)
const makeBoard = ({ doubleReset = false } = {}) => {
  let resetting = false;
  let ctrl; let pos = 0; let target = 0; let moving = false; let jogDir = 0; let lastJog = 0; let timer = null; const sent = [];
  const out = (s) => ctrl.enqueue(new TextEncoder().encode(s + '\r\n'));
  const tick = () => {
    if (jogDir) { if (Date.now() - lastJog > 250) { jogDir = 0; finish(); return; } pos += jogDir * 5; }
    else if (pos !== target) pos += Math.sign(target - pos) * Math.min(25, Math.abs(target - pos));
    out(`POS ${pos}`);
    if (!jogDir && pos === target) finish();
  };
  const finish = () => { clearInterval(timer); timer = null; moving = false; out(`DONE ${pos}`); };
  const start = () => { moving = true; timer = timer || setInterval(tick, 10); };
  let line = '';
  const handle = (cmd) => {
    sent.push(cmd);
    if (resetting) return; const [name, a, b, c] = cmd.split(' ');
    if (name === 'PING') out('OK PONG StopMoTurntable 2');
    else if (name === 'INFO') out(`INFO fw=2 microsteps=1 steps_per_rev_x1000=3046154 pos=${pos} backlash=20 run_us=950 start_us=1500 ramp=12 enabled=0`);
    else if (name === 'ENABLE') out(`OK ENABLE ${a}`);
    else if (name === 'SETPOS') { if (moving) return out('ERR BUSY'); pos = target = Number(a); out(`OK SETPOS ${pos}`); }
    else if (name === 'MOVETO') { if (moving) return out('ERR BUSY'); target = Number(a); out(`OK MOVETO ${a}`); start(); }
    else if (name === 'JOG') { if (moving && !jogDir) return out('ERR BUSY'); jogDir = Number(a); lastJog = Date.now(); if (!moving) { out(`OK JOG ${a}`); start(); } else out(`OK JOG ${a}`); }
    else if (name === 'STOP') { out('OK STOP'); if (moving) { jogDir = 0; target = pos; } }
    else out(`ERR UNKNOWN ${name}`);
  };
  const port = {
    sent, get pos() { return pos; }, getInfo: () => ({ usbVendorId: 0x2341, usbProductId: 0x0043 }),
    async open() {
      this.readable = new ReadableStream({ start(c) { ctrl = c; setTimeout(() => { out('READY StopMoTurntable 2'); if (doubleReset) resetting = true; }, 30);
        // CH340-on-macOS behaviour: a second reset shortly after opening; anything sent meanwhile is lost
        if (doubleReset) { setTimeout(() => { resetting = false; out('READY StopMoTurntable 2'); }, 400); } } });
      this.writable = new WritableStream({ write(chunk) { line += new TextDecoder().decode(chunk); let i; while ((i = line.indexOf('\n')) >= 0) { handle(line.slice(0, i).trim()); line = line.slice(i + 1); } } });
    },
    async close() { try { ctrl.close(); } catch {} },
  };
  return port;
};

const board = makeBoard();
Object.defineProperty(globalThis, "navigator", { value: { serial: { addEventListener() {}, getPorts: async () => [{ getInfo: () => ({}) }, board], requestPort: async () => board } }, configurable: true });
const { turntable } = await import('@core/turntable');

await turntable.connect({ restorePosition: 1000 });
assert.equal(turntable.state.connected, true);
assert.equal(turntable.state.position, 1000);
assert.ok(Math.abs(turntable.state.stepsPerRev - 3046.154) < 1e-6);
assert.ok(board.sent.includes('SETPOS 1000') && board.sent.includes('ENABLE 1'));

const arrivals = [];
turntable.onArrival((p) => arrivals.push(p));
let p = await turntable.moveTo(1500);
assert.equal(p, 1500); assert.equal(turntable.state.moving, false); assert.deepEqual(arrivals, [1500]);

// A second move while moving is refused locally (no conflicting motor commands)
const first = turntable.moveTo(1000);
await assert.rejects(turntable.moveTo(2000), /still moving/);
assert.equal(await first, 1000);

// Hold to rotate: keep-alives keep it turning; release stops it
await turntable.jogStart(1);
await new Promise((r) => setTimeout(r, 400));
const jogs = board.sent.filter((s) => s === 'JOG 1').length;
assert.ok(jogs >= 3, `keep-alives sent: ${jogs}`);
assert.ok(turntable.state.position > 1000);
const done = new Promise((r) => turntable.onArrival(r));
await turntable.jogStop();
const stoppedAt = await done;
assert.equal(turntable.state.moving, false); assert.equal(turntable.state.jogging, 0);
assert.ok(stoppedAt > 1000);

// Commands after jogging still get their own replies
p = await turntable.moveTo(stoppedAt - 100);
assert.equal(p, stoppedAt - 100);
await turntable.setPosition(0);
assert.equal(turntable.state.position, 0);
// Rotation-capture lock: only the key holder moves the table; others are refused, STOP still works
const key = turntable.lock();
assert.equal(turntable.state.locked, true);
await assert.rejects(turntable.moveTo(300), /busy with a rotation capture/);
await assert.rejects(turntable.moveBy(10), /busy with a rotation capture/);
await assert.rejects(turntable.setPosition(5), /busy with a rotation capture/);
assert.throws(() => turntable.lock(), /busy/);
assert.equal(await turntable.moveTo(300, { key }), 300);
turntable.unlock(Symbol('other'));
assert.equal(turntable.state.locked, true);
turntable.unlock(key);
assert.equal(turntable.state.locked, false);
assert.equal(await turntable.moveTo(0), 0);
await turntable.disconnect();
assert.equal(turntable.state.connected, false);
// A board that resets twice after the port opens still connects (PING retried after the second READY)
const twice = makeBoard({ doubleReset: true });
navigator.serial.getPorts = async () => [twice];
await turntable.connect();
assert.equal(turntable.state.connected, true);
assert.ok(twice.sent.filter((c) => c === 'PING').length >= 1);
await turntable.disconnect();
console.log('turntable client OK; commands sent:', board.sent.length);
process.exit(0);
