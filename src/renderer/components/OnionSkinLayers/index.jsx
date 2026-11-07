import { drawFitted, tintCanvas } from '@core/drawFitted';
import { getPictureLink } from '@core/resize';
import React, { useEffect, useRef } from 'react';

import * as style from './style.module.css';

const IMAGE_CACHE = new Map();
const MAX_CACHE = 60;

const loadImage = (link) => {
  if (IMAGE_CACHE.has(link)) {
    return IMAGE_CACHE.get(link);
  }
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img), { once: true });
    img.addEventListener('error', reject, { once: true });
    img.src = link;
  });
  IMAGE_CACHE.set(link, promise);
  // Drop the oldest entries so long scrubbing sessions don't hold every frame in memory
  while (IMAGE_CACHE.size > MAX_CACHE) {
    IMAGE_CACHE.delete(IMAGE_CACHE.keys().next().value);
  }
  return promise;
};

const OnionLayer = ({ link, color, tint, opacity, blendMode, width, height, videoRatio, className }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) {
      return undefined;
    }
    canvas.width = width;
    canvas.height = height;
    loadImage(getPictureLink(link, { h: 720, m: 'contain', f: 'jpg' }))
      .catch(() => null)
      .then((img) => {
        if (cancelled || !canvasRef.current) {
          return;
        }
        const ctx = canvasRef.current.getContext('2d');
        const size = { width, height };
        drawFitted(ctx, img, size, videoRatio, { background: null });
        tintCanvas(ctx, size, color, tint);
      });
    return () => {
      cancelled = true;
    };
  }, [link, color, tint, width, height, videoRatio]);

  return <canvas ref={canvasRef} className={`${style.layer} ${className}`} style={{ opacity, mixBlendMode: blendMode || 'normal' }} />;
};

export const preloadImage = (link) => loadImage(getPictureLink(link, { h: 720, m: 'contain', f: 'jpg' })).catch(() => null);

// One persistent canvas per reference sequence: the previous image stays up until the next one
// has loaded, so playback does not flicker while frames stream in.
export const ReferenceLayer = ({ link = null, preload = [], opacity = 0.5, blendMode = 'normal', x = 0, y = 0, scale = 1, width, height, videoRatio = null, className = '' }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) {
      return undefined;
    }
    if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!link) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return undefined;
    }
    preloadImage(link).then((img) => {
      if (!cancelled && canvasRef.current) {
        drawFitted(ctx, img, { width, height }, videoRatio, { background: null });
      }
    });
    preload.forEach(preloadImage);
    return () => {
      cancelled = true;
    };
  }, [link, width, height, videoRatio]);

  return (
    <canvas
      ref={canvasRef}
      className={`${style.layer} ${className}`}
      style={{ opacity: link ? opacity : 0, mixBlendMode: blendMode || 'normal', transform: `translate(${x * 50}%, ${y * 50}%) scale(${scale})` }}
    />
  );
};

const OnionSkinLayers = ({ layers = [], width, height, videoRatio = null, className = '' }) => (
  <>
    {layers.map((l) => (
      <OnionLayer key={l.key} {...l} width={width} height={height} videoRatio={videoRatio} className={className} />
    ))}
  </>
);

export default React.memo(OnionSkinLayers);
