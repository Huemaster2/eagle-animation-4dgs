import { stopmoGrabLiveFrame } from '@core/stopmoCamera';

// The picture a view is lined up against by hand: the live view as it looked when the view was set.
// Kept in this computer's browser storage per turntable profile, so the settings file stays small.
const keyFor = (profileId, view) => `philip-frame.align.${profileId}.${view}`;

export const getAlignFrame = (profileId, view) => {
  try {
    return window.localStorage.getItem(keyFor(profileId, view)) || null;
  } catch {
    return null;
  }
};

export const clearAlignFrame = (profileId, view) => {
  try {
    window.localStorage.removeItem(keyFor(profileId, view));
  } catch {
    // Storage switched off: there is nothing to clear
  }
};

const toDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// Stores the current live-view picture for the view. Live view only: the shutter is never fired.
export const captureAlignFrame = async (profileId, view) => {
  const blob = await stopmoGrabLiveFrame({ freshFrames: 2 }).catch(() => null);
  if (!blob) return null;
  const url = await toDataUrl(blob);
  try {
    window.localStorage.setItem(keyFor(profileId, view), url);
  } catch {
    return null;
  }
  return url;
};
