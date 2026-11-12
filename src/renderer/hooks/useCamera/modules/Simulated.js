import { drawSimulatedSet, simRig } from '@core/simulatedRig';
import { turntable } from '@core/turntable';
import i18n from '@i18n';

// A camera with no camera: it draws the set as the simulated table stands, so the whole app — live view,
// shooting, a full turn at several heights — can be worked through with nothing plugged in.

const WIDTH = 1200;
const HEIGHT = 800;
const FPS = 20;

class Simulated {
  constructor(deviceId = null) {
    this.deviceId = deviceId;
    this.setStream = null;
    this.canvas = null;
    this.stream = null;
    this.timer = null;
  }

  get id() {
    return this?.deviceId || null;
  }

  async applyCapability() {
    return null;
  }

  async getCapabilities() {
    return [];
  }

  angle() {
    const steps = turntable.state.position ?? 0;
    return (steps / (turntable.state.stepsPerRev || 3046.15)) * Math.PI * 2;
  }

  paint(ctx, caption = '') {
    drawSimulatedSet(ctx, WIDTH, HEIGHT, { angle: this.angle(), pose: simRig.pose, cameraHeight: simRig.cameraHeight, caption });
  }

  async connect({ setStream } = {}) {
    this.setStream = setStream;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = WIDTH;
      this.canvas.height = HEIGHT;
    }
    const ctx = this.canvas.getContext('2d', { alpha: false });
    this.paint(ctx);
    if (!this.stream) this.stream = this.canvas.captureStream(FPS);
    if (!this.timer) this.timer = setInterval(() => this.paint(ctx), Math.round(1000 / FPS));
    if (this.setStream) this.setStream('video', this.stream);
    return true;
  }

  async takePicture() {
    const shot = document.createElement('canvas');
    shot.width = WIDTH;
    shot.height = HEIGHT;
    simRig.set({ shots: simRig.shots + 1 });
    this.paint(shot.getContext('2d', { alpha: false }), i18n.t('photo {{n}}', { n: simRig.shots }));
    return { type: 'image/png', buffer: shot };
  }

  async disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.setStream) {
      this.setStream(null);
      this.setStream = null;
    }
  }
}

class SimulatedBrowser {
  static async getCameras() {
    return [{ deviceId: 'SIMULATED', module: 'SIMULATED', label: i18n.t('Simulated rig (for testing)') }];
  }
}

export const Camera = Simulated;
export const CameraBrowser = SimulatedBrowser;
