export const ONION_MAX_FRAMES = 5;

export const ONION_BLEND_MODES = ['normal', 'difference', 'multiply', 'screen', 'lighten', 'darken'];

export const DEFAULT_ONION_SKIN = {
  ENABLED: true,
  PREVIOUS_COUNT: 2,
  PREVIOUS_OPACITIES: [1, 0.5, 0.3, 0.2, 0.1],
  PREVIOUS_COLOR: '#ffb000',
  NEXT_COUNT: 1,
  NEXT_OPACITIES: [0.6, 0.35, 0.2, 0.15, 0.1],
  NEXT_COLOR: '#4fd97f',
  TINT_STRENGTH: 0,
  BLEND_MODE: 'normal',
  REFERENCE_OPACITY: 0.5,
  REFERENCE_BLEND_MODE: 'difference',
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Fills gaps from older saved settings so the renderer never sees a partial config
export const normalizeOnionSkin = (config = {}) => {
  const c = { ...DEFAULT_ONION_SKIN, ...(config || {}) };
  const fillOpacities = (list, fallback) => Array.from({ length: ONION_MAX_FRAMES }, (_, i) => clamp(Number(list?.[i] ?? fallback[i]) || 0, 0, 1));
  return {
    ...c,
    ENABLED: !!c.ENABLED,
    PREVIOUS_COUNT: clamp(Math.round(Number(c.PREVIOUS_COUNT) || 0), 0, ONION_MAX_FRAMES),
    NEXT_COUNT: clamp(Math.round(Number(c.NEXT_COUNT) || 0), 0, ONION_MAX_FRAMES),
    PREVIOUS_OPACITIES: fillOpacities(c.PREVIOUS_OPACITIES, DEFAULT_ONION_SKIN.PREVIOUS_OPACITIES),
    NEXT_OPACITIES: fillOpacities(c.NEXT_OPACITIES, DEFAULT_ONION_SKIN.NEXT_OPACITIES),
    TINT_STRENGTH: clamp(Number(c.TINT_STRENGTH) || 0, 0, 1),
    REFERENCE_OPACITY: clamp(Number(c.REFERENCE_OPACITY) || 0, 0, 1),
    BLEND_MODE: ONION_BLEND_MODES.includes(c.BLEND_MODE) ? c.BLEND_MODE : 'normal',
    REFERENCE_BLEND_MODE: ONION_BLEND_MODES.includes(c.REFERENCE_BLEND_MODE) ? c.REFERENCE_BLEND_MODE : 'normal',
  };
};

// Layers are returned back-to-front: furthest frames first so the nearest ghost sits on top.
// Onion frames are distinct captures (holds are not repeated) and skip hidden frames.
// resolveLink picks the image for a frame (e.g. how it looked from the active view); null leaves that ghost out
export const getOnionLayers = ({ pictures = [], currentFrameId = false, config, master = 1, referenceFrameId = null, resolveLink = (frame) => frame.link }) => {
  const c = normalizeOnionSkin(config);
  const layers = [];
  if (!c.ENABLED || master <= 0) {
    return layers;
  }

  const frames = pictures.filter((p) => !p.deleted && !p.hidden);
  const anchor = currentFrameId === false ? frames.length : frames.findIndex((p) => p.id === currentFrameId);
  if (anchor === -1) {
    return layers;
  }

  for (let i = c.PREVIOUS_COUNT; i >= 1; i--) {
    const frame = frames[anchor - i];
    const link = frame ? resolveLink(frame) : null;
    if (link) {
      layers.push({
        key: `prev-${i}-${frame.id}-${link}`,
        kind: 'previous',
        offset: -i,
        link,
        opacity: c.PREVIOUS_OPACITIES[i - 1] * master,
        color: c.PREVIOUS_COLOR,
        tint: c.TINT_STRENGTH,
        blendMode: c.BLEND_MODE,
      });
    }
  }
  // Ahead of the live view there is nothing yet, so next frames only show while scrubbing
  if (currentFrameId !== false) {
    for (let i = c.NEXT_COUNT; i >= 1; i--) {
      const frame = frames[anchor + i];
      const link = frame ? resolveLink(frame) : null;
      if (link) {
        layers.push({
          key: `next-${i}-${frame.id}-${link}`,
          kind: 'next',
          offset: i,
          link,
          opacity: c.NEXT_OPACITIES[i - 1] * master,
          color: c.NEXT_COLOR,
          tint: c.TINT_STRENGTH,
          blendMode: c.BLEND_MODE,
        });
      }
    }
  }

  // Previous frames are drawn far-to-near, then next frames far-to-near, so both nearest ghosts end up on top
  const ordered = [...layers.filter((l) => l.kind === 'previous'), ...layers.filter((l) => l.kind === 'next')];

  if (referenceFrameId !== null && referenceFrameId !== currentFrameId) {
    const ref = pictures.find((p) => p.id === referenceFrameId && !p.deleted);
    if (ref) {
      ordered.push({ key: `ref-${ref.id}`, kind: 'reference', offset: null, link: ref.link, opacity: c.REFERENCE_OPACITY, color: null, tint: 0, blendMode: c.REFERENCE_BLEND_MODE });
    }
  }

  return ordered.filter((l) => l.opacity > 0);
};
