import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// Plain-text session log users can open or send when something goes wrong
export const APP_LOG_DIR = path.join(homedir(), 'Pictures', 'StopMo', 'Logs');
export const APP_LOG_FILE = path.join(APP_LOG_DIR, 'stopmo-app.log');
const MAX_BYTES = 5 * 1024 * 1024;

let ready = false;

const prepare = () => {
  if (ready) {
    return true;
  }
  try {
    mkdirSync(APP_LOG_DIR, { recursive: true });
    try {
      if (statSync(APP_LOG_FILE).size > MAX_BYTES) {
        renameSync(APP_LOG_FILE, `${APP_LOG_FILE}.1`);
      }
    } catch (err) {
      // no previous log
    }
    ready = true;
  } catch (err) {
    ready = false;
  }
  return ready;
};

export const appLog = (...parts) => {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  // Sync on purpose: the last lines before a quit or crash are the ones that matter
  if (prepare()) {
    try {
      appendFileSync(APP_LOG_FILE, line);
    } catch (err) {
      // logging must never take the app down
    }
  }
};
