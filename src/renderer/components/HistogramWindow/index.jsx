import FloatingPanel from '@components/FloatingPanel';
import { computeHistogram } from '@core/focusPeaking';
import { useEffect, useRef, useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const FPS = 6;
const W = 256;
const H = 100;

// Live luminance histogram in its own floating, collapsible window, with clipping readouts
const HistogramWindow = ({ t, enabled = false, layout = {}, getSource = () => null, onLayoutChange = () => {}, onClose = () => {} }) => {
  const canvas = useRef(null);
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
      const c = canvas.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      const ink = getComputedStyle(c).color;
      ctx.clearRect(0, 0, W, H);
      // Square-root scale keeps small populations visible next to a big peak
      let max = 1;
      for (let i = 1; i < 255; i++) max = Math.max(max, Math.sqrt(hist.bins[i]));
      ctx.fillStyle = ink;
      for (let i = 0; i < 256; i++) {
        const v = Math.min(1, Math.sqrt(hist.bins[i]) / max);
        const bar = Math.round(v * (H - 2));
        ctx.fillRect(i, H - bar, 1, bar);
      }
      ctx.fillRect(0, H - 1, W, 1);
      for (const q of [64, 128, 192]) {
        ctx.clearRect(q, 0, 1, H - 1);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, getSource]);

  const pct = (v) => `${(v * 100).toFixed(v >= 0.1 ? 0 : 1)}%`;

  return (
    <FloatingPanel title={t('Histogram')} layout={layout} defaults={{ X: 24, Y: 80, W: 280, H: 170 }} minWidth={180} minHeight={110} onLayoutChange={onLayoutChange} onClose={onClose}>
      <div className={style.box}>
        {!enabled ? (
          <p className={style.note}>{t('Shown while the live view is on screen')}</p>
        ) : clip.blocked ? (
          <p className={style.note}>{t('Histogram is not available for this camera')}</p>
        ) : (
          <>
            <canvas ref={canvas} width={W} height={H} className={style.graph} />
            <div className={style.legend}>
              <span className={clip.shadows > 0.01 ? style.warn : ''}>{t('Black {{p}}', { p: pct(clip.shadows) })}</span>
              <span className={clip.highlights > 0.01 ? style.warn : ''}>{t('White {{p}}', { p: pct(clip.highlights) })}</span>
            </div>
          </>
        )}
      </div>
    </FloatingPanel>
  );
};

export default withTranslation()(HistogramWindow);
