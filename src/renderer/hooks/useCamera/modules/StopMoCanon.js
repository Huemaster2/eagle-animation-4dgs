import { getStopMoCameraConfig, getStopMoCaptureNaming, getStopMoCaptureOptions, getStopMoRawDir, stopmoCapture, stopmoFetch, stopmoUrl } from '@core/stopmoCamera';

const CAMERA_ID = 'canon-eos-ptp';

// Canon EOS bodies driven by the StopMo helper (ImageCaptureCore + Canon PTP).
// Every capture keeps the camera's original file (CR2 when shooting RAW) in the
// project's raw/<scene> folder; the frame shown in the timeline is the camera's
// JPEG or the full-size preview embedded in the CR2.
class StopMoCanon {
  constructor(deviceId = null) {
    this.deviceId = deviceId;
    this.lastCaptureFiles = [];
  }

  get id() {
    return this?.deviceId || null;
  }

  get supportsFrameAveraging() {
    return false;
  }

  async getCapabilities() {
    const list = await stopmoFetch(`/cameras/${CAMERA_ID}/parameters`)
      .then((r) => r.json())
      .catch(() => []);
    return (Array.isArray(list) ? list : []).map((p) => ({
      id: p.type,
      type: 'SELECT',
      values: (p.options || []).map((o) => ({ label: o.label, value: o.value })),
      value: p.current,
      canReset: false,
      disabled: false,
    }));
  }

  async applyCapability(key, value) {
    await stopmoFetch(`/cameras/${CAMERA_ID}/parameters`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: key, value: `${value}` }),
    }).catch(() => null);
    return null;
  }

  async connect({ setStream } = {}) {
    this.setStream = setStream;
    await stopmoFetch(`/cameras/${CAMERA_ID}/connect`, { method: 'PUT' }).catch(() => null);
    const cfg = await getStopMoCameraConfig();
    if (setStream && cfg?.port) {
      setStream('image', stopmoUrl(cfg, `/cameras/${CAMERA_ID}/liveview?token=${cfg.token}&t=${Date.now()}`));
    }
    return true;
  }

  async takePicture() {
    // Card-only shooting keeps the originals on the card, so no Mac folder is involved
    const base = getStopMoCaptureOptions().saveTarget === 'card' ? null : await getStopMoRawDir();
    const naming = getStopMoCaptureNaming();
    const rawDir = base && naming?.subDir ? `${base}/${naming.subDir}` : base;
    const result = await stopmoCapture({ rawDir, baseName: (rawDir && naming?.baseName) || null });
    this.lastCaptureFiles = result.files || [];
    if (!result.ok) {
      throw new Error(`Canon capture failed: ${result.error}`);
    }
    return { type: result.type, buffer: result.buffer };
  }

  async disconnect() {
    await stopmoFetch(`/cameras/${CAMERA_ID}/disconnect`, { method: 'PUT' }).catch(() => null);
    return true;
  }
}

class StopMoCanonBrowser {
  static async getCameras() {
    const cfg = await getStopMoCameraConfig();
    if (!cfg?.port) {
      return [];
    }
    const cameras = await stopmoFetch('/cameras')
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    // Listed even while the body is asleep, so the app never falls back to the webcam; live view starts when it wakes
    const name = (Array.isArray(cameras) && cameras[0]?.name) || 'Canon EOS';
    return [{ deviceId: CAMERA_ID, label: `${name} (RAW tether)`, module: 'STOPMO-CANON' }];
  }
}

export const Camera = StopMoCanon;
export const CameraBrowser = StopMoCanonBrowser;
