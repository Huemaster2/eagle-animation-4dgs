export const MAGNIFIER_ZOOMS = [2, 4, 8];

export const DEFAULT_MAGNIFIER = { ENABLED: false, ZOOM: 4, CX: 0.5, CY: 0.5 };

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// Source rectangle shown by the magnifier: 1/zoom of the width, shaped like the magnifier view, kept inside the picture
export const magnifierCrop = ({ srcW, srcH, cx = 0.5, cy = 0.5, zoom = 4, aspect = 2 / 3 }) => {
  let sw = srcW / Math.max(1, zoom);
  let sh = sw * aspect;
  if (sh > srcH) {
    sh = srcH;
    sw = sh / aspect;
  }
  sw = Math.min(sw, srcW);
  const sx = clamp(cx * srcW - sw / 2, 0, srcW - sw);
  const sy = clamp(cy * srcH - sh / 2, 0, srcH - sh);
  return { sx, sy, sw, sh };
};

// Centre kept where a full crop still fits, so the marker and the magnifier always agree
export const clampCenter = ({ srcW, srcH, cx, cy, zoom, aspect }) => {
  const { sx, sy, sw, sh } = magnifierCrop({ srcW, srcH, cx, cy, zoom, aspect });
  return { cx: (sx + sw / 2) / srcW, cy: (sy + sh / 2) / srcH };
};
