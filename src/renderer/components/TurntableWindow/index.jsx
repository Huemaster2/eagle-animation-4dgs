import ActionCard from '@components/ActionCard';
import Heading from '@components/Heading';
import Select from '@components/Select';
import Switch from '@components/Switch';
import TurntableAngleSlider from '@components/TurntableAngleSlider';
import { flashArduinoUno } from '@core/arduinoFlasher';
import { findArduinoPort, turntable } from '@core/turntable';
import { angleOf, degreesToSteps, nearestEquivalent, PERSPECTIVES } from '@core/turntableMath';
import useTurntable from '@hooks/useTurntable';
import { useEffect, useState } from 'react';
import { withTranslation } from 'react-i18next';

import firmwareHex from '~/native/turntable-firmware/StopMoTurntable.hex?raw';

import * as style from './style.module.css';

const DEGREE_STEPS = [1, 5, 15, 45, 90];
const fmt = (deg) => `${deg.toFixed(1)}°`;

// Plain button that keeps rotating while held (pointer or Space/Enter) and decelerates on release
export const HoldButton = ({ dir, disabled, children, onError, className = '' }) => {
  const [held, setHeld] = useState(false);
  const start = () => {
    if (disabled || held) return;
    setHeld(true);
    turntable.jogStart(dir).catch((err) => onError(err.message));
  };
  const end = () => {
    if (!held) return;
    setHeld(false);
    turntable.jogStop().catch((err) => onError(err.message));
  };
  return (
    <button
      type="button"
      className={`${style.hold} ${held ? style.held : ''} ${className}`}
      disabled={disabled && !held}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && start()}
      onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && end()}
    >
      {children}
    </button>
  );
};

const TurntableWindow = ({ t }) => {
  const { state, profile, profiles, actions } = useTurntable();
  const [message, setMessage] = useState('');
  const [flash, setFlash] = useState(null);
  const [gotoAngle, setGotoAngle] = useState('');
  const [previewIndex, setPreviewIndex] = useState(0);

  const rev = state.stepsPerRev;
  const ready = state.connected && !state.moving && !flash;
  const fail = (err) => setMessage(typeof err === 'string' ? err : err?.message || String(err));

  const run = async (fn) => {
    setMessage('');
    try {
      await fn();
    } catch (err) {
      fail(err);
    }
  };

  // Any move goes to the same angle on the nearest revolution, always finishing forward (firmware backlash rule)
  const goTo = (steps) => run(() => turntable.moveTo(nearestEquivalent(steps, state.position ?? steps, rev)));

  // Stops of one full turn from the start view (or from where the table is)
  const startSteps = PERSPECTIVES.includes(profile.rotationStart) && profile.perspectives[profile.rotationStart] !== null ? profile.perspectives[profile.rotationStart] : (state.position ?? 0);
  const interval = profile.stepDegrees;
  const shots = Array.from({ length: profile.shotsPerPass }, (_, i) => startSteps + (i * interval * rev) / 360);

  useEffect(() => {
    if (previewIndex >= shots.length) setPreviewIndex(0);
  }, [shots.length, previewIndex]);

  const installFirmware = async () => {
    setMessage('');
    try {
      if (state.connected) await turntable.disconnect();
      const port = await findArduinoPort();
      setFlash({ stage: 'connecting', done: 0, total: 1 });
      const r = await flashArduinoUno(port, firmwareHex, (stage, done, total) => setFlash({ stage, done, total }));
      setFlash(null);
      setMessage(t('Firmware installed and verified ({{bytes}} bytes). Connecting…', { bytes: r.bytes }));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await actions.connect();
      setMessage(t('Firmware installed and verified ({{bytes}} bytes).', { bytes: r.bytes }));
    } catch (err) {
      setFlash(null);
      fail(err);
    }
  };

  const status = !state.connected
    ? state.connecting
      ? t('Connecting…')
      : t('Not connected')
    : state.jogging
      ? t('Rotating…')
      : state.moving
        ? t('Moving to {{angle}}…', { angle: fmt(angleOf(state.target ?? 0, rev)) })
        : t('Stopped');

  return (
    <div className={style.container}>
      <Heading h={1}>{t('Turntable')}</Heading>

      <div className={style.statusRow}>
        <span className={`${style.dot} ${state.connected ? (state.moving ? style.busy : style.ok) : style.bad}`} />
        <span className={style.statusText}>{status}</span>
        {state.connected && (
          <span className={style.readout}>
            {fmt(angleOf(state.position ?? 0, rev))}{' '}
            <small>
              ({state.position} {t('steps')})
            </small>
          </span>
        )}
      </div>
      {!state.supported && <p className={style.error}>{t('Serial ports are not available in this build.')}</p>}
      {state.error && !state.connected && <p className={style.error}>{state.error}</p>}
      {message && <p className={style.hint}>{message}</p>}
      {flash && (
        <div className={style.progress}>
          <span>{flash.stage === 'connecting' ? t('Waiting for the Arduino bootloader…') : flash.stage === 'writing' ? t('Writing firmware…') : t('Verifying…')}</span>
          <progress max={flash.total} value={flash.done} />
        </div>
      )}

      <div className={style.buttons}>
        {!state.connected ? (
          <ActionCard sizeAuto disabled={!state.supported || state.connecting || !!flash} title={t('Connect turntable')} onClick={() => run(actions.connect)} />
        ) : (
          <ActionCard sizeAuto secondary title={t('Disconnect')} onClick={() => run(() => turntable.disconnect())} />
        )}
        <ActionCard sizeAuto secondary disabled={!!flash || state.moving} title={t('Install turntable firmware')} onClick={installFirmware} />
      </div>
      {state.connected && <p className={style.hint}>{t('Position is restored from the last session. If the table was turned by hand, line it up and press “Set as 0°” or re-set the views.')}</p>}

      <section className={style.section}>
        <Heading h={2}>{t('Manual control')}</Heading>
        <div className={style.controlRow}>
          <HoldButton dir={-1} disabled={!state.connected || (state.moving && !state.jogging)} onError={fail}>
            ⟲ {t('Hold')}
          </HoldButton>
          <button type="button" className={style.stop} disabled={!state.connected} onClick={() => run(() => turntable.stop())}>
            {t('STOP')}
          </button>
          <HoldButton dir={1} disabled={!state.connected || (state.moving && !state.jogging)} onError={fail}>
            {t('Hold')} ⟳
          </HoldButton>
        </div>
        <TurntableAngleSlider state={state} onError={fail} />
        <div className={style.stepRow}>
          {[...DEGREE_STEPS].reverse().map((d) => (
            <button key={`m${d}`} type="button" className={style.step} disabled={!ready} onClick={() => run(() => turntable.moveBy(-degreesToSteps(d, rev)))}>
              −{d}°
            </button>
          ))}
          {DEGREE_STEPS.map((d) => (
            <button key={`p${d}`} type="button" className={style.step} disabled={!ready} onClick={() => run(() => turntable.moveBy(degreesToSteps(d, rev)))}>
              +{d}°
            </button>
          ))}
        </div>
        <div className={style.stepRow}>
          <span className={style.subLabel}>{t('Fine')}</span>
          {[-10, -1, 1, 10].map((s) => (
            <button key={s} type="button" className={style.step} disabled={!ready} onClick={() => run(() => turntable.moveBy(s))}>
              {s > 0 ? `+${s}` : `−${-s}`} {t('step')}
            </button>
          ))}
          <span className={style.subLabel}>{t('Go to')}</span>
          <input className={style.number} type="number" step="0.1" value={gotoAngle} placeholder="°" onChange={(e) => setGotoAngle(e.target.value)} />
          <button type="button" className={style.step} disabled={!ready || gotoAngle === ''} onClick={() => goTo(degreesToSteps(Number(gotoAngle), rev))}>
            {t('Go')}
          </button>
          <button type="button" className={style.step} disabled={!ready} onClick={() => run(() => turntable.setPosition(0))}>
            {t('Set as 0°')}
          </button>
        </div>
      </section>

      <section className={style.section}>
        <Heading h={2}>{t('Views')}</Heading>
        <p className={style.hint}>{t('Turn the table to each view and press “Set here”. The view buttons above the picture then turn the table there and switch reference sequences.')}</p>
        {PERSPECTIVES.map((key) => {
          const value = profile.perspectives[key];
          return (
            <div className={style.row} key={key}>
              <span className={style.label}>{t(key)}</span>
              <span className={style.value}>{value === null ? t('not set') : fmt(angleOf(value, rev))}</span>
              <div className={style.inline}>
                <button type="button" className={style.step} disabled={!ready} onClick={() => run(() => actions.setView(key))}>
                  {t('Set here')}
                </button>
                <button type="button" className={style.step} disabled={!ready || value === null} onClick={() => run(() => actions.goToView(key))}>
                  {t('Go')}
                </button>
                <button
                  type="button"
                  className={style.step}
                  disabled={value === null}
                  onClick={() => actions.updateProfile({ perspectives: { ...profile.perspectives, [key]: null }, tagRefs: { ...profile.tagRefs, [key]: undefined } })}
                >
                  {t('Clear')}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <section className={style.section}>
        <Heading h={2}>{t('Rotation capture')}</Heading>
        <label className={style.row}>
          <span className={style.label}>{t('Shutter takes a full turn of photos')}</span>
          <Switch checked={profile.rotationCapture} onChange={() => actions.updateProfile({ rotationCapture: !profile.rotationCapture })} />
        </label>
        <div className={style.row}>
          <span className={style.label}>{t('Photos per turn')}</span>
          <input className={style.number} type="number" min={1} max={1000} value={profile.shotsPerPass} onChange={(e) => actions.updateProfile({ shotsPerPass: e.target.value })} />
          <span className={style.label}>{t('Degrees apart')}</span>
          <input className={style.number} type="number" min={0.1} max={360} step={0.1} value={profile.stepDegrees} onChange={(e) => actions.updateProfile({ stepDegrees: e.target.value })} />
          <span className={style.label}>{t('Camera heights')}</span>
          <input className={style.number} type="number" min={1} max={10} value={profile.heights} onChange={(e) => actions.updateProfile({ heights: e.target.value })} />
          <span className={style.label}>{t('Settle (ms)')}</span>
          <input className={style.number} type="number" min={0} max={10000} step={100} value={profile.settleMs} onChange={(e) => actions.updateProfile({ settleMs: e.target.value })} />
        </div>
        <div className={style.row}>
          <span className={style.label}>{t('Start at')}</span>
          <Select
            options={[...PERSPECTIVES.map((v) => ({ value: v, label: profile.perspectives[v] === null ? `${t(v)} (${t('not set')})` : t(v) })), { value: 'CURRENT', label: t('Where the table is') }]}
            value={profile.rotationStart}
            onChange={(e) => actions.updateProfile({ rotationStart: e.target.value })}
          />
          <span className={style.label}>{t('Timeline photo from height')}</span>
          <input
            className={style.number}
            type="number"
            min={1}
            max={profile.heights}
            value={Math.min(profile.heroHeight, profile.heights)}
            onChange={(e) => actions.updateProfile({ heroHeight: e.target.value })}
          />
        </div>
        <label className={style.row}>
          <span className={style.label}>{t('Alternate height order (1→{{n}}, then {{n}}→1) to save moving the camera', { n: profile.heights })}</span>
          <Switch checked={profile.alternateHeights} onChange={() => actions.updateProfile({ alternateHeights: !profile.alternateHeights })} />
        </label>
        <p className={style.hint}>
          {t(
            '{{n}} photos {{deg}} apart ({{span}} in all), at {{heights}} heights you set by hand: {{total}} photos per frame. The table finishes the turn it is on before the next height. The photo at the start view and height {{hero}} is the frame shown in the timeline; the rest open from the frame.',
            {
              n: profile.shotsPerPass,
              deg: fmt(interval),
              span: fmt((profile.shotsPerPass - 1) * interval),
              heights: profile.heights,
              total: profile.shotsPerPass * profile.heights,
              hero: Math.min(profile.heroHeight, profile.heights),
            }
          )}
          {PERSPECTIVES.includes(profile.rotationStart) &&
            profile.perspectives[profile.rotationStart] === null &&
            ` ${t('{{view}} is not set yet, so the turn starts where the table is.', { view: t(profile.rotationStart) })}`}
        </p>
        <div className={style.chips}>
          {shots.map((s, i) => (
            <button
              key={i}
              type="button"
              className={`${style.chip} ${i === previewIndex ? style.chipActive : ''}`}
              disabled={!ready}
              title={t('Turn to photo {{n}} (no photo is taken)', { n: i + 1 })}
              onClick={() => {
                setPreviewIndex(i);
                goTo(Math.round(s));
              }}
            >
              {i + 1}: {fmt(angleOf(s, rev))}
            </button>
          ))}
        </div>
      </section>

      <section className={style.section}>
        <Heading h={2}>{t('Profile')}</Heading>
        <div className={style.row}>
          <Select options={profiles.map((p) => ({ value: p.id, label: p.name }))} value={profile.id} onChange={(e) => actions.selectProfile(e.target.value)} />
          <input className={style.text} value={profile.name} onChange={(e) => actions.updateProfile({ name: e.target.value })} />
          <button type="button" className={style.step} onClick={() => actions.addProfile()}>
            {t('New')}
          </button>
          <button type="button" className={style.step} disabled={profiles.length < 2} onClick={() => actions.deleteProfile(profile.id)}>
            {t('Delete')}
          </button>
        </div>
        <div className={style.row}>
          <span className={style.subLabel}>{t('Backlash (steps)')}</span>
          <input className={style.number} type="number" min={0} max={500} value={profile.backlash} onChange={(e) => actions.updateProfile({ backlash: e.target.value })} />
          <span className={style.subLabel}>{t('Step delay µs (run / start / ramp)')}</span>
          <input className={style.number} type="number" min={200} value={profile.runUs} onChange={(e) => actions.updateProfile({ runUs: e.target.value })} />
          <input className={style.number} type="number" min={200} value={profile.startUs} onChange={(e) => actions.updateProfile({ startUs: e.target.value })} />
          <input className={style.number} type="number" min={0} value={profile.ramp} onChange={(e) => actions.updateProfile({ ramp: e.target.value })} />
          <button
            type="button"
            className={style.step}
            disabled={!ready}
            onClick={() =>
              run(async () => {
                await turntable.setBacklash(profile.backlash);
                await turntable.setSpeed(profile.runUs, profile.startUs, profile.ramp);
                setMessage(t('Motor settings sent to the turntable.'));
              })
            }
          >
            {t('Apply')}
          </button>
        </div>
        <p className={style.hint}>{t('Profiles are saved automatically.')}</p>
      </section>

      {state.log.length > 0 && (
        <details className={style.log}>
          <summary>{t('Turntable log')}</summary>
          <pre>{state.log.slice(-40).join('\n')}</pre>
        </details>
      )}
    </div>
  );
};

export default withTranslation()(TurntableWindow);
