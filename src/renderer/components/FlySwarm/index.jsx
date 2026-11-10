import flyImage from '@components/Logo/assets/fly.png';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import * as style from './style.module.css';

const rand = (a, b) => a + Math.random() * (b - a);

// Philip's friends: they come in from the edges, buzz about the screen and leave. Click to shoo them.
const FlySwarm = ({ show = false, onDone = () => {} }) => {
  const canvas = useRef(null);
  const finish = useRef(onDone);
  finish.current = onDone;

  useEffect(() => {
    if (!show || !canvas.current) return undefined;
    const el = canvas.current;
    const ctx = el.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };
    resize();
    window.addEventListener('resize', resize);

    const img = new Image();
    img.src = flyImage;

    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flies = Array.from({ length: calm ? 12 : 44 }, () => {
      const edge = Math.floor(rand(0, 4));
      return {
        x: edge === 0 ? -40 : edge === 1 ? w + 40 : rand(0, w),
        y: edge === 2 ? -40 : edge === 3 ? h + 40 : rand(0, h),
        vx: 0,
        vy: 0,
        tx: rand(w * 0.15, w * 0.85),
        ty: rand(h * 0.15, h * 0.85),
        size: rand(13, 34),
        speed: rand(calm ? 2 : 4, calm ? 4 : 9),
        wobble: rand(0, Math.PI * 2),
        until: 0,
      };
    });

    const life = calm ? 4000 : 7000;
    const start = performance.now();
    let raf = 0;

    const frame = (now) => {
      const age = now - start;
      const leaving = age > life;
      ctx.clearRect(0, 0, w, h);
      for (const f of flies) {
        if (now > f.until) {
          f.until = now + rand(250, 1100);
          // On the way out they aim well past the edges, so the screen clears itself
          f.tx = leaving ? f.x + rand(-2, 2) * w : rand(-20, w + 20);
          f.ty = leaving ? f.y + rand(-2, 2) * h : rand(-20, h + 20);
        }
        const dx = f.tx - f.x;
        const dy = f.ty - f.y;
        const d = Math.hypot(dx, dy) || 1;
        f.vx += (dx / d) * 0.9;
        f.vy += (dy / d) * 0.9;
        const sp = Math.hypot(f.vx, f.vy) || 1;
        const max = leaving ? f.speed * 2.5 : f.speed;
        if (sp > max) {
          f.vx = (f.vx / sp) * max;
          f.vy = (f.vy / sp) * max;
        }
        f.wobble += 0.55;
        f.x += f.vx + Math.cos(f.wobble) * 1.3;
        f.y += f.vy + Math.sin(f.wobble * 1.3) * 1.3;
        if (d < 30) f.until = 0;
        if (img.complete && img.naturalWidth) {
          const s = f.size;
          ctx.save();
          ctx.translate(f.x, f.y);
          ctx.rotate(Math.sin(f.wobble * 0.5) * 0.25);
          ctx.drawImage(img, -s / 2, -s / 2, s, s * (img.naturalHeight / img.naturalWidth));
          ctx.restore();
        }
      }
      if (age > life + 1600) {
        finish.current();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [show]);

  if (!show) return null;

  return createPortal(<canvas ref={canvas} className={style.swarm} onPointerDown={() => finish.current()} />, document.body);
};

export default FlySwarm;
