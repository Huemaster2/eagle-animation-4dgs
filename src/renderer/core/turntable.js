import { DEFAULT_STEPS_PER_REV, parseLine } from '@core/turntableMath';

// USB vendors of Arduino Uno boards and common clones (Arduino, Arduino.org, CH340, FTDI, Silicon Labs)
export const ARDUINO_USB_FILTERS = [0x2341, 0x2a03, 0x1a86, 0x0403, 0x10c4].map((usbVendorId) => ({ usbVendorId }));

const BAUD = 115200;

const isArduino = (port) => ARDUINO_USB_FILTERS.some((f) => f.usbVendorId === port.getInfo?.().usbVendorId);

// Ports already allowed include Bluetooth and debug ports on a Mac, so only USB Arduinos are reused
export const findArduinoPort = async () => {
  const known = (await navigator.serial.getPorts()).find(isArduino);
  if (known) return known;
  try {
    return await navigator.serial.requestPort({ filters: ARDUINO_USB_FILTERS });
  } catch (err) {
    throw new Error('No Arduino found. Plug in the turntable’s USB cable (and close the Arduino IDE serial monitor).');
  }
};
const REPLY_TIMEOUT = 2500;
const JOG_KEEPALIVE_MS = 120; // firmware stops on its own if JOG is not repeated within 250 ms
const LOG_LINES = 200;

// One connection per app window: every hook and panel shares it
class Turntable {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.pending = null; // the single command awaiting its reply
    this.queue = Promise.resolve();
    this.moveWaiters = [];
    this.jogTimer = null;
    this.listeners = new Set();
    this.arrivalListeners = new Set();
    this.lockKey = null;
    this.state = {
      supported: typeof navigator !== 'undefined' && !!navigator.serial,
      connected: false,
      connecting: false,
      firmware: null,
      stepsPerRev: DEFAULT_STEPS_PER_REV,
      position: null,
      target: null,
      moving: false,
      jogging: 0,
      enabled: false,
      backlash: null,
      error: null,
      locked: false,
      log: [],
    };
    if (this.state.supported) {
      navigator.serial.addEventListener('disconnect', (e) => {
        if (e.target === this.port) this.handleLost('Turntable unplugged');
      });
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  // Called with the final position every time the table comes to rest
  onArrival(fn) {
    this.arrivalListeners.add(fn);
    return () => this.arrivalListeners.delete(fn);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }

  log(line) {
    const log = [...this.state.log, `${new Date().toLocaleTimeString()} ${line}`].slice(-LOG_LINES);
    this.set({ log });
  }

  // A port the user already allowed is reused silently; otherwise the system picks the Arduino (see main process)
  async connect({ restorePosition = null } = {}) {
    if (!this.state.supported) throw new Error('Serial ports are not available in this build');
    if (this.state.connected || this.state.connecting) return;
    this.set({ connecting: true, error: null });
    try {
      const port = await findArduinoPort();
      await port.open({ baudRate: BAUD });
      this.port = port;
      this.writer = port.writable.getWriter();
      this.readLoop(port);

      // Opening the port resets the Uno; wait for its banner, then make sure it is our firmware
      await this.waitFor((m) => m.type === 'READY', 4000).catch(() => null);
      const pong = await this.command('PING').catch(() => null);
      if (!pong || !/StopMoTurntable/.test(pong.line)) {
        throw new Error('No StopMo turntable firmware answered on this port. Install the firmware from this panel first.');
      }
      const info = await this.command('INFO');
      const stepsPerRev = info.kv.steps_per_rev_x1000 ? info.kv.steps_per_rev_x1000 / 1000 : DEFAULT_STEPS_PER_REV;
      this.set({ connected: true, firmware: info.kv.fw ?? null, stepsPerRev, backlash: info.kv.backlash ?? null, position: info.kv.pos ?? 0 });
      this.log(`Connected: ${pong.line.replace(/^OK PONG /, '')}, ${stepsPerRev.toFixed(2)} steps/rev`);

      // The Arduino forgets its position on reset; the last known one is restored (valid if nobody turned the table by hand)
      if (Number.isFinite(restorePosition) && restorePosition !== 0) {
        await this.command(`SETPOS ${Math.round(restorePosition)}`);
        this.set({ position: Math.round(restorePosition) });
        this.log(`Position restored to ${Math.round(restorePosition)}`);
      }
      await this.command('ENABLE 1');
      this.set({ enabled: true });
    } catch (err) {
      this.set({ error: err.message });
      await this.disconnect().catch(() => null);
      throw err;
    } finally {
      this.set({ connecting: false });
    }
  }

  async disconnect() {
    this.stopJogTimer();
    const port = this.port;
    this.port = null;
    try {
      await this.reader?.cancel();
    } catch (err) {
      // already closed
    }
    try {
      this.writer?.releaseLock();
    } catch (err) {
      // already released
    }
    try {
      await port?.close();
    } catch (err) {
      // already closed
    }
    this.reader = null;
    this.writer = null;
    this.failPending(new Error('Turntable disconnected'));
    this.set({ connected: false, moving: false, jogging: 0, enabled: false });
  }

  handleLost(reason) {
    this.log(reason);
    this.set({ error: reason });
    this.disconnect();
  }

  async readLoop(port) {
    const decoder = new TextDecoder();
    let buffer = '';
    this.reader = port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.search(/\r?\n/)) >= 0) {
          const raw = buffer.slice(0, nl);
          buffer = buffer.slice(nl + (buffer[nl] === '\r' ? 2 : 1));
          const msg = parseLine(raw);
          if (msg) this.handleMessage(msg);
        }
      }
    } catch (err) {
      if (this.port === port) this.handleLost(`Serial read failed: ${err.message}`);
    } finally {
      try {
        this.reader?.releaseLock();
      } catch (err) {
        // released by disconnect
      }
    }
  }

  handleMessage(msg) {
    if (msg.type === 'POS') {
      this.set({ position: Number(msg.args[0]) });
      return;
    }
    if (msg.type === 'DONE') {
      const position = Number(msg.args[0]);
      this.set({ position, moving: false, jogging: 0, target: position });
      this.log(`Arrived at ${position}`);
      const waiters = this.moveWaiters;
      this.moveWaiters = [];
      waiters.forEach((w) => w.resolve(position));
      this.arrivalListeners.forEach((fn) => fn(position));
      return;
    }
    if (msg.type === 'READY') {
      this.log(msg.line);
      this.waiterCheck(msg);
      return;
    }
    // Repeated JOG keep-alives are fire-and-forget
    if (msg.type === 'OK' && msg.args[0] === 'JOG' && this.pending?.name !== 'JOG') return;

    if (msg.type === 'ERR') this.log(msg.line);
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      if (msg.type === 'ERR') p.reject(new Error(msg.args[0] === 'BUSY' ? 'Turntable is still moving' : msg.line));
      else p.resolve(msg);
    }
    this.waiterCheck(msg);
  }

  waiterCheck(msg) {
    if (this.lineWaiter?.test(msg)) {
      const w = this.lineWaiter;
      this.lineWaiter = null;
      clearTimeout(w.timer);
      w.resolve(msg);
    }
  }

  waitFor(test, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.lineWaiter = null;
        reject(new Error('timeout'));
      }, timeout);
      this.lineWaiter = { test, resolve, timer };
    });
  }

  async write(text) {
    if (!this.writer) throw new Error('Turntable not connected');
    await this.writer.write(new TextEncoder().encode(`${text}\n`));
  }

  failPending(err) {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(err);
      this.pending = null;
    }
    const waiters = this.moveWaiters;
    this.moveWaiters = [];
    waiters.forEach((w) => w.reject(err));
  }

  // Commands go out one at a time; each resolves with its reply line
  command(text) {
    const run = () =>
      new Promise((resolve, reject) => {
        const name = text.split(' ')[0];
        const timer = setTimeout(() => {
          if (this.pending?.timer === timer) this.pending = null;
          reject(new Error(`Turntable did not answer ${name}`));
        }, REPLY_TIMEOUT);
        this.pending = { name, resolve, reject, timer };
        this.write(text).catch((err) => {
          clearTimeout(timer);
          this.pending = null;
          reject(err);
        });
      });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => null);
    return result;
  }

  waitForArrival(timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.moveWaiters.push(waiter);
      setTimeout(() => {
        if (this.moveWaiters.includes(waiter)) {
          this.moveWaiters = this.moveWaiters.filter((w) => w !== waiter);
          reject(new Error('Turntable did not report arrival in time'));
        }
      }, timeoutMs);
    });
  }

  // Absolute move; resolves with the final position once the table has stopped
  // While a rotation capture runs only its own moves (carrying its key) are accepted; STOP always works
  lock() {
    if (this.lockKey) throw new Error('The turntable is busy with a rotation capture');
    this.lockKey = Symbol('rotation-capture');
    this.set({ locked: true });
    return this.lockKey;
  }

  unlock(key) {
    if (this.lockKey !== key) return;
    this.lockKey = null;
    this.set({ locked: false });
  }

  checkLock(key) {
    if (this.lockKey && key !== this.lockKey) throw new Error('The turntable is busy with a rotation capture');
  }

  async moveTo(target, { key } = {}) {
    if (!this.state.connected) throw new Error('Turntable not connected');
    this.checkLock(key);
    if (this.state.moving) throw new Error('Turntable is still moving');
    const steps = Math.round(target);
    const distance = Math.abs(steps - (this.state.position ?? steps)) + (this.state.backlash || 0) * 2;
    this.set({ moving: true, target: steps });
    const arrival = this.waitForArrival(8000 + distance * 3);
    try {
      await this.command(`MOVETO ${steps}`);
      this.log(`Moving to ${steps}`);
    } catch (err) {
      this.failPending(err);
      this.set({ moving: false });
      throw err;
    }
    return arrival;
  }

  async moveBy(delta) {
    return this.moveTo((this.state.position ?? 0) + Math.round(delta));
  }

  // Hold-to-rotate: keeps JOG alive while held; release decelerates to a stop
  async jogStart(dir) {
    if (!this.state.connected || this.state.moving) return;
    this.checkLock();
    const d = dir > 0 ? 1 : -1;
    this.set({ moving: true, jogging: d, target: null });
    try {
      await this.command(`JOG ${d}`);
    } catch (err) {
      this.set({ moving: false, jogging: 0 });
      throw err;
    }
    this.stopJogTimer();
    this.jogTimer = setInterval(() => this.write(`JOG ${d}`).catch(() => null), JOG_KEEPALIVE_MS);
  }

  stopJogTimer() {
    if (this.jogTimer) clearInterval(this.jogTimer);
    this.jogTimer = null;
  }

  async jogStop() {
    if (!this.state.jogging) return;
    this.stopJogTimer();
    await this.stop();
  }

  async stop() {
    this.stopJogTimer();
    if (!this.state.connected) return;
    await this.command('STOP').catch(() => null);
  }

  // Declares the current physical position as `steps` without moving
  async setPosition(steps) {
    this.checkLock();
    if (this.state.moving) throw new Error('Turntable is still moving');
    await this.command(`SETPOS ${Math.round(steps)}`);
    this.set({ position: Math.round(steps), target: Math.round(steps) });
  }

  async setBacklash(steps) {
    const r = await this.command(`BACKLASH ${Math.max(0, Math.round(steps))}`);
    this.set({ backlash: Number(r.args[1]) });
  }

  async setSpeed(runUs, startUs, ramp) {
    await this.command(`SPEED ${Math.round(runUs)} ${Math.round(startUs)} ${Math.round(ramp)}`);
  }

  async setEnabled(on) {
    await this.command(`ENABLE ${on ? 1 : 0}`);
    this.set({ enabled: !!on });
  }
}

export const turntable = new Turntable();

// Development builds only: lets a browser test drive a simulated table
if (import.meta.env?.DEV && typeof window !== 'undefined') window.__turntable = turntable;
