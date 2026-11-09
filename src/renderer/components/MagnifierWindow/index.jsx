import FloatingPanel from '@components/FloatingPanel';
import { clampCenter, MAGNIFIER_ZOOMS, magnifierCrop } from '@core/magnifier';
import { useEffect, useRef } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const FPS = 30;

// Frame-in-frame loupe: a zoomed piece of the live view. Drag inside it (or move the marker on the picture) to look around.
const MagnifierWindow = ({
  t,
  enabled = false,
  layout = {},
  center = { cx: 0.5, cy: 0.5 },
  getSource = () => null,
  onCenterChange = () => {},
  onCenterCommit = () => {},
  onAspectChange = () => {},
  onLayoutChange = () => {},
  onClose = () => {},
}) => {
  const canvas = useRef(null);
  const live = useRef({ center, zoom: layout.ZOOM || 4 });
  live.current = { center, zoom: layout.ZOOM || 4 };

  const aspectChange = useRef(onAspectChange);
  aspectChange.current = onAspectChange;

  // Keep the backing store at screen resolution and tell the marker the view's shape (canvas remounts on expand)
  useEffect(() => {
    const c = canvas.current;
    if (!c) return undefined;
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(c.clientWidth * dpr));
      const h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      if (c.clientWidth) aspectChange.current(c.clientHeight / c.clientWidth);
    });
    observer.observe(c);
    return () => observer.disconnect();
  }, [layout.COLLAPSED]);

  useEffect(() => {
    if (!enabled) return undefined;
    let raf = null;
    let last = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / FPS) return;
      last = now;
      const c = canvas.current;
      const src = getSource();
      if (!c || !src?.width || !c.width) return;
      const { center: ctr, zoom } = live.current;
      const { sx, sy, sw, sh } = magnifierCrop({ srcW: src.width, srcH: src.height, cx: ctr.cx, cy: ctr.cy, zoom, aspect: c.height / c.width });
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = zoom < 4;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, getSource]);

  // Dragging the picture moves the view the other way, like sliding a print under a loupe
  const startPan = (event) => {
    if (event.button !== 0) return;
    const src = getSource();
    const c = canvas.current;
    if (!src?.width || !c?.clientWidth) return;
    event.preventDefault();
    const aspect = c.clientHeight / c.clientWidth;
    const start = { x: event.clientX, y: event.clientY, ...clampCenter({ srcW: src.width, srcH: src.height, ...live.current.center, zoom: live.current.zoom, aspect }) };
    const { sw, sh } = magnifierCrop({ srcW: src.width, srcH: src.height, zoom: live.current.zoom, aspect });
    let latest = { cx: start.cx, cy: start.cy };
    const move = (e) => {
      const cx = start.cx - ((e.clientX - start.x) / c.clientWidth) * (sw / src.width);
      const cy = start.cy - ((e.clientY - start.y) / c.clientHeight) * (sh / src.height);
      latest = clampCenter({ srcW: src.width, srcH: src.height, cx, cy, zoom: live.current.zoom, aspect: c.clientHeight / c.clientWidth });
      onCenterChange(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCenterCommit(latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const zoom = layout.ZOOM || 4;

  return (
    <FloatingPanel title={t('Magnifier')} layout={layout} defaults={{ X: 24, Y: 280, W: 320, H: 260 }} minWidth={180} minHeight={140} onLayoutChange={onLayoutChange} onClose={onClose}>
      <div className={style.box}>
        <canvas ref={canvas} className={`${style.view} ${enabled ? '' : style.off}`} onPointerDown={startPan} />
        {!enabled && <p className={style.note}>{t('Shown while the live view is on screen')}</p>}
        <div className={style.bar}>
          {MAGNIFIER_ZOOMS.map((z) => (
            <button key={z} type="button" className={`${style.zoom} ${zoom === z ? style.zoomActive : ''}`} aria-pressed={zoom === z} onClick={() => onLayoutChange({ ZOOM: z })}>
              {z}×
            </button>
          ))}
          <span className={style.hint}>{t('Drag here or move the box on the picture')}</span>
        </div>
      </div>
    </FloatingPanel>
  );
};

export default withTranslation()(MagnifierWindow);
