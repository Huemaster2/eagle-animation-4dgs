import TurntableAngleSlider from '@components/TurntableAngleSlider';
import { HoldButton } from '@components/TurntableWindow';
import { turntable } from '@core/turntable';
import { angleOf, degreesToSteps, nearestEquivalent, PERSPECTIVES } from '@core/turntableMath';
import useTurntable from '@hooks/useTurntable';
import { useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const fmt = (deg) => `${deg.toFixed(1)}°`;

// Compact turntable page for the floating panel, so the table can be set up while watching the live view
const TurntableQuickControls = ({ t }) => {
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
  const goTo = (steps) => run(() => turntable.moveTo(nearestEquivalent(steps, state.position ?? steps, rev)));

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

      <p className={style.label}>{t('Views')}</p>
      {PERSPECTIVES.map((key) => {
        const value = profile.perspectives[key];
        return (
          <div className={style.viewRow} key={key}>
            <span className={style.viewName}>{t(key)}</span>
            <span className={style.hint}>{value === null ? t('not set') : fmt(angleOf(value, rev))}</span>
            <button type="button" className={style.btn} disabled={!ready} onClick={() => actions.updateProfile({ perspectives: { ...profile.perspectives, [key]: state.position } })}>
              {t('Set here')}
            </button>
            <button type="button" className={style.btn} disabled={!ready || value === null} onClick={() => goTo(value)}>
              {t('Go')}
            </button>
          </div>
        );
      })}
      {message && <p className={style.error}>{message}</p>}
      <p className={style.hint}>{t('Moving the table here never takes a photo.')}</p>
    </div>
  );
};

export default withTranslation()(TurntableQuickControls);
