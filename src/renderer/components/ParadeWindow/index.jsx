import FloatingPanel from '@components/FloatingPanel';
import { computeParade, SCOPE_COLORS, traceIntensity } from '@core/scopes';
import useHiDpiCanvas from '@hooks/useHiDpiCanvas';
import { useEffect, useRef, useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const FPS = 10;
const RGB = SCOPE_COLORS.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
const LEVELS = [0, 25, 50, 75, 100];
const BG = 11;

// Bins one channel's counts straight into screen pixels (pw × ph), so the trace is exact at any window size
const channelImage = (ctx, parade, c, pw, ph) => {
  const { w, h, counts } = parade;
  const ch = counts[c];
  const bins = new Float32Array(pw * ph);
  const colOf = new Int32Array(w);
  for (let x = 0; x < w; x++) colOf[x] = Math.min(pw - 1, Math.floor((x * pw) / w));
  for (let level = 0; level < 256; level++) {
    const row = (ph - 1 - Math.min(ph - 1, Math.floor((level * ph) / 256))) * pw;
    const base = level * w;
    for (let x = 0; x < w; x++) {
      const n = ch[base + x];
      if (n) bins[row + colOf[x]] += n;
    }
  }
  // Density 1 = a column's pixels spread evenly over every level
  const perColumn = (h * w) / pw;
  const [r, g, b] = RGB[c];
  const img = ctx.createImageData(pw, ph);
  const out = img.data;
  // Traces glow over the scope's near-black background
  for (let i = 0; i < bins.length; i++) {
    const a = traceIntensity(bins[i], perColumn / ph);
    const p = i * 4;
    out[p] = BG + (r - BG) * a;
    out[p + 1] = BG + (g - BG) * a;
    out[p + 2] = BG + (b - BG) * a;
    out[p + 3] = 255;
  }
  return img;
};

const drawParade = (c, parade) => {
  const ctx = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  const dpr = window.devicePixelRatio || 1;
  const left = Math.round(26 * dpr);
  const gap = Math.round(4 * dpr);
  const pad = Math.round(4 * dpr);
  const pw = Math.max(1, Math.floor((W - left - gap * 2) / 3));
  const ph = Math.max(1, H - pad * 2);
  ctx.fillStyle = '#0b0b0b';
  ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 3; k++) {
    const x = left + k * (pw + gap);
    ctx.putImageData(channelImage(ctx, parade, k, pw, ph), x, pad);
    ctx.strokeStyle = 'rgb(255 255 255 / 22%)';
    ctx.lineWidth = dpr;
    ctx.strokeRect(x + 0.5, pad + 0.5, pw - 1, ph - 1);
  }
  // Graticule at 0/25/50/75/100 % of full scale
  ctx.font = `${Math.round(9 * dpr)}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const level of LEVELS) {
    const y = Math.round(pad + (1 - level / 100) * (ph - 1)) + 0.5;
    ctx.strokeStyle = 'rgb(255 255 255 / 16%)';
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.fillStyle = 'rgb(255 255 255 / 55%)';
    ctx.fillText(String(level), left - 4 * dpr, y);
  }
};

// RGB parade: each channel's waveform side by side (picture left to right, brightness bottom to top)
const ParadeWindow = ({ t, enabled = false, layout = {}, getSource = () => null, onLayoutChange = () => {}, onClose = () => {} }) => {
  const [canvas, canvasRef] = useHiDpiCanvas();
  const work = useRef(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    work.current = work.current || document.createElement('canvas');
    let raf = null;
    let last = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / FPS) return;
      last = now;
      const source = getSource();
      const parade = computeParade(source, work.current);
      if (!parade) {
        if (source?.width) setBlocked(true);
        return;
      }
      setBlocked(false);
      if (canvas.current?.width) drawParade(canvas.current, parade);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, getSource, canvas]);

  return (
    <FloatingPanel title={t('RGB parade')} layout={layout} defaults={{ X: 360, Y: 80, W: 480, H: 240 }} minWidth={240} minHeight={130} onLayoutChange={onLayoutChange} onClose={onClose}>
      <div className={style.box}>
        <canvas ref={canvasRef} className={`${style.graph} ${enabled && !blocked ? '' : style.off}`} />
        {!enabled && <p className={style.note}>{t('Shown while the live view is on screen')}</p>}
        {enabled && blocked && <p className={style.note}>{t('Parade is not available for this camera')}</p>}
      </div>
    </FloatingPanel>
  );
};

export default withTranslation()(ParadeWindow);
