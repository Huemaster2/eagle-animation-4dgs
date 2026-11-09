import { session } from 'electron';

import { appLog } from './appLog';

// USB vendors of Arduino Uno boards and common clones (Arduino, Arduino.org, CH340, FTDI, Silicon Labs)
const ARDUINO_VENDORS = [0x2341, 0x2a03, 0x1a86, 0x0403, 0x10c4];

const vendorOf = (port) => {
  const raw = `${port?.vendorId ?? ''}`;
  return raw.startsWith('0x') ? Number.parseInt(raw, 16) : Number.parseInt(raw, 10);
};

// Web Serial for the turntable: the app picks the Arduino itself, no browser chooser
export const enableTurntableSerial = () => {
  const ses = session.defaultSession;
  ses.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    const arduino = portList.find((p) => ARDUINO_VENDORS.includes(vendorOf(p))) || portList.find((p) => /usbmodem|usbserial|wchusbserial/i.test(p.portName || ''));
    appLog(`serial ports: ${portList.map((p) => `${p.portName || p.displayName} (${p.vendorId}:${p.productId})`).join(', ') || 'none'} → ${arduino ? arduino.portName : 'no Arduino'}`);
    callback(arduino ? arduino.portId : '');
  });
  // Same as Electron's default (allow), stated explicitly because a check handler is needed for serial
  ses.setPermissionCheckHandler(() => true);
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
};
