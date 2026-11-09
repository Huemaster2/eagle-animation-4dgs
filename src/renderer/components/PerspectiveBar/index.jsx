import { PERSPECTIVES } from '@core/turntableMath';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

// FRONT/RIGHT/BACK/LEFT: switches reference sequences and onion view, and turns the table if it is connected
const PerspectiveBar = ({ t, active = null, status = '', busy = false, calibrated = {}, onSelect = () => {} }) => (
  <div className={style.bar} role="toolbar" aria-label={t('Views')}>
    {PERSPECTIVES.map((view) => (
      <button
        key={view}
        type="button"
        className={`${style.view} ${active === view ? style.active : ''} ${calibrated[view] ? '' : style.uncalibrated}`}
        disabled={busy}
        aria-pressed={active === view}
        title={calibrated[view] ? t('Turn to {{view}} and show its references', { view: t(view) }) : t('{{view}}: references only (not calibrated on the turntable)', { view: t(view) })}
        onClick={() => onSelect(active === view ? null : view)}
      >
        {t(view)}
      </button>
    ))}
    {status && <span className={`${style.status} ${busy ? style.moving : ''}`}>{status}</span>}
  </div>
);

export default withTranslation()(PerspectiveBar);
