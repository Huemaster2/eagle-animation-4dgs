import CustomSlider from '@components/CustomSlider';
import Switch from '@components/Switch';
import { DEFAULT_FOCUS_PEAKING, PEAKING_COLORS } from '@core/focusPeaking';
import { MAGNIFIER_ZOOMS } from '@core/magnifier';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

// Focus peaking, magnifier and scopes for the live view
const LiveAssistControls = ({ t, focusPeaking = DEFAULT_FOCUS_PEAKING, histogram = {}, parade = {}, magnifier = {}, onChange = () => {} }) => {
  const peaking = { ...DEFAULT_FOCUS_PEAKING, ...focusPeaking };
  const setPeaking = (patch) => onChange({ FOCUS_PEAKING: { ...peaking, ...patch } });
  const colorNames = { '#ffe000': t('Yellow'), '#4dff88': t('Green'), '#ffffff': t('White') };

  return (
    <div className={style.wrap}>
      <label className={style.row}>
        <span className={style.label}>{t('Focus peaking')}</span>
        <Switch checked={!!peaking.ENABLED} onChange={() => setPeaking({ ENABLED: !peaking.ENABLED })} />
      </label>
      <div className={style.row}>
        <span className={style.sub}>{t('Colour')}</span>
        <div className={style.swatches}>
          {PEAKING_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`${style.swatch} ${peaking.COLOR === c ? style.swatchActive : ''}`}
              style={{ background: c }}
              title={colorNames[c]}
              aria-label={colorNames[c]}
              aria-pressed={peaking.COLOR === c}
              onClick={() => setPeaking({ COLOR: c })}
            />
          ))}
        </div>
      </div>
      <div className={style.column}>
        <span className={style.sub}>{t('Sensitivity')}</span>
        <CustomSlider min={0} max={1} step={0.05} value={Number(peaking.SENSITIVITY)} maxWidth="100%" onChange={(v) => setPeaking({ SENSITIVITY: v })} />
        <span className={style.hint}>{t('Higher marks softer edges too. Turn the focus ring until the subject edges light up.')}</span>
      </div>
      <label className={`${style.row} ${style.divider}`}>
        <span className={style.label}>{t('Magnifier')}</span>
        <Switch checked={!!magnifier?.ENABLED} onChange={() => onChange({ MAGNIFIER: { ...magnifier, ENABLED: !magnifier?.ENABLED } })} />
      </label>
      <div className={style.row}>
        <span className={style.sub}>{t('Zoom')}</span>
        <div className={style.swatches}>
          {MAGNIFIER_ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              className={`${style.zoom} ${(magnifier?.ZOOM || 4) === z ? style.zoomActive : ''}`}
              aria-pressed={(magnifier?.ZOOM || 4) === z}
              onClick={() => onChange({ MAGNIFIER: { ...magnifier, ZOOM: z } })}
            >
              {z}×
            </button>
          ))}
        </div>
      </div>
      <span className={style.hint}>{t('A floating close-up of part of the live view. Move the box on the picture to choose where to look.')}</span>
      <label className={`${style.row} ${style.divider}`}>
        <span className={style.label}>{t('Histogram')}</span>
        <Switch checked={!!histogram?.ENABLED} onChange={() => onChange({ HISTOGRAM: { ...histogram, ENABLED: !histogram?.ENABLED } })} />
      </label>
      <span className={style.hint}>{t('Red, green and blue levels of the live view, with how much of the picture is crushed to black or clipped.')}</span>
      <label className={`${style.row} ${style.divider}`}>
        <span className={style.label}>{t('RGB parade')}</span>
        <Switch checked={!!parade?.ENABLED} onChange={() => onChange({ PARADE: { ...parade, ENABLED: !parade?.ENABLED } })} />
      </label>
      <span className={style.hint}>{t('Red, green and blue waveforms side by side: left to right follows the picture, height is brightness. Use it to match colour balance between views.')}</span>
    </div>
  );
};

export default withTranslation()(LiveAssistControls);
