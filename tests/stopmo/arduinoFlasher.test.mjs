import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flashArduinoUno, parseIntelHex } from '@core/arduinoFlasher';

const hex = readFileSync(new URL('../../native/turntable-firmware/StopMoTurntable.hex', import.meta.url), 'utf8');
const image = parseIntelHex(hex);
assert.equal(image.length % 128, 0);
assert.ok(image.length >= 10148 && image.length < 10148 + 128 + 16, image.length);

// Fake Uno: Optiboot STK500v1 at a chosen baud, flash memory, optional corruption
const fakeUno = ({ baud = 115200, corruptAt = -1 } = {}) => {
  const flash = new Uint8Array(32768).fill(0xff);
  let ctrl, open = false, inBoot = false, addr = 0, rx = [], openBaud = 0;
  const reply = (bytes) => ctrl.enqueue(new Uint8Array(bytes));
  const handle = () => {
    for (;;) {
      if (!rx.length) return;
      const c = rx[0];
      const need = { 0x30: 2, 0x75: 2, 0x50: 2, 0x51: 2, 0x55: 4 }[c] ?? (c === 0x64 || c === 0x74 ? (rx.length >= 3 ? (c === 0x64 ? 5 + ((rx[1] << 8) | rx[2]) : 5) : Infinity) : 1);
      if (rx.length < need) return;
      const cmd = rx.splice(0, need);
      if (!inBoot || openBaud !== baud) continue; // garbage at wrong baud / app running
      if (cmd.at(-1) !== 0x20) continue;
      if (c === 0x30 || c === 0x50 || c === 0x51) reply([0x14, 0x10]);
      else if (c === 0x75) reply([0x14, 0x1e, 0x95, 0x0f, 0x10]);
      else if (c === 0x55) { addr = (cmd[1] | (cmd[2] << 8)) * 2; reply([0x14, 0x10]); }
      else if (c === 0x64) { const n = (cmd[1] << 8) | cmd[2]; const data = cmd.slice(4, 4 + n); flash.set(data, addr); if (corruptAt >= addr && corruptAt < addr + n) flash[corruptAt] ^= 0xff; reply([0x14, 0x10]); }
      else if (c === 0x74) { const n = (cmd[1] << 8) | cmd[2]; reply([0x14, ...flash.slice(addr, addr + n), 0x10]); }
    }
  };
  const port = {
    flash,
    async open({ baudRate }) { open = true; openBaud = baudRate; this.readable = new ReadableStream({ start(c) { ctrl = c; } }); this.writable = new WritableStream({ write(chunk) { rx.push(...chunk); handle(); } }); },
    async close() { open = false; try { ctrl.close(); } catch {} },
    async setSignals({ dataTerminalReady }) { if (dataTerminalReady) { inBoot = true; rx = []; } },
  };
  return port;
};

let port = fakeUno({ baud: 115200 });
let stages = new Set();
let r = await flashArduinoUno(port, hex, (s) => stages.add(s));
assert.equal(r.baudRate, 115200); assert.deepEqual([...port.flash.slice(0, image.length)], [...image]);
assert.deepEqual([...stages], ['connecting', 'writing', 'verifying', 'done']);

port = fakeUno({ baud: 57600 });
r = await flashArduinoUno(port, hex);
assert.equal(r.baudRate, 57600); assert.deepEqual([...port.flash.slice(0, image.length)], [...image]);

port = fakeUno({ corruptAt: 700 });
await assert.rejects(flashArduinoUno(port, hex), /Verification failed at byte 700/);

port = fakeUno({ baud: 9600 });
await assert.rejects(flashArduinoUno(port, hex), /No Arduino bootloader answered/);

await assert.rejects(async () => parseIntelHex(':10000000FF\n'), /checksum|damaged/);
console.log('flasher OK', image.length, 'bytes');
