import FloatingPanel from '@components/FloatingPanel';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

// Progress of a rotation capture. It is a floating window, not a dialog: drag it off the picture
// to keep watching the live view (and the focus aids) while the camera is moved between heights.
const RotationCaptureProgress = ({
  t,
  run = null,
  layout = {},
  onLayoutChange = () => {},
  onContinue = () => {},
  onPause = () => {},
  onResume = () => {},
  onRetry = () => {},
  onRetryMove = () => {},
  onRedoHeight = () => {},
  onStop = () => {},
}) => {
  if (!run) return null;
  const { phase, done = 0, total = 0, height, index, heights, shotsPerPass, folder, stopping, pausing, isFirst, reshooting, error } = run;
  const status = {
    starting: t('Turning to the start view…'),
    moving: t('Turning to photo {{n}} of {{of}}…', { n: (index ?? 0) + 1, of: shotsPerPass }),
    shooting: t('Taking photo {{n}} of {{of}}…', { n: (index ?? 0) + 1, of: shotsPerPass }),
    returning: t('Completing the turn…'),
    saving: t('Saving the frame…'),
  }[phase];
  const canPause = phase === 'moving' || phase === 'shooting' || phase === 'starting';
  const redoButton = (
    <button type="button" className={style.button} onClick={onRedoHeight}>
      {t('Start height {{h}} again', { h: height })}
    </button>
  );

  const body = () => {
    if (phase === 'moveFailed') {
      return (
        <>
          <p className={style.big}>{t('The turntable did not answer')}</p>
          <p className={style.hint}>{error}</p>
          <p className={style.hint}>{t('Nothing has turned and no photo was taken. {{done}} of {{total}} photos taken so far.', { done, total })}</p>
          <div className={style.buttons}>
            <button type="button" className={`${style.button} ${style.primary}`} onClick={onRetryMove}>
              {t('Try the move again')}
            </button>
            {redoButton}
            <button type="button" className={style.button} onClick={onStop}>
              {t('Stop and keep photos')}
            </button>
          </div>
        </>
      );
    }
    if (phase === 'failed') {
      return (
        <>
          <p className={style.big}>{t('Photo {{n}} of {{of}} at height {{h}} did not arrive', { n: (index ?? 0) + 1, of: shotsPerPass, h: height })}</p>
          <p className={style.hint}>{error}</p>
          <p className={style.hint}>{t('The table has not moved. {{done}} of {{total}} photos taken so far.', { done, total })}</p>
          <div className={style.buttons}>
            <button type="button" className={`${style.button} ${style.primary}`} onClick={onRetry}>
              {t('Take this photo again')}
            </button>
            {redoButton}
            <button type="button" className={style.button} onClick={onStop}>
              {t('Stop and keep photos')}
            </button>
          </div>
        </>
      );
    }
    if (phase === 'height') {
      return (
        <>
          <p className={style.big}>
            {isFirst ? t('Check the camera is at height {{h}} of {{of}}', { h: height, of: heights }) : t('Move the camera to height {{h}} of {{of}}', { h: height, of: heights })}
          </p>
          <p className={style.hint}>{t('Nothing moves until you continue. Drag this window aside to frame and focus on the live view — peaking, the magnifier and the scopes all keep working.')}</p>
          <p className={style.hint}>{t('{{done}} of {{total}} photos', { done, total })}</p>
          <div className={style.buttons}>
            <button type="button" className={`${style.button} ${style.primary}`} onClick={onContinue}>
              {t('Continue')}
            </button>
            <button type="button" className={style.button} onClick={onStop}>
              {t('Stop and keep photos')}
            </button>
          </div>
        </>
      );
    }
    if (phase === 'paused') {
      return (
        <>
          <p className={style.big}>{t('Paused before photo {{n}} of {{of}}', { n: (index ?? 0) + 1, of: shotsPerPass })}</p>
          <p className={style.hint}>{t('The table is holding its angle. Check the live view, then resume — the turn carries on where it left off.')}</p>
          <p className={style.hint}>{t('Starting this height again drops its photos so far and shoots the same angles once more, one turn further round.')}</p>
          <p className={style.hint}>{t('{{done}} of {{total}} photos', { done, total })}</p>
          <div className={style.buttons}>
            <button type="button" className={`${style.button} ${style.primary}`} onClick={onResume}>
              {t('Resume')}
            </button>
            {redoButton}
            <button type="button" className={style.button} onClick={onStop}>
              {t('Stop and keep photos')}
            </button>
          </div>
        </>
      );
    }
    return (
      <>
        <p className={style.big}>{reshooting ? t('Re-shooting height {{h}} of {{of}}', { h: reshooting, of: heights }) : t('Height {{h}} of {{of}}', { h: height ?? '–', of: heights })}</p>
        <p className={style.hint}>{stopping ? t('Stopping after this photo…') : pausing ? t('Pausing after this photo…') : status}</p>
        <div className={style.bar}>
          <span className={style.fill} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <p className={style.hint}>
          {t('{{done}} of {{total}} photos', { done, total })}
          {folder ? ` · ${folder}` : ''}
        </p>
        <div className={style.buttons}>
          <button type="button" className={style.button} disabled={!canPause || pausing || stopping} onClick={onPause}>
            {t('Pause')}
          </button>
          <button type="button" className={style.button} disabled={stopping || phase === 'saving'} onClick={onStop}>
            {t('Stop and keep photos')}
          </button>
        </div>
      </>
    );
  };

  return (
    <FloatingPanel title={t('Rotation capture')} layout={layout} defaults={{ W: 440, H: 250 }} minWidth={300} minHeight={160} closable={false} collapsible={false} onLayoutChange={onLayoutChange}>
      <div className={style.body}>{body()}</div>
    </FloatingPanel>
  );
};

export default withTranslation()(RotationCaptureProgress);
