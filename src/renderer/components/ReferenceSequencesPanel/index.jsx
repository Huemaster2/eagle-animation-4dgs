import ActionCard from '@components/ActionCard';
import CustomSlider from '@components/CustomSlider';
import Select from '@components/Select';
import Switch from '@components/Switch';
import { ONION_BLEND_MODES } from '@core/onionSkin';
import { getReferenceFrame, normalizeReference, sequenceNameFromFiles, sortSequenceFiles } from '@core/referenceSequence';
import { PERSPECTIVES } from '@core/turntableMath';
import { useRef } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const ReferenceSequencesPanel = ({ t, references = [], animationPosition = 0, importProgress = null, onImport = () => {}, onUpdate = () => {}, onDelete = () => {} }) => {
  const folderInput = useRef(null);
  const filesInput = useRef(null);

  const blendLabels = {
    normal: t('Normal'),
    difference: t('Difference'),
    multiply: t('Multiply'),
    screen: t('Screen'),
    lighten: t('Lighten'),
    darken: t('Darken'),
  };
  const blendOptions = ONION_BLEND_MODES.map((m) => ({ value: m, label: blendLabels[m] }));

  const handleFiles = (event) => {
    const files = sortSequenceFiles(Array.from(event.target.files || []));
    event.target.value = '';
    if (files.length) {
      onImport(files, sequenceNameFromFiles(files));
    }
  };

  const slider = (label, value, min, max, step, onChange, format) => (
    <div className={style.row}>
      <span className={style.subLabel}>{label}</span>
      <div className={style.sliderWrap}>
        <CustomSlider step={step} min={min} max={max} value={value} maxWidth="200px" onChange={onChange} />
        <span className={style.value}>{format(value)}</span>
      </div>
    </div>
  );

  return (
    <div className={style.section}>
      <div className={style.row}>
        <span className={style.label}>{t('Reference sequences')}</span>
      </div>
      <p className={style.hint}>
        {t('Import an image sequence (for example live-action reference exported as frames). It plays in sync with your animation: frame 1 of the animation shows reference frame 1 + offset.')}
      </p>

      <input ref={folderInput} type="file" className={style.hidden} onChange={handleFiles} {...{ webkitdirectory: '', directory: '' }} />
      <input ref={filesInput} type="file" className={style.hidden} accept="image/*" multiple onChange={handleFiles} />
      <div className={style.buttons}>
        <ActionCard sizeAuto disabled={!!importProgress} title={t('Import folder')} onClick={importProgress ? () => {} : () => folderInput.current?.click()} />
        <ActionCard sizeAuto secondary disabled={!!importProgress} title={t('Import images')} onClick={importProgress ? () => {} : () => filesInput.current?.click()} />
      </div>
      {importProgress && <p className={style.progress}>{t('Importing {{done}} / {{total}} frames…', importProgress)}</p>}

      {references.map((raw) => {
        const ref = normalizeReference(raw);
        const current = getReferenceFrame(ref, animationPosition);
        return (
          <div key={ref.id} className={style.card}>
            <div className={style.row}>
              <span className={style.label}>{ref.name}</span>
              <Switch checked={ref.enabled} onChange={() => onUpdate(ref.id, { enabled: !ref.enabled })} />
            </div>
            <p className={style.hint}>
              {current
                ? t('{{count}} frames · showing frame {{n}}', { count: ref.frames.length, n: current.index + 1 })
                : t('{{count}} frames · no reference frame at this position', { count: ref.frames.length })}
            </p>
            {slider(
              t('Opacity'),
              ref.opacity,
              0,
              1,
              0.01,
              (v) => onUpdate(ref.id, { opacity: v }),
              (v) => `${Math.round(v * 100)}%`
            )}
            <div className={style.row}>
              <span className={style.subLabel}>{t('Offset (frames)')}</span>
              <div className={style.inline}>
                <button type="button" className={style.step} onClick={() => onUpdate(ref.id, { offset: ref.offset - 1 })}>
                  −
                </button>
                <input
                  type="number"
                  className={style.number}
                  value={ref.offset}
                  onChange={(e) => onUpdate(ref.id, { offset: Math.round(Number(e.target.value) || 0) })}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <button type="button" className={style.step} onClick={() => onUpdate(ref.id, { offset: ref.offset + 1 })}>
                  +
                </button>
              </div>
            </div>
            {slider(
              t('Scale'),
              ref.scale,
              0.1,
              4,
              0.01,
              (v) => onUpdate(ref.id, { scale: v }),
              (v) => `${Math.round(v * 100)}%`
            )}
            {slider(
              t('Position X'),
              ref.x,
              -1,
              1,
              0.01,
              (v) => onUpdate(ref.id, { x: v }),
              (v) => `${Math.round(v * 100)}`
            )}
            {slider(
              t('Position Y'),
              ref.y,
              -1,
              1,
              0.01,
              (v) => onUpdate(ref.id, { y: v }),
              (v) => `${Math.round(v * 100)}`
            )}
            <div className={style.row}>
              <span className={style.subLabel}>{t('Blend mode')}</span>
              <Select options={blendOptions} value={ref.blendMode} onChange={(e) => onUpdate(ref.id, { blendMode: e.target.value })} />
            </div>
            <div className={style.row}>
              <span className={style.subLabel}>{t('Show for view')}</span>
              <Select
                options={[{ value: '', label: t('All views') }, ...PERSPECTIVES.map((p) => ({ value: p, label: t(p) }))]}
                value={raw.perspective || ''}
                onChange={(e) => onUpdate(ref.id, { perspective: e.target.value || null })}
              />
            </div>
            <div className={style.buttons}>
              <ActionCard sizeAuto secondary title={t('Reset position')} onClick={() => onUpdate(ref.id, { x: 0, y: 0, scale: 1 })} />
              <ActionCard sizeAuto secondary title={t('Remove')} onClick={() => onDelete(ref.id)} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default withTranslation()(ReferenceSequencesPanel);
