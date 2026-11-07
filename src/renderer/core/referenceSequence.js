import { ONION_BLEND_MODES } from '@core/onionSkin';

export const REFERENCE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif', 'image/tiff'];

export const DEFAULT_REFERENCE = {
  enabled: true,
  opacity: 0.5,
  offset: 0,
  x: 0,
  y: 0,
  scale: 1,
  blendMode: 'normal',
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const normalizeReference = (ref = {}) => ({
  ...DEFAULT_REFERENCE,
  ...ref,
  enabled: ref.enabled !== false,
  opacity: clamp(Number(ref.opacity ?? DEFAULT_REFERENCE.opacity) || 0, 0, 1),
  offset: Math.round(Number(ref.offset) || 0),
  x: clamp(Number(ref.x) || 0, -1, 1),
  y: clamp(Number(ref.y) || 0, -1, 1),
  scale: clamp(Number(ref.scale) || 1, 0.1, 4),
  blendMode: ONION_BLEND_MODES.includes(ref.blendMode) ? ref.blendMode : 'normal',
  frames: ref.frames || [],
});

// "frame_2.png" sorts before "frame_10.png", matching how sequences are numbered
export const sortSequenceFiles = (files = []) =>
  [...files]
    .filter((f) => REFERENCE_IMAGE_TYPES.includes(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|tiff?)$/i.test(f.name))
    .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true, sensitivity: 'base' }));

export const sequenceNameFromFiles = (files = []) => {
  const first = files[0];
  const folder = first?.webkitRelativePath?.split('/')?.[0];
  if (folder) {
    return folder;
  }
  return (first?.name || 'Reference').replace(/[-_ .]*\d+\.[^.]+$/, '').replace(/\.[^.]+$/, '') || 'Reference';
};

// Animation position counts held frames and skips hidden ones, so it matches exported timing.
// Frame 1 of the animation shows reference frame 1 + offset.
export const getAnimationPosition = (expandedFrames = [], frameIndex = false) => {
  const end = frameIndex === false ? expandedFrames.length : frameIndex;
  let position = 0;
  for (let i = 0; i < end; i++) {
    if (!expandedFrames[i]?.hidden) {
      position++;
    }
  }
  return position;
};

export const getReferenceFrame = (ref, position) => {
  const index = position + (Number(ref.offset) || 0);
  return index >= 0 && index < ref.frames.length ? { index, frame: ref.frames[index] } : null;
};
