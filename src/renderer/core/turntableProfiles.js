import { PERSPECTIVES } from '@core/turntableMath';

// A profile is one rig setup: calibrated views, the capture arc and motor tuning. Positions are absolute steps.
export const DEFAULT_TURNTABLE_PROFILE = {
  id: 'default',
  name: 'Default rig',
  perspectives: { FRONT: null, RIGHT: null, BACK: null, LEFT: null },
  captureStart: null,
  captureEnd: null,
  shotsPerPass: 25,
  heights: 3,
  settleMs: 800,
  // Rotation capture: the shutter takes a full turn at every height; the photo at the start view and main height is the frame's picture
  rotationCapture: true,
  rotationStart: 'FRONT', // a view, or 'CURRENT' to start wherever the table is
  heroHeight: 1,
  alternateHeights: true,
  version: 2,
  backlash: 20,
  runUs: 950,
  startUs: 1500,
  ramp: 12,
  lastPosition: 0,
  // AprilTag alignment: tags riding on the table are matched in the live view to bring it back to the same angle
  tags: { enabled: false, family: 'APRILTAG_36h11' },
  tagRefs: {}, // view -> where its tags were in the picture when the view was set
  rotationRefs: {}, // "view:height" -> where the tags were at the first photo of a rotation
  // Views finished by hand: after the motor turn, the table is nudged against a stored picture of the view
  handAlign: { FRONT: false, RIGHT: false, BACK: false, LEFT: false },
};

// Table speed and acceleration as two plain choices. The board takes step delays; a step lasts twice the delay.
// Longer ramps at higher speeds keep the motor from skipping steps when it starts and stops.
export const SPEED_LEVELS = [2000, 1400, 950, 700, 500];
export const ACCEL_LEVELS = [
  { id: 'soft', startUs: 3500, ramps: [80, 120, 200, 300, 450] },
  { id: 'medium', startUs: 2500, ramps: [40, 60, 100, 160, 260] },
  { id: 'hard', startUs: 1500, ramps: [12, 12, 12, 40, 80] },
];

export const motorTuning = (speed, accel) => {
  const runUs = SPEED_LEVELS[speed];
  const level = ACCEL_LEVELS[accel];
  return { runUs, startUs: Math.max(runUs, level.startUs), ramp: level.ramps[speed] };
};

// Which speed and acceleration a profile is on, or -1 when its numbers were typed in by hand
export const tuningLevels = (profile) => {
  const speed = SPEED_LEVELS.indexOf(profile.runUs);
  const accel = speed < 0 ? -1 : ACCEL_LEVELS.findIndex((_, i) => motorTuning(speed, i).startUs === profile.startUs && motorTuning(speed, i).ramp === profile.ramp);
  return { speed, accel };
};

const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);

export const normalizeProfile = (p = {}) => {
  const d = DEFAULT_TURNTABLE_PROFILE;
  const perspectives = {};
  for (const key of PERSPECTIVES) {
    const v = p?.perspectives?.[key];
    perspectives[key] = v === null || v === undefined || v === '' ? null : Math.round(Number(v));
  }
  return {
    ...d,
    ...p,
    id: p.id || d.id,
    name: `${p.name || d.name}`,
    perspectives,
    captureStart: p.captureStart === null || p.captureStart === undefined ? null : Math.round(Number(p.captureStart)),
    captureEnd: p.captureEnd === null || p.captureEnd === undefined ? null : Math.round(Number(p.captureEnd)),
    // Profiles saved before rotation capture used 19 photos per pass; the rig now shoots 25
    shotsPerPass: Math.min(360, Math.max(1, Math.round(num(!p.version && Number(p.shotsPerPass) === 19 ? 25 : p.shotsPerPass, d.shotsPerPass)))),
    heights: Math.min(10, Math.max(1, Math.round(num(p.heights, d.heights)))),
    rotationCapture: p.rotationCapture === undefined ? d.rotationCapture : !!p.rotationCapture,
    rotationStart: [...PERSPECTIVES, 'CURRENT'].includes(p.rotationStart) ? p.rotationStart : d.rotationStart,
    heroHeight: Math.max(1, Math.round(num(p.heroHeight, d.heroHeight))),
    alternateHeights: p.alternateHeights === undefined ? d.alternateHeights : !!p.alternateHeights,
    version: 2,
    settleMs: Math.min(10000, Math.max(0, Math.round(num(p.settleMs, d.settleMs)))),
    backlash: Math.min(500, Math.max(0, Math.round(num(p.backlash, d.backlash)))),
    runUs: Math.max(200, Math.round(num(p.runUs, d.runUs))),
    startUs: Math.max(200, Math.round(num(p.startUs, d.startUs))),
    ramp: Math.max(0, Math.round(num(p.ramp, d.ramp))),
    lastPosition: Math.round(num(p.lastPosition, 0)),
    tags: { enabled: !!p.tags?.enabled, family: typeof p.tags?.family === 'string' ? p.tags.family : d.tags.family },
    tagRefs: p.tagRefs && typeof p.tagRefs === 'object' ? p.tagRefs : {},
    rotationRefs: p.rotationRefs && typeof p.rotationRefs === 'object' ? p.rotationRefs : {},
    handAlign: Object.fromEntries(Object.keys(d.handAlign).map((view) => [view, !!p.handAlign?.[view]])),
  };
};

export const getProfiles = (settings) => {
  const list = Array.isArray(settings?.TURNTABLE_PROFILES) ? settings.TURNTABLE_PROFILES : [];
  return list.length ? list.map(normalizeProfile) : [normalizeProfile(DEFAULT_TURNTABLE_PROFILE)];
};

export const getActiveProfile = (settings) => {
  const profiles = getProfiles(settings);
  return profiles.find((p) => p.id === settings?.TURNTABLE_PROFILE_ID) || profiles[0];
};
