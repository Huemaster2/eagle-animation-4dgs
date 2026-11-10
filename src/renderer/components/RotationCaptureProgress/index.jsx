import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

// Progress of a rotation capture; between heights it waits for the camera to be moved by hand
const RotationCaptureProgress = ({ t, run = null, onContinue = () => {}, onStop = () => {} }) => {
  if (!run) return null;
  const { phase, done = 0, total = 0, height, index, heights, shotsPerPass, folder, stopping, isFirst } = run;
  const waiting = phase === 'height';
  const status = {
    starting: t('Turning to the start view…'),
    moving: t('Turning to photo {{n}} of {{of}}…', { n: (index ?? 0) + 1, of: shotsPerPass }),
    shooting: t('Taking photo {{n}} of {{of}}…', { n: (index ?? 0) + 1, of: shotsPerPass }),
    returning: t('Completing the turn…'),
    saving: t('Saving the frame…'),
  }[phase];

  return (
    <div className={style.panel} role="dialog" aria-label={t('Rotation capture')}>
      <div className={style.titleBar}>
        <span className={style.stripes} />
        <span className={style.title}>{t('Rotation capture')}</span>
        <span className={style.stripes} />
      </div>
      <div className={style.body}>
        {waiting ? (
          <>
            <p className={style.big}>
              {isFirst ? t('Check the camera is at height {{h}} of {{of}}', { h: height, of: heights }) : t('Move the camera to height {{h}} of {{of}}', { h: height, of: heights })}
            </p>
            <p className={style.hint}>
              {isFirst
                ? t('The table is at the start view. Continue (or press the shutter key) when the camera is in place.')
                : t('The table is back at the start view. Continue (or press the shutter key) when the camera is in place — nothing moves until you do.')}
            </p>
            <div className={style.buttons}>
              <button type="button" className={`${style.button} ${style.primary}`} onClick={onContinue} autoFocus>
                {t('Continue')}
              </button>
              <button type="button" className={style.button} onClick={onStop}>
                {t('Stop and keep photos')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={style.big}>{t('Height {{h}} of {{of}}', { h: height ?? '–', of: heights })}</p>
            <p className={style.hint}>{stopping ? t('Stopping after this photo…') : status}</p>
            <div className={style.bar}>
              <span className={style.fill} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <p className={style.hint}>
              {t('{{done}} of {{total}} photos', { done, total })}
              {folder ? ` · ${folder}` : ''}
            </p>
            <div className={style.buttons}>
              <button type="button" className={style.button} disabled={stopping || phase === 'saving'} onClick={onStop}>
                {t('Stop and keep photos')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default withTranslation()(RotationCaptureProgress);
