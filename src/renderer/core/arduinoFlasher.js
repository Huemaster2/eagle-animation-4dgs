// Installs firmware on an Arduino Uno over USB the way avrdude does (STK500v1 to the Optiboot
// bootloader), so the turntable never needs the Arduino IDE. Every page is read back and compared.

const STK = { OK: 0x10, INSYNC: 0x14, EOP: 0x20, GET_SYNC: 0x30, ENTER: 0x50, LEAVE: 0x51, LOAD_ADDRESS: 0x55, PROG_PAGE: 0x64, READ_PAGE: 0x74, READ_SIGN: 0x75 };
const ATMEGA328P_SIGNATURE = [0x1e, 0x95, 0x0f];
const PAGE_SIZE = 128;
const FLASH_LIMIT = 32256; // 32 KB minus the 512-byte Optiboot section

export const parseIntelHex = (text) => {
  const bytes = new Uint8Array(FLASH_LIMIT).fill(0xff);
  let top = 0;
  let base = 0;
  for (const raw of `${text}`.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] !== ':') throw new Error('Not an Intel HEX file');
    const rec = line
      .slice(1)
      .match(/../g)
      .map((h) => parseInt(h, 16));
    const sum = rec.reduce((a, b) => (a + b) & 0xff, 0);
    if (sum !== 0) throw new Error('Firmware file is damaged (checksum)');
    const [len, hi, lo, type] = rec;
    const data = rec.slice(4, 4 + len);
    if (type === 0x00) {
      const addr = base + ((hi << 8) | lo);
      if (addr + len > FLASH_LIMIT) throw new Error('Firmware is too large for an Arduino Uno');
      bytes.set(data, addr);
      top = Math.max(top, addr + len);
    } else if (type === 0x01) {
      break;
    } else if (type === 0x02) {
      base = ((data[0] << 8) | data[1]) << 4;
    } else if (type === 0x04) {
      base = ((data[0] << 8) | data[1]) << 16;
    }
  }
  return bytes.slice(0, Math.ceil(top / PAGE_SIZE) * PAGE_SIZE);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Byte stream over a Web Serial port with "read exactly n bytes" semantics
class ByteLink {
  constructor(port) {
    this.port = port;
    this.buffer = [];
    this.waiting = null;
    this.closed = false;
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    this.pump();
  }

  async pump() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buffer.push(...value);
        this.waiting?.();
      }
    } catch (err) {
      // closed while reading
    } finally {
      this.closed = true;
      this.waiting?.();
    }
  }

  drain() {
    this.buffer = [];
  }

  async read(n, timeout = 1000) {
    const deadline = Date.now() + timeout;
    while (this.buffer.length < n) {
      if (this.closed) throw new Error('Arduino disconnected');
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('Arduino did not answer');
      await new Promise((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiting = () => {
          clearTimeout(t);
          resolve();
        };
      });
      this.waiting = null;
    }
    return this.buffer.splice(0, n);
  }

  write(bytes) {
    return this.writer.write(new Uint8Array(bytes));
  }

  async close() {
    try {
      await this.reader.cancel();
    } catch (err) {
      // already closed
    }
    this.reader.releaseLock();
    this.writer.releaseLock();
  }
}

// Sends one STK500 command and checks the INSYNC … OK framing around `replyLength` payload bytes
const stk = async (link, bytes, replyLength = 0, timeout = 1000) => {
  await link.write([...bytes, STK.EOP]);
  const reply = await link.read(replyLength + 2, timeout);
  if (reply[0] !== STK.INSYNC || reply[reply.length - 1] !== STK.OK) throw new Error('Bootloader lost sync');
  return reply.slice(1, -1);
};

const resetIntoBootloader = async (port) => {
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  await sleep(250);
  await port.setSignals({ dataTerminalReady: true, requestToSend: true });
  await sleep(50);
};

const sync = async (link) => {
  for (let i = 0; i < 12; i++) {
    link.drain();
    try {
      await stk(link, [STK.GET_SYNC], 0, 300);
      return true;
    } catch (err) {
      await sleep(50);
    }
  }
  return false;
};

// Flashes `hexText` onto the Uno behind a closed Web Serial `port`; onProgress(stage, done, total)
export const flashArduinoUno = async (port, hexText, onProgress = () => {}) => {
  const image = parseIntelHex(hexText);
  if (!image.length) throw new Error('Firmware file is empty');

  // Uno R3 boards run Optiboot at 115200; older boards and many clones use 57600
  for (const baudRate of [115200, 57600]) {
    onProgress('connecting', 0, image.length);
    await port.open({ baudRate });
    const link = new ByteLink(port);
    try {
      await resetIntoBootloader(port);
      if (!(await sync(link))) {
        await link.close();
        await port.close();
        continue;
      }
      const signature = await stk(link, [STK.READ_SIGN], 3);
      if (signature.join() !== ATMEGA328P_SIGNATURE.join()) {
        throw new Error(`This board is not an Arduino Uno (ATmega328P); signature ${signature.map((b) => b.toString(16)).join(' ')}`);
      }
      await stk(link, [STK.ENTER]);

      for (let addr = 0; addr < image.length; addr += PAGE_SIZE) {
        const page = image.slice(addr, addr + PAGE_SIZE);
        const word = addr >> 1;
        await stk(link, [STK.LOAD_ADDRESS, word & 0xff, word >> 8]);
        await stk(link, [STK.PROG_PAGE, page.length >> 8, page.length & 0xff, 0x46, ...page], 0, 2000);
        onProgress('writing', addr + page.length, image.length);
      }
      for (let addr = 0; addr < image.length; addr += PAGE_SIZE) {
        const length = Math.min(PAGE_SIZE, image.length - addr);
        const word = addr >> 1;
        await stk(link, [STK.LOAD_ADDRESS, word & 0xff, word >> 8]);
        const back = await stk(link, [STK.READ_PAGE, length >> 8, length & 0xff, 0x46], length, 2000);
        for (let i = 0; i < length; i++) {
          if (back[i] !== image[addr + i]) throw new Error(`Verification failed at byte ${addr + i}: the board did not store the firmware correctly`);
        }
        onProgress('verifying', addr + length, image.length);
      }
      await stk(link, [STK.LEAVE]);
      onProgress('done', image.length, image.length);
      await link.close();
      await port.close();
      return { bytes: image.length, baudRate };
    } catch (err) {
      await link.close().catch(() => null);
      await port.close().catch(() => null);
      throw err;
    }
  }
  throw new Error('No Arduino bootloader answered. Check the USB cable, close the Arduino IDE serial monitor, and try again.');
};
