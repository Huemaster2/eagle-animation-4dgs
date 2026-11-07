import ActionCard from '@components/ActionCard';
import CustomSlider from '@components/CustomSlider';
import Heading from '@components/Heading';
import Select from '@components/Select';
import Switch from '@components/Switch';
import { normalizeOnionSkin, ONION_BLEND_MODES, ONION_MAX_FRAMES } from '@core/onionSkin';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const OnionSkinWindow = ({
  t,
  config = {},
  onChange = () => {},
  selectedFrameNumber = false,
  referenceFrameNumber = null,
  onPinReference = () => {},
  onClearReference = () => {},
  children = null,
}) => {
  const c = normalizeOnionSkin(config);
  const update = (patch) => onChange({ ...c, ...patch });
  const setOpacity = (key, index, value) => {
    const list = [...c[key]];
    list[index] = value;
    update({ [key]: list });
  };

  const countOptions = Array.from({ length: ONION_MAX_FRAMES + 1 }, (_, i) => ({ value: String(i), label: String(i) }));
  const blendLabels = {
    normal: t('Normal'),
    difference: t('Difference'),
    multiply: t('Multiply'),
    screen: t('Screen'),
    lighten: t('Lighten'),
    darken: t('Darken'),
  };
  const blendOptions = ONION_BLEND_MODES.map((m) => ({ value: m, label: blendLabels[m] }));

  const renderGhosts = (countKey, opacitiesKey, colorKey, title, labelFn) => (
    <div className={style.section}>
      <div className={style.row}>
        <span className={style.label}>{title}</span>
        <div className={style.inline}>
          <input type="color" className={style.color} value={c[colorKey]} title={t('Tint colour')} onChange={(e) => update({ [colorKey]: e.target.value })} />
          <Select options={countOptions} value={String(c[countKey])} onChange={(e) => update({ [countKey]: Number(e.target.value) })} />
        </div>
      </div>
      {Array.from({ length: c[countKey] }, (_, i) => (
        <div className={style.row} key={i}>
          <span className={style.subLabel}>{labelFn(i + 1)}</span>
          <div className={style.sliderWrap}>
            <CustomSlider step={0.01} min={0} max={1} value={c[opacitiesKey][i]} maxWidth="200px" onChange={(v) => setOpacity(opacitiesKey, i, v)} />
            <span className={style.value}>{Math.round(c[opacitiesKey][i] * 100)}%</span>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className={style.actions}>
      <Heading h={1} className={style.title}>
        {t('Onion skin')}
      </Heading>

      <div className={style.row}>
        <span className={style.label}>{t('Enable onion skin')}</span>
        <Switch checked={c.ENABLED} onChange={() => update({ ENABLED: !c.ENABLED })} />
      </div>
      <p className={style.hint}>{t('The onion slider in the toolbar sets the overall strength. Next frames appear while you browse captured frames.')}</p>

      <div className={c.ENABLED ? '' : style.disabled}>
        {renderGhosts('PREVIOUS_COUNT', 'PREVIOUS_OPACITIES', 'PREVIOUS_COLOR', t('Previous frames'), (n) => t('Frame -{{n}}', { n }))}
        {renderGhosts('NEXT_COUNT', 'NEXT_OPACITIES', 'NEXT_COLOR', t('Next frames'), (n) => t('Frame +{{n}}', { n }))}

        <div className={style.section}>
          <div className={style.row}>
            <span className={style.label}>{t('Tint strength')}</span>
            <div className={style.sliderWrap}>
              <CustomSlider step={0.01} min={0} max={1} value={c.TINT_STRENGTH} maxWidth="200px" onChange={(v) => update({ TINT_STRENGTH: v })} />
              <span className={style.value}>{Math.round(c.TINT_STRENGTH * 100)}%</span>
            </div>
          </div>
          <div className={style.row}>
            <span className={style.label}>{t('Blend mode')}</span>
            <Select options={blendOptions} value={c.BLEND_MODE} onChange={(e) => update({ BLEND_MODE: e.target.value })} />
          </div>
        </div>

        <div className={style.section}>
          <div className={style.row}>
            <span className={style.label}>{t('Reference frame')}</span>
            <span className={style.subLabel}>{referenceFrameNumber ? t('Frame {{n}} pinned', { n: referenceFrameNumber }) : t('None')}</span>
          </div>
          <p className={style.hint}>{t('Pin a frame to compare it against the live view or any other frame.')}</p>
          <div className={style.buttons}>
            <ActionCard
              sizeAuto
              disabled={selectedFrameNumber === false}
              title={selectedFrameNumber === false ? t('Select a frame to pin it') : t('Pin frame {{n}}', { n: selectedFrameNumber })}
              onClick={selectedFrameNumber === false ? () => {} : onPinReference}
            />
            {referenceFrameNumber && <ActionCard sizeAuto secondary title={t('Clear')} onClick={onClearReference} />}
          </div>
          <div className={style.row}>
            <span className={style.subLabel}>{t('Opacity')}</span>
            <div className={style.sliderWrap}>
              <CustomSlider step={0.01} min={0} max={1} value={c.REFERENCE_OPACITY} maxWidth="200px" onChange={(v) => update({ REFERENCE_OPACITY: v })} />
              <span className={style.value}>{Math.round(c.REFERENCE_OPACITY * 100)}%</span>
            </div>
          </div>
          <div className={style.row}>
            <span className={style.subLabel}>{t('Blend mode')}</span>
            <Select options={blendOptions} value={c.REFERENCE_BLEND_MODE} onChange={(e) => update({ REFERENCE_BLEND_MODE: e.target.value })} />
          </div>
        </div>
      </div>

      {children}
    </div>
  );
};

export default withTranslation()(OnionSkinWindow);
