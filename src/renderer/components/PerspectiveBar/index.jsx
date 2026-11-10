import { PERSPECTIVES } from '@core/turntableMath';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

// FRONT/RIGHT/BACK/LEFT: switches reference sequences and onion view. While posing it turns the
// table; while reviewing it picks which photo of each full turn the timeline and playback show.
const PerspectiveBar = ({ t, active = null, status = '', busy = false, reviewing = false, calibrated = {}, onSelect = () => {}, onTurn = null }) => (
  <div className={style.bar} role="toolbar" aria-label={t('Views')}>
    <span className={style.label}>{reviewing ? t('Timeline from') : t('Live view at')}</span>
    {PERSPECTIVES.map((view) => (
      <button
        key={view}
        type="button"
        className={`${style.view} ${active === view ? style.active : ''} ${calibrated[view] ? '' : style.uncalibrated}`}
        disabled={busy}
        aria-pressed={active === view}
        title={
          reviewing
            ? t('Show every full turn from {{view}} (the table does not move)', { view: t(view) })
            : calibrated[view]
              ? t('Turn to {{view}} and show its references', { view: t(view) })
              : t('{{view}}: references only (not calibrated on the turntable)', { view: t(view) })
        }
        onClick={() => onSelect(active === view ? null : view)}
      >
        {t(view)}
      </button>
    ))}
    {onTurn && (
      <button type="button" className={style.turn} disabled={busy} onClick={onTurn}>
        {t('Turn table here')}
      </button>
    )}
    {status && <span className={`${style.status} ${busy ? style.moving : ''}`}>{status}</span>}
  </div>
);

export default withTranslation()(PerspectiveBar);
