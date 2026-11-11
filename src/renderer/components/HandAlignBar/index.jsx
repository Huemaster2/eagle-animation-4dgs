import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const STEPS = [-10, -1, 1, 10];

// Shown while a view is being lined up by hand: the stored picture ghosts over the live view,
// the table is nudged until the two agree, and Aligned tells the motor that this is the view.
const HandAlignBar = ({ t, align = null, busy = false, onNudge = () => {}, onHold = () => {}, onRelease = () => {}, onChange = () => {}, onRetake = null, onDone = () => {}, onSkip = () => {} }) => {
  if (!align) return null;
  const hold = (dir) => ({
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onHold(dir);
    },
    onPointerUp: onRelease,
    onPointerCancel: onRelease,
    onLostPointerCapture: onRelease,
  });
  return (
    <div className={style.bar}>
      <span className={style.title}>
        {align.frame ? t('Line {{view}} up with the ghost picture', { view: t(align.view) }) : t('Line {{view}} up by eye: no picture is stored for it yet', { view: t(align.view) })}
      </span>
      <div className={style.group}>
        <button type="button" className={style.btn} disabled={busy && !align.jogging} {...hold(-1)}>
          ⟲ {t('Hold')}
        </button>
        {STEPS.map((n) => (
          <button key={n} type="button" className={style.btn} disabled={busy} onClick={() => onNudge(n)}>
            {n > 0 ? `+${n}` : n}
          </button>
        ))}
        <button type="button" className={style.btn} disabled={busy && !align.jogging} {...hold(1)}>
          {t('Hold')} ⟳
        </button>
      </div>
      {align.frame && (
        <div className={style.group}>
          <span className={style.hint}>{t('Ghost')}</span>
          <input type="range" min={0} max={1} step={0.05} value={align.opacity} onChange={(e) => onChange({ opacity: Number(e.target.value) })} />
          <button
            type="button"
            className={`${style.btn} ${align.difference ? style.on : ''}`}
            onClick={() => onChange({ difference: !align.difference })}
            title={t('Shows only what differs: the picture goes dark where the table is lined up')}
          >
            {t('Difference')}
          </button>
        </div>
      )}
      <div className={style.group}>
        {onRetake && (
          <button type="button" className={style.btn} disabled={busy} onClick={onRetake} title={t('Stores the live view as it is now as the picture to line up with')}>
            {t('Use this as the picture')}
          </button>
        )}
        <button type="button" className={style.btn} onClick={onSkip}>
          {t('Skip')}
        </button>
        <button type="button" className={`${style.btn} ${style.primary}`} disabled={busy} onClick={onDone}>
          {t('Aligned')}
        </button>
      </div>
    </div>
  );
};

export default withTranslation()(HandAlignBar);
