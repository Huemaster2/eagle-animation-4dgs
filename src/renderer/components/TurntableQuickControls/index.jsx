import Switch from '@components/Switch';
import TurntableAngleSlider from '@components/TurntableAngleSlider';
import { HoldButton } from '@components/TurntableWindow';
import { STOPMO_CAMERA_AVAILABLE } from '@core/stopmoCamera';
import { TAG_FAMILIES } from '@core/tagDetect';
import { observeTags } from '@core/tagVision';
import { turntable } from '@core/turntable';
import { angleOf, degreesToSteps, PERSPECTIVES } from '@core/turntableMath';
import { ACCEL_LEVELS, motorTuning, SPEED_LEVELS, tuningLevels } from '@core/turntableProfiles';
import useTurntable from '@hooks/useTurntable';
import { useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const fmt = (deg) => `${deg.toFixed(1)}°`;

// Why the tags could not bring the table home, in words
export const tagFailure = (t, tags) => {
  if (tags.reason === 'no-match' || tags.reason === 'lost') return t('The stored tags are not in the live view, so the table was turned by motor angle only.');
  if (tags.reason === 'no-motion') return t('The tags did not move when the table was told to turn: check the motor and the drive.');
  if (tags.reason === 'stopped') return t('Tag alignment was stopped.');
  return t('Tags still {{px}} px from their stored place after correcting: the camera or the tags may have moved since the view was set.', { px: tags.residualPx });
};

// Compact turntable page for the floating panel, so the table can be set up while watching the live view
const TurntableQuickControls = ({ t, activeView = null, onGo = null }) => {
  const { state, profile, actions } = useTurntable();
  const [message, setMessage] = useState('');
  const rev = state.stepsPerRev;
  const ready = state.connected && !state.moving;
  const fail = (err) => setMessage(typeof err === 'string' ? err : err?.message || String(err));
  const run = async (fn) => {
    setMessage('');
    try {
      await fn();
    } catch (err) {
      fail(err);
    }
  };
  // Setting a view also stores where its tags are in the picture, when tag alignment is on
  const setView = (view) =>
    run(async () => {
      const result = await actions.setView(view);
      if (result.tags === 0) setMessage(t('{{view}} set by motor angle only: no AprilTag was found in the live view.', { view: t(view) }));
    });
  const goToView = (view) =>
    run(async () => {
      // The animator's own turn also runs the by-hand line-up for views that ask for it
      if (onGo) {
        await onGo(view);
        return;
      }
      const result = await actions.goToView(view);
      if (result.tags && !result.tags.ok) setMessage(tagFailure(t, result.tags));
      else if (result.noReference) setMessage(t('{{view}} has no tags stored: turned by motor angle only. Press Set here with the tags in view.', { view: t(view) }));
    });

  const levels = tuningLevels(profile);
  const applyTuning = (speed, accel) =>
    run(async () => {
      const tuning = motorTuning(speed, accel);
      await actions.updateProfile(tuning);
      if (turntable.state.connected && !turntable.state.moving) await turntable.setSpeed(tuning.runUs, tuning.startUs, tuning.ramp);
    });
  // Degrees per second at full speed: a step lasts two delays
  const degPerSecond = (360 * 1e6) / (2 * profile.runUs * rev);

  const [tagsSeen, setTagsSeen] = useState(null);
  const checkTags = () =>
    run(async () => {
      setTagsSeen({ checking: true });
      const seen = await observeTags({ family: profile.tags.family });
      setTagsSeen(seen ? { ids: seen.tags.map((tag) => tag.id) } : { failed: true });
    });

  if (!state.connected) {
    return (
      <div className={style.wrap}>
        <p className={style.hint}>{state.connecting ? t('Connecting…') : t('Not connected')}</p>
        {state.error && <p className={style.error}>{state.error}</p>}
        {message && <p className={style.error}>{message}</p>}
        <button type="button" className={style.btn} disabled={!state.supported || state.connecting} onClick={() => run(actions.connect)}>
          {t('Connect turntable')}
        </button>
      </div>
    );
  }

  return (
    <div className={style.wrap}>
      <div className={style.readout}>
        <span className={style.angle}>{fmt(angleOf(state.position ?? 0, rev))}</span>
        <span className={style.hint}>{state.jogging ? t('Rotating…') : state.moving ? t('Moving…') : t('Stopped')}</span>
      </div>

      <TurntableAngleSlider state={state} onError={fail} />

      {activeView && (
        <div className={style.calibrate}>
          <span className={style.hint}>{t('{{view}} reference is on the picture. Turn the table until the live view lines up with it, then:', { view: t(activeView) })}</span>
          <button type="button" className={`${style.btn} ${style.primary}`} disabled={!ready} onClick={() => setView(activeView)}>
            {t('Set {{view}} here', { view: t(activeView) })}
          </button>
        </div>
      )}

      <div className={style.row}>
        <HoldButton className={style.grow} dir={-1} disabled={state.moving && !state.jogging} onError={fail}>
          ⟲ {t('Hold')}
        </HoldButton>
        <button type="button" className={`${style.btn} ${style.stop}`} onClick={() => run(() => turntable.stop())}>
          {t('STOP')}
        </button>
        <HoldButton className={style.grow} dir={1} disabled={state.moving && !state.jogging} onError={fail}>
          {t('Hold')} ⟳
        </HoldButton>
      </div>

      <div className={style.row}>
        {[-15, -5, -1, 1, 5, 15].map((d) => (
          <button key={d} type="button" className={style.btn} disabled={!ready} onClick={() => run(() => turntable.moveBy(degreesToSteps(d, rev)))}>
            {d > 0 ? `+${d}` : `−${-d}`}°
          </button>
        ))}
      </div>
      <div className={style.row}>
        {[-10, -1, 1, 10].map((s) => (
          <button key={s} type="button" className={style.btn} disabled={!ready} onClick={() => run(() => turntable.moveBy(s))}>
            {s > 0 ? `+${s}` : `−${-s}`} {t('step')}
          </button>
        ))}
        <button type="button" className={style.btn} disabled={!ready} onClick={() => run(() => turntable.setPosition(0))}>
          {t('Set as 0°')}
        </button>
      </div>

      <label className={`${style.readout} ${style.label}`}>
        <span>{t('Shutter takes a full turn ({{n}} × {{h}} heights)', { n: profile.shotsPerPass, h: profile.heights })}</span>
        <Switch checked={profile.rotationCapture} onChange={() => actions.updateProfile({ rotationCapture: !profile.rotationCapture })} />
      </label>
      <p className={style.label}>{t('Views')}</p>
      {PERSPECTIVES.map((key) => {
        const value = profile.perspectives[key];
        return (
          <div className={style.viewRow} key={key}>
            <span className={style.viewName}>{t(key)}</span>
            <span className={style.hint}>
              {value === null ? t('not set') : fmt(angleOf(value, rev))}
              {profile.tags.enabled && value !== null ? ` · ${t('{{n}} tags', { n: profile.tagRefs[key]?.tags?.length || 0 })}` : ''}
            </span>
            <button type="button" className={style.btn} disabled={!ready} onClick={() => setView(key)}>
              {t('Set here')}
            </button>
            <button type="button" className={style.btn} disabled={!ready || value === null} onClick={() => goToView(key)}>
              {t('Go')}
            </button>
            <button
              type="button"
              className={`${style.btn} ${profile.handAlign[key] ? style.on : ''}`}
              title={t('Line this view up by hand each time: after the turn, a stored picture of the view ghosts over the live view and the table is nudged until they agree')}
              onClick={() => actions.updateProfile({ handAlign: { ...profile.handAlign, [key]: !profile.handAlign[key] } })}
            >
              {t('By hand')}
            </button>
          </div>
        );
      })}
      <p className={style.label}>{t('Speed')}</p>
      <label className={style.sliderRow}>
        <span className={style.viewName}>{t('Table')}</span>
        <input
          type="range"
          min={0}
          max={SPEED_LEVELS.length - 1}
          step={1}
          value={levels.speed < 0 ? 2 : levels.speed}
          onChange={(e) => applyTuning(Number(e.target.value), levels.accel < 0 ? 1 : levels.accel)}
        />
        <span className={style.hint}>{levels.speed < 0 ? t('custom') : `${degPerSecond.toFixed(0)}°/s`}</span>
      </label>
      <div className={style.row}>
        {ACCEL_LEVELS.map((level, i) => (
          <button key={level.id} type="button" className={`${style.btn} ${levels.accel === i ? style.on : ''}`} onClick={() => applyTuning(levels.speed < 0 ? 2 : levels.speed, i)}>
            {[t('Soft start'), t('Medium start'), t('Hard start')][i]}
          </button>
        ))}
      </div>
      <label className={style.sliderRow}>
        <span className={style.viewName}>{t('Pause')}</span>
        <input type="range" min={0} max={3000} step={100} value={profile.settleMs} onChange={(e) => actions.updateProfile({ settleMs: Number(e.target.value) })} />
        <span className={style.hint}>{`${(profile.settleMs / 1000).toFixed(1)} s`}</span>
      </label>
      <p className={style.hint}>{t('Pause is the wait after each turn before the photo, for the puppet to stop swaying. A soft start is slower over short turns but least likely to skip steps.')}</p>

      {STOPMO_CAMERA_AVAILABLE && (
        <>
          <label className={`${style.readout} ${style.label}`}>
            <span>{t('Align with AprilTags')}</span>
            <Switch checked={profile.tags.enabled} onChange={() => actions.updateProfile({ tags: { ...profile.tags, enabled: !profile.tags.enabled } })} />
          </label>
          {profile.tags.enabled && (
            <>
              <div className={style.row}>
                <select className={style.btn} value={profile.tags.family} onChange={(e) => actions.updateProfile({ tags: { ...profile.tags, family: e.target.value }, tagRefs: {}, rotationRefs: {} })}>
                  {TAG_FAMILIES.map((family) => (
                    <option key={family.id} value={family.id}>
                      {t('Tag family {{name}}', { name: family.label })}
                    </option>
                  ))}
                </select>
                <button type="button" className={style.btn} disabled={tagsSeen?.checking} onClick={checkTags}>
                  {t('Look for tags')}
                </button>
              </div>
              <p className={style.hint}>
                {tagsSeen?.checking && t('Looking…')}
                {tagsSeen?.failed && t('No live view picture to look at.')}
                {tagsSeen?.ids && (tagsSeen.ids.length ? t('{{n}} tags in the live view: {{ids}}', { n: tagsSeen.ids.length, ids: tagsSeen.ids.join(', ') }) : t('No tag found in the live view.'))}
                {!tagsSeen && t('Tags fixed to the table are matched in the live view. Set here stores where they are; Go and each full turn bring them back to the same place.')}
              </p>
              <button
                type="button"
                className={style.btn}
                disabled={!Object.keys(profile.tagRefs).length && !Object.keys(profile.rotationRefs).length}
                onClick={() => actions.updateProfile({ tagRefs: {}, rotationRefs: {} })}
              >
                {t('Forget stored tag positions')}
              </button>
            </>
          )}
        </>
      )}
      {message && <p className={style.error}>{message}</p>}
      <p className={style.hint}>{t('Moving the table here never takes a photo.')}</p>
    </div>
  );
};

export default withTranslation()(TurntableQuickControls);
