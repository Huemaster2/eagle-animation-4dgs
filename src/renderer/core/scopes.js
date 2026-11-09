// RGB histogram and RGB parade from the live view, measured on a downscaled copy

export const SCOPE_COLORS = ['#ff4b4b', '#4bff6e', '#4b8dff'];

export const DEFAULT_HISTOGRAM = { ENABLED: false };
export const DEFAULT_PARADE = { ENABLED: false };

// Reads the source's pixels at most `maxWidth` wide; null when the browser won't allow reading it
const samplePixels = (source, work, maxWidth) => {
  if (!source?.width || !source?.height) return null;
  const w = Math.min(maxWidth, source.width);
  const h = Math.max(1, Math.round((source.height / source.width) * w));
  if (work.width !== w) work.width = w;
  if (work.height !== h) work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  try {
    return { w, h, data: ctx.getImageData(0, 0, w, h).data };
  } catch (err) {
    return null;
  }
};

// 256-bin R, G, B and luma histograms, plus the share of crushed shadows and clipped highlights
export const computeHistogram = (source, work, maxWidth = 320) => {
  const px = samplePixels(source, work, maxWidth);
  if (!px) return null;
  const { data } = px;
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const luma = new Uint32Array(256);
  let crushed = 0;
  let clipped = 0;
  for (let p = 0; p < data.length; p += 4) {
    const R = data[p];
    const G = data[p + 1];
    const B = data[p + 2];
    r[R]++;
    g[G]++;
    b[B]++;
    luma[Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)]++;
    if (R <= 1 && G <= 1 && B <= 1) crushed++;
    if (R >= 254 || G >= 254 || B >= 254) clipped++;
  }
  const total = data.length / 4;
  return { r, g, b, luma, bins: luma, total, shadows: crushed / total, highlights: clipped / total };
};

// Waveform counts per channel: counts[c][level * w + x] = pixels in column x with that level
export const computeParade = (source, work, maxWidth = 512) => {
  const px = samplePixels(source, work, maxWidth);
  if (!px) return null;
  const { w, h, data } = px;
  const counts = [new Uint32Array(256 * w), new Uint32Array(256 * w), new Uint32Array(256 * w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0, p = y * w * 4; x < w; x++, p += 4) {
      counts[0][data[p] * w + x]++;
      counts[1][data[p + 1] * w + x]++;
      counts[2][data[p + 2] * w + x]++;
    }
  }
  return { w, h, counts };
};

// Trace brightness for a count, given the count an even spread would put in one cell: saturating, so stray pixels show and dense areas don't blow out
export const traceIntensity = (count, even) => (count ? Math.min(1, 0.2 + 0.8 * (1 - Math.exp(-count / Math.max(1e-6, even * 4)))) : 0);
