import { stopmoGrabLiveFrame } from '@core/stopmoCamera';
import { alignToTags, tagOffset, toReference } from '@core/tagAlign';
import { detectTags } from '@core/tagDetect';
import { turntable } from '@core/turntable';
import { nearestEquivalent } from '@core/turntableMath';

// AprilTags in the current live-view picture, as a reference. Reads live view only: the shutter is never fired.
export const observeTags = async ({ family = 'APRILTAG_36h11', freshFrames = 2 } = {}) => {
  const blob = await stopmoGrabLiveFrame({ freshFrames });
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return toReference({ width: image.width, height: image.height, tags: detectTags(image, { family }) });
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Turns the table until the tags sit where the reference has them, then tells the motor that this is `steps`:
// the step count is re-anchored to what the camera sees, so slipped or skipped steps do not carry forward.
export const alignTable = async ({ reference, family, steps = null, key = undefined, settleMs = 250, isStopped = () => false, label = 'Tags' }) => {
  // Live view can take a moment to come back after a photo, so a missing picture is asked for again
  const look = async () => {
    await wait(settleMs);
    for (let attempt = 0; attempt < 3; attempt++) {
      const seen = await observeTags({ family }).catch(() => null);
      if (seen) return seen;
      await wait(600);
    }
    return { tags: [] };
  };
  const result = await alignToTags({
    reference,
    measure: look,
    moveBy: (n) => turntable.moveTo((turntable.state.position ?? 0) + n, { key }),
    isStopped,
    log: (line) => turntable.log(`${label}: ${line}`),
  });
  const px = (v) => (Number.isFinite(v) ? ((v * (reference.width || 1000)) / 1000).toFixed(1) : '?');
  turntable.log(`${label}: ${result.ok ? 'aligned' : `not aligned (${result.reason})`}, ${result.moved} steps of correction, ${px(result.start)} px off before, ${px(result.residual)} px after`);
  if (result.converged && Number.isFinite(steps) && turntable.state.position !== steps) await turntable.setPosition(steps, { key });
  return { ...result, startPx: Number(px(result.start)), residualPx: Number(px(result.residual)) };
};

// Turns to a calibrated view by motor steps, then (with tag alignment on and tags stored for the view) finishes
// by eye: the tags are brought back to where they were when the view was set
export const turnToView = async ({ profile, view, key = undefined, isStopped = () => false }) => {
  const target = profile.perspectives[view];
  const steps = nearestEquivalent(target, turntable.state.position ?? target, turntable.state.stepsPerRev);
  const arrived = await turntable.moveTo(steps, { key });
  if (arrived !== steps) return { steps, arrived, tags: null };
  const reference = profile.tags?.enabled ? profile.tagRefs?.[view] : null;
  if (!reference?.tags?.length) return { steps, arrived, tags: null, noReference: !!profile.tags?.enabled };
  const tags = await alignTable({ reference, family: profile.tags.family, steps, key, isStopped, label: `View ${view}` });
  return { steps, arrived: steps, tags };
};

export { tagOffset };
