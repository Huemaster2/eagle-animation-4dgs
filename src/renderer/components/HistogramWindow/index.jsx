import FloatingPanel from '@components/FloatingPanel';
import { computeHistogram, SCOPE_COLORS } from '@core/scopes';
import useHiDpiCanvas from '@hooks/useHiDpiCanvas';
import { useEffect, useRef, useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const FPS = 10;

const drawHistogram = (c, hist) => {
  const ctx = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  const dpr = window.devicePixelRatio || 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#0b0b0b';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgb(255 255 255 / 14%)';
  ctx.lineWidth = dpr;
  ctx.beginPath();
  for (const q of [0.25, 0.5, 0.75]) {
    ctx.moveTo(Math.round(q * W) + 0.5, 0);
    ctx.lineTo(Math.round(q * W) + 0.5, H);
  }
  ctx.stroke();
  // Scale to the tallest bin away from the ends, so a clipped spike doesn't flatten everything else
  let max = 1;
  for (const ch of [hist.r, hist.g, hist.b]) for (let i = 1; i < 255; i++) max = Math.max(max, ch[i]);
  const top = 4 * dpr;
  const y = (n) => H - Math.min(1, n / max) * (H - top);
  ctx.globalCompositeOperation = 'lighter';
  [hist.r, hist.g, hist.b].forEach((ch, k) => {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * W, y(ch[i]));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = SCOPE_COLORS[k];
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = SCOPE_COLORS[k];
    ctx.lineWidth = dpr;
    ctx.stroke();
  });
  ctx.globalCompositeOperation = 'source-over';
};

// Live RGB histogram in its own floating, collapsible window, with clipping readouts
const HistogramWindow = ({ t, enabled = false, layout = {}, getSource = () => null, onLayoutChange = () => {}, onClose = () => {} }) => {
  const [canvas, canvasRef] = useHiDpiCanvas();
  const work = useRef(null);
  const [clip, setClip] = useState({ shadows: 0, highlights: 0, blocked: false });

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
      const hist = computeHistogram(source, work.current);
      if (!hist) {
        if (source?.width) setClip((c) => (c.blocked ? c : { ...c, blocked: true }));
        return;
      }
      setClip((prev) =>
        prev.blocked || Math.abs(prev.shadows - hist.shadows) > 0.0005 || Math.abs(prev.highlights - hist.highlights) > 0.0005
          ? { shadows: hist.shadows, highlights: hist.highlights, blocked: false }
          : prev
      );
      if (canvas.current?.width) drawHistogram(canvas.current, hist);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, getSource, canvas]);

  const pct = (v) => `${(v * 100).toFixed(v >= 0.1 ? 0 : 1)}%`;

  return (
    <FloatingPanel title={t('Histogram')} layout={layout} defaults={{ X: 24, Y: 80, W: 320, H: 190 }} minWidth={180} minHeight={110} onLayoutChange={onLayoutChange} onClose={onClose}>
      <div className={style.box}>
        <canvas ref={canvasRef} className={`${style.graph} ${enabled && !clip.blocked ? '' : style.off}`} />
        {!enabled && <p className={style.note}>{t('Shown while the live view is on screen')}</p>}
        {enabled && clip.blocked && <p className={style.note}>{t('Histogram is not available for this camera')}</p>}
        <div className={style.legend}>
          <span className={clip.shadows > 0.01 ? style.warn : ''} title={t('Pixels black in all three channels')}>
            {t('Black {{p}}', { p: pct(clip.shadows) })}
          </span>
          <span className={clip.highlights > 0.01 ? style.warn : ''} title={t('Pixels clipped in at least one channel')}>
            {t('Clipped {{p}}', { p: pct(clip.highlights) })}
          </span>
        </div>
      </div>
    </FloatingPanel>
  );
};

export default withTranslation()(HistogramWindow);
