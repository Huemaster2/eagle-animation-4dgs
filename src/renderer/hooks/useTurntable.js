import { captureAlignFrame } from '@core/alignFrames';
import { createSimulatedPort } from '@core/simulatedRig';
import { observeTags, turnToView } from '@core/tagVision';
import { turntable } from '@core/turntable';
import { DEFAULT_TURNTABLE_PROFILE, getActiveProfile, getProfiles, normalizeProfile } from '@core/turntableProfiles';
import useSettings, { getCurrentSettings } from '@hooks/useSettings';
import { useCallback, useEffect, useState } from 'react';
import { v4 } from 'uuid';

// Live turntable state plus the saved rig profiles (stored in settings)
function useTurntable() {
  const [state, setState] = useState(turntable.state);
  const { settings, actions: settingsActions } = useSettings();

  useEffect(() => turntable.subscribe(setState), []);

  const profiles = getProfiles(settings);
  const profile = getActiveProfile(settings);

  const writeProfiles = useCallback(
    (mutate) => {
      const fresh = getCurrentSettings() || settings;
      const list = getProfiles(fresh);
      const activeId = getActiveProfile(fresh).id;
      const next = mutate(list, activeId);
      return settingsActions.setSettings({ TURNTABLE_PROFILES: next.list.map(normalizeProfile), TURNTABLE_PROFILE_ID: next.activeId ?? activeId });
    },
    [settings, settingsActions]
  );

  const updateProfile = useCallback((patch) => writeProfiles((list, activeId) => ({ list: list.map((p) => (p.id === activeId ? { ...normalizeProfile(p), ...patch } : p)) })), [writeProfiles]);

  const selectProfile = useCallback((id) => writeProfiles((list) => ({ list, activeId: id })), [writeProfiles]);

  // A new profile starts as a copy of the current one, so motor tuning carries over
  const addProfile = useCallback(
    (name) =>
      writeProfiles((list, activeId) => {
        const base = list.find((p) => p.id === activeId) || DEFAULT_TURNTABLE_PROFILE;
        const created = normalizeProfile({ ...base, id: v4(), name: name || `Rig ${list.length + 1}` });
        return { list: [...list, created], activeId: created.id };
      }),
    [writeProfiles]
  );

  const deleteProfile = useCallback(
    (id) =>
      writeProfiles((list, activeId) => {
        const rest = list.filter((p) => p.id !== id);
        const kept = rest.length ? rest : [normalizeProfile(DEFAULT_TURNTABLE_PROFILE)];
        return { list: kept, activeId: id === activeId ? kept[0].id : activeId };
      }),
    [writeProfiles]
  );

  // Same opening as a real board, with a stand-in in its place: for working with nothing plugged in
  const connectSimulated = useCallback(async () => {
    const p = getActiveProfile(getCurrentSettings() || settings);
    await turntable.connectSimulated(createSimulatedPort, { restorePosition: p.lastPosition });
    await turntable.setBacklash(p.backlash).catch(() => null);
    await turntable.setSpeed(p.runUs, p.startUs, p.ramp).catch(() => null);
  }, [settings]);

  const connect = useCallback(async () => {
    const p = getActiveProfile(getCurrentSettings() || settings);
    await turntable.connect({ restorePosition: p.lastPosition });
    await turntable.setBacklash(p.backlash).catch(() => null);
    await turntable.setSpeed(p.runUs, p.startUs, p.ramp).catch(() => null);
  }, [settings]);

  // Sets a view where the table stands. With tag alignment on, the tags in the live view are stored with it,
  // and rotation references taken for the old position of that view are dropped.
  const setView = useCallback(
    async (view) => {
      const p = getActiveProfile(getCurrentSettings() || settings);
      const position = turntable.state.position;
      const seen = p.tags.enabled ? await observeTags({ family: p.tags.family }).catch(() => null) : null;
      // The live view as it is now becomes the picture this view is lined up against by hand
      const frame = await captureAlignFrame(p.id, view);
      const tagRefs = { ...p.tagRefs };
      if (seen?.tags?.length) tagRefs[view] = seen;
      else delete tagRefs[view];
      const rotationRefs = Object.fromEntries(Object.entries(p.rotationRefs).filter(([k]) => !k.startsWith(`${view}:`)));
      await updateProfile({ perspectives: { ...p.perspectives, [view]: position }, tagRefs, rotationRefs });
      if (p.tags.enabled) turntable.log(`View ${view} set at ${position} with ${seen?.tags?.length || 0} tags${seen?.tags?.length ? ` (ids ${seen.tags.map((tag) => tag.id).join(', ')})` : ''}`);
      return { position, tags: p.tags.enabled ? seen?.tags?.length || 0 : null, frame: !!frame };
    },
    [settings, updateProfile]
  );

  const goToView = useCallback(
    (view) => {
      const p = getActiveProfile(getCurrentSettings() || settings);
      return turnToView({ profile: p, view });
    },
    [settings]
  );

  return { state, profile, profiles, actions: { connect, connectSimulated, updateProfile, selectProfile, addProfile, deleteProfile, setView, goToView } };
}

export default useTurntable;
