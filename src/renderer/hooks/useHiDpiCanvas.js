import { useCallback, useEffect, useRef } from 'react';

// Keeps a canvas's backing store at its on-screen size times the pixel ratio; returns [ref, callbackRef]
const useHiDpiCanvas = (onResize = null) => {
  const ref = useRef(null);
  const observer = useRef(null);
  const resized = useRef(onResize);
  resized.current = onResize;

  const setRef = useCallback((c) => {
    observer.current?.disconnect();
    observer.current = null;
    ref.current = c;
    if (!c) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(c.clientWidth * dpr));
      const h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      resized.current?.(c);
    };
    observer.current = new ResizeObserver(fit);
    observer.current.observe(c);
    fit();
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, setRef];
};

export default useHiDpiCanvas;
