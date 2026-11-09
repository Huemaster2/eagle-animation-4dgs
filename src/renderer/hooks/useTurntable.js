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

  const updateProfile = useCallback((patch) => writeProfiles((list, activeId) => ({ list: list.map((p) => (p.id === activeId ? { ...p, ...patch } : p)) })), [writeProfiles]);

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

  const connect = useCallback(async () => {
    const p = getActiveProfile(getCurrentSettings() || settings);
    await turntable.connect({ restorePosition: p.lastPosition });
    await turntable.setBacklash(p.backlash).catch(() => null);
    await turntable.setSpeed(p.runUs, p.startUs, p.ramp).catch(() => null);
  }, [settings]);

  return { state, profile, profiles, actions: { connect, updateProfile, selectProfile, addProfile, deleteProfile } };
}

export default useTurntable;
