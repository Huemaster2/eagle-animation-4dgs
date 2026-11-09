// Focus peaking: marks the sharpest edges of the live view (Sobel gradient on a downscaled copy).
// Higher sensitivity marks softer edges too.

export const PEAKING_COLORS = ['#ffe000', '#4dff88', '#ffffff'];

export const DEFAULT_FOCUS_PEAKING = { ENABLED: false, COLOR: '#ffe000', SENSITIVITY: 0.5 };

const MAX_WIDTH = 640;

const hexToRgb = (hex) => {
  const m = `${hex}`.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 224, 0];
};

// Gradient threshold for a 0..1 sensitivity (0.5 ≈ only crisp edges light up)
export const peakingThreshold = (sensitivity) => Math.round(220 - Math.min(1, Math.max(0, Number(sensitivity) || 0)) * 180);

// Returns an ImageData-sized RGBA buffer with peaking pixels set, or null when the source can't be read
export const computePeaking = (source, work, { color = DEFAULT_FOCUS_PEAKING.COLOR, sensitivity = DEFAULT_FOCUS_PEAKING.SENSITIVITY } = {}) => {
  if (!source?.width || !source?.height) return null;
  const w = Math.min(MAX_WIDTH, source.width);
  const h = Math.max(1, Math.round((source.height / source.width) * w));
  if (work.width !== w) work.width = w;
  if (work.height !== h) work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, w, h);
  } catch (err) {
    // Cross-origin stream without CORS: the browser won't let us read it
    return null;
  }
  const src = pixels.data;
  const luma = new Float32Array(w * h);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2];
  }
  const out = new ImageData(w, h);
  const dst = out.data;
  const threshold = peakingThreshold(sensitivity);
  const [r, g, b] = hexToRgb(color);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = luma[i - w + 1] + 2 * luma[i + 1] + luma[i + w + 1] - luma[i - w - 1] - 2 * luma[i - 1] - luma[i + w - 1];
      const gy = luma[i + w - 1] + 2 * luma[i + w] + luma[i + w + 1] - luma[i - w - 1] - 2 * luma[i - w] - luma[i - w + 1];
      if (Math.abs(gx) + Math.abs(gy) > threshold) {
        const p = i * 4;
        dst[p] = r;
        dst[p + 1] = g;
        dst[p + 2] = b;
        dst[p + 3] = 255;
      }
    }
  }
  return out;
};
