import { computePeaking } from '@core/focusPeaking';
import { useEffect, useRef, useState } from 'react';

const FPS = 12;

// Draws focus peaking over the live view. getSource returns the live-view canvas.
const FocusPeakingLayer = ({ enabled = false, getSource = () => null, color, sensitivity, className = '' }) => {
  const canvas = useRef(null);
  const work = useRef(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!enabled) {
      const c = canvas.current;
      c?.getContext('2d').clearRect(0, 0, c.width, c.height);
      return undefined;
    }
    work.current = work.current || document.createElement('canvas');
    let raf = null;
    let last = 0;
    let alive = true;
    const loop = (now) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / FPS) return;
      last = now;
      const out = computePeaking(getSource(), work.current, { color, sensitivity });
      const c = canvas.current;
      if (!c) return;
      if (!out) {
        if (getSource()?.width) setBlocked(true);
        return;
      }
      setBlocked(false);
      if (c.width !== out.width) c.width = out.width;
      if (c.height !== out.height) c.height = out.height;
      c.getContext('2d').putImageData(out, 0, 0);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [enabled, color, sensitivity, getSource]);

  return <canvas ref={canvas} className={className} style={{ imageRendering: 'pixelated', opacity: enabled && !blocked ? 1 : 0, pointerEvents: 'none' }} />;
};

export default FocusPeakingLayer;
