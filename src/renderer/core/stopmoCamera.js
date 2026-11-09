import { DEVICE } from '@config-web';

// The Canon 5D Mark II helper only exists in the macOS desktop app
export const STOPMO_CAMERA_AVAILABLE = DEVICE === 'ELECTRON' && /mac/i.test(navigator.platform || navigator.userAgent || '');

let cachedConfig = null;
let rawContext = { projectId: null, trackId: 0 };

export const getStopMoCameraConfig = async () => {
  if (!STOPMO_CAMERA_AVAILABLE) {
    return null;
  }
  if (cachedConfig?.port && cachedConfig?.token) {
    return cachedConfig;
  }
  const cfg = await window.EA('STOPMO_CAMERA_GET_CONFIG').catch(() => null);
  if (cfg?.port && cfg?.token) {
    cachedConfig = cfg;
  }
  return cfg;
};

// The helper restarts with a new port/token if it crashes; forget the old one on network errors
export const resetStopMoCameraConfig = () => {
  cachedConfig = null;
};

export const stopmoUrl = (cfg, pathAndQuery) => `http://127.0.0.1:${cfg.port}${pathAndQuery}`;

export const stopmoFetch = async (pathAndQuery, options = {}) => {
  const cfg = await getStopMoCameraConfig();
  if (!cfg?.port) {
    throw new Error('Canon camera helper is not running');
  }
  try {
    return await fetch(stopmoUrl(cfg, pathAndQuery), {
      ...options,
      headers: { ...(options.headers || {}), authorization: `Bearer ${cfg.token}` },
    });
  } catch (err) {
    resetStopMoCameraConfig();
    throw err;
  }
};

export const getStopMoCameraStatus = async () => {
  const cfg = await getStopMoCameraConfig();
  if (!cfg?.port) {
    return { helperRunning: false, connected: false, log: cfg?.log || [] };
  }
  const res = await fetch(stopmoUrl(cfg, '/status')).catch(() => null);
  if (!res?.ok) {
    resetStopMoCameraConfig();
    return { helperRunning: false, connected: false };
  }
  return { helperRunning: true, ...(await res.json()) };
};

// Where ordinary animation captures keep their CR2 files
export const setStopMoRawContext = (projectId, trackId) => {
  rawContext = { projectId, trackId };
};

export const getStopMoRawDir = async () => {
  if (!rawContext.projectId) {
    return null;
  }
  return window.EA('STOPMO_CAMERA_PROJECT_RAW_DIR', { project_id: rawContext.projectId, track_id: rawContext.trackId }).catch(() => null);
};

const parseFiles = (res) => {
  try {
    return JSON.parse(res.headers.get('x-stopmo-files') || '[]');
  } catch {
    return [];
  }
};

// Fires the shutter and saves the camera's files (CR2 untouched) into rawDir/baseName.*
export const stopmoCapture = async ({ rawDir = null, baseName = null } = {}) => {
  const params = new URLSearchParams();
  if (rawDir) params.set('raw_dir', rawDir);
  if (baseName) params.set('base_name', baseName);
  const t0 = performance.now();
  const res = await stopmoFetch(`/cameras/canon-eos-ptp/capture?${params.toString()}`, { method: 'POST' });
  const seconds = Number(res.headers.get('x-stopmo-seconds')) || (performance.now() - t0) / 1000;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body?.error || `HTTP ${res.status}`, files: parseFiles(res), seconds };
  }
  return { ok: true, files: parseFiles(res), seconds, type: res.headers.get('Content-Type') || 'image/jpeg', buffer: await res.arrayBuffer() };
};
