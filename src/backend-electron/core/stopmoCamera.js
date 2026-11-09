import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { appendFile, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { appLog } from './appLog';

// StopMo camera helper (Swift, macOS only): drives the Canon 5D Mark II through
// ImageCaptureCore + Canon EOS PTP, because Canon's current Mac SDK (used by
// toucan-camera-server) no longer supports that body.

const RESTART_DELAY = 2000;
const LOG_LINES = 300;

let child = null;
let runtime = { port: null, token: null };
let shuttingDown = false;
let restartTimer = null;
let started = false;
const recentLog = [];

const findHelperPath = () => {
  if (process.platform !== 'darwin') {
    return null;
  }
  const name = 'stopmo-camera-helper';
  const candidates = [
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '../../stopmo-camera-helper/bin/macos', name), // packaged app
    path.join(__dirname, '../../stopmo-camera-helper/bin/macos', name), // development
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
};

const remember = (line) => {
  appLog(`camera helper: ${line}`);
  recentLog.push(line);
  if (recentLog.length > LOG_LINES) {
    recentLog.shift();
  }
};

const launch = () => {
  if (shuttingDown || child) {
    return;
  }
  const helperPath = findHelperPath();
  if (!helperPath) {
    remember('stopmo-camera-helper not found (only bundled on macOS builds)');
    return;
  }
  runtime = { port: null, token: null };
  // stdin stays open: the helper exits (and hands the camera back) when the app closes it
  try {
    child = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    remember(`could not start helper: ${err.message}`);
    child = null;
    return;
  }
  remember(`started ${helperPath} pid ${child.pid}`);
  // Without these an unexpected spawn or pipe error would take the whole app down
  child.on('error', (err) => {
    remember(`helper error: ${err.message}`);
    // A process that never started emits no 'exit', so clear it here
    if (child && !child.pid) {
      child = null;
    }
  });
  child.stdin.on('error', (err) => remember(`helper stdin: ${err.message}`));

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const ready = line.match(/^STOPMO_CAMERA_READY (.+)$/);
    if (ready) {
      try {
        const cfg = JSON.parse(ready[1]);
        runtime = { port: cfg.port, token: cfg.token };
      } catch (err) {
        remember(`bad READY line: ${line}`);
      }
    }
    remember(line);
  });
  readline.createInterface({ input: child.stderr }).on('line', (line) => remember(`stderr: ${line}`));

  child.on('exit', (code, signal) => {
    remember(`helper exited (code ${code}, signal ${signal})`);
    child = null;
    runtime = { port: null, token: null };
    if (!shuttingDown) {
      restartTimer = setTimeout(launch, RESTART_DELAY);
    }
  });
};

export const startStopMoCameraHelper = () => {
  if (started) {
    return;
  }
  started = true;
  launch();
};

export const shutdownStopMoCameraHelper = () => {
  shuttingDown = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  if (child) {
    const proc = child;
    proc.stdin.end();
    // Give it a moment to take the camera out of remote mode, then make sure it is gone
    setTimeout(() => proc.kill('SIGTERM'), 3000).unref();
  }
};

export const getStopMoCameraConfig = () => ({
  available: !!findHelperPath(),
  running: !!child,
  port: runtime.port,
  token: runtime.token,
  log: recentLog.slice(-60),
});

// ---- Camera test captures (Pictures/StopMo/Camera_Test/Test_NNN.CR2) ----

export const CAMERA_TEST_DIR = path.join(homedir(), 'Pictures', 'StopMo', 'Camera_Test');

// A chosen storage folder holds Camera_Test too, so every original from this Mac lives in one place
const cameraTestDir = (storageFolder) => (storageFolder ? path.join(storageFolder, 'Camera_Test') : CAMERA_TEST_DIR);

export const getNextCameraTestName = async (storageFolder = '') => {
  const dir = cameraTestDir(storageFolder);
  await mkdir(dir, { recursive: true });
  const names = await readdir(dir).catch(() => []);
  const numbers = names
    .map((n) => n.match(/^Test_(\d+)/))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return { dir, baseName: `Test_${String(next).padStart(3, '0')}` };
};

export const logCameraTest = async (entry = {}, storageFolder = '') => {
  const dir = cameraTestDir(storageFolder);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'capture_log.csv');
  if (!fs.existsSync(file)) {
    await appendFile(file, 'time,result,file,kind,bytes,camera_bytes,size_matches,signature_ok,structure_ok,width,height,seconds,error\n');
  }
  const f = entry.file || {};
  const row = [
    new Date().toISOString(),
    entry.ok ? 'SUCCESS' : 'FAILURE',
    f.path ? path.basename(f.path) : '',
    f.kind || '',
    f.size ?? '',
    f.expectedSize ?? '',
    f.sizeMatches ?? '',
    f.signatureOK ?? '',
    f.structureOK ?? '',
    f.width ?? '',
    f.height ?? '',
    entry.seconds ?? '',
    (entry.error || '').replace(/[,\n]/g, ' '),
  ];
  await appendFile(file, `${row.join(',')}\n`);
  return true;
};

const safeName = (name) =>
  `${name || ''}`
    .replace(/[/\\:*?"<>|]/g, '_')
    .trim()
    .slice(0, 80);

// Originals go next to the project by default, or under the chosen storage folder as "<title> (<id>)/Scene_N"
export const getProjectRawDir = (projectsPath, projectId, trackId, storageFolder = '', projectTitle = '') => {
  const scene = Number(trackId) || 0;
  if (!storageFolder) {
    return path.join(projectsPath, `${projectId}`, 'raw', `${scene}`);
  }
  const title = safeName(projectTitle);
  return path.join(storageFolder, title ? `${title} (${projectId})` : `${projectId}`, `Scene_${scene + 1}`);
};

export const isUsableFolder = (folder) => {
  try {
    return !!folder && fs.statSync(folder).isDirectory();
  } catch (err) {
    return false;
  }
};
