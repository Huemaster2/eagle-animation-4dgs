import { PERSPECTIVES } from '@core/turntableMath';

// A profile is one rig setup: calibrated views, the capture arc and motor tuning. Positions are absolute steps.
export const DEFAULT_TURNTABLE_PROFILE = {
  id: 'default',
  name: 'Default rig',
  perspectives: { FRONT: null, RIGHT: null, BACK: null, LEFT: null },
  captureStart: null,
  captureEnd: null,
  shotsPerPass: 19,
  heights: 3,
  settleMs: 800,
  backlash: 20,
  runUs: 950,
  startUs: 1500,
  ramp: 12,
  lastPosition: 0,
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
    shotsPerPass: Math.min(360, Math.max(1, Math.round(num(p.shotsPerPass, d.shotsPerPass)))),
    heights: Math.min(10, Math.max(1, Math.round(num(p.heights, d.heights)))),
    settleMs: Math.min(10000, Math.max(0, Math.round(num(p.settleMs, d.settleMs)))),
    backlash: Math.min(500, Math.max(0, Math.round(num(p.backlash, d.backlash)))),
    runUs: Math.max(200, Math.round(num(p.runUs, d.runUs))),
    startUs: Math.max(200, Math.round(num(p.startUs, d.startUs))),
    ramp: Math.max(0, Math.round(num(p.ramp, d.ramp))),
    lastPosition: Math.round(num(p.lastPosition, 0)),
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
