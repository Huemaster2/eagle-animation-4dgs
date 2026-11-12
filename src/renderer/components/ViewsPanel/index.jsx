import FloatingPanel from '@components/FloatingPanel';
import LiveAssistControls from '@components/LiveAssistControls';
import Switch from '@components/Switch';
import TurntableQuickControls from '@components/TurntableQuickControls';
import { normalizeReference, sequenceNameFromFiles, sortSequenceFiles } from '@core/referenceSequence';
import { PERSPECTIVES } from '@core/turntableMath';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import faChevronLeft from '@icons/faChevronLeft';
import { useEffect, useRef, useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const ALL = 'ALL';
const EXPOSURE_LABELS = { shutter_speed: 'Shutter', aperture: 'Aperture', iso: 'ISO' };
const TABS = ['views', 'exposure', 'turntable', 'live'];

// Floating live controls: views and their references, turntable, focus peaking. Nothing here fires the shutter.
const ViewsPanel = ({
  t,
  layout = {},
  active = null,
  status = '',
  busy = false,
  reviewing = false,
  calibrated = {},
  references = [],
  importProgress = null,
  onSelect = () => {},
  onTurn = null,
  onImport = () => {},
  onUpdateReference = () => {},
  aligning = null,
  onAlign = () => {},
  onLayoutChange = () => {},
  onClose = () => {},
  focusPeaking,
  histogram,
  parade,
  magnifier,
  exposure = [],
  exposureAvailable = false,
  exposureBusy = false,
  onExposureChange = () => {},
  onExposureRefresh = () => {},
  onSettingsChange = () => {},
  onGo = null,
  referencePosition = 0,
}) => {
  const input = useRef(null);
  const importFor = useRef(ALL);
  const [tab, setTab] = useState(TABS.includes(layout.TAB) ? layout.TAB : 'views');
  const chooseTab = (next) => {
    setTab(next);
    onLayoutChange({ TAB: next });
  };

  // The camera's dials are only known once it is awake, so read them when this tab comes up
  const refresh = useRef(onExposureRefresh);
  refresh.current = onExposureRefresh;
  useEffect(() => {
    if (tab === 'exposure') refresh.current();
  }, [tab]);

  const handleFiles = (event) => {
    const files = sortSequenceFiles(Array.from(event.target.files || []));
    event.target.value = '';
    if (files.length) {
      onImport(files, sequenceNameFromFiles(files), importFor.current === ALL ? null : importFor.current);
    }
  };

  const pickFolder = (view) => {
    if (importProgress) return;
    importFor.current = view;
    input.current?.click();
  };

  const viewButton = (view) => (
    <button
      key={view}
      type="button"
      className={`${style.view} ${style[`pos${view}`]} ${active === view ? style.active : ''} ${calibrated[view] ? '' : style.uncalibrated}`}
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
  );

  const groups = [...PERSPECTIVES, ALL].map((view) => ({
    view,
    refs: references.map(normalizeReference).filter((r) => (view === ALL ? !r.perspective : r.perspective === view)),
  }));

  return (
    <FloatingPanel title={t('Live controls')} layout={layout} defaults={{ W: 320, H: 460, Y: 80 }} minWidth={240} minHeight={220} onLayoutChange={onLayoutChange} onClose={onClose}>
      <div className={style.tabs} role="tablist">
        {[['views', t('Views')], ...(exposureAvailable ? [['exposure', t('Exposure')]] : []), ['turntable', t('Turntable')], ['live', t('Focus')]].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`${style.tab} ${tab === key ? style.tabActive : ''}`} onClick={() => chooseTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'exposure' && (
        <div className={style.body}>
          {exposure.map((cap) => {
            const values = cap.values || [];
            const at = values.findIndex((v) => `${v.value}` === `${cap.value}`);
            const step = (delta) => {
              const next = values[at + delta];
              if (next) onExposureChange(cap.id, next.value);
            };
            return (
              <div key={cap.id} className={style.exposureRow}>
                <span className={style.exposureLabel}>{EXPOSURE_LABELS[cap.id] ? t(EXPOSURE_LABELS[cap.id]) : cap.id}</span>
                <button type="button" className={style.step} title={t('One step down the camera list')} disabled={exposureBusy || at <= 0} onClick={() => step(-1)}>
                  <FontAwesomeIcon icon={faChevronLeft} />
                </button>
                <span className={style.exposureValue}>{at >= 0 ? values[at].label : '–'}</span>
                <button type="button" className={style.step} title={t('One step up the camera list')} disabled={exposureBusy || at < 0 || at >= values.length - 1} onClick={() => step(1)}>
                  <FontAwesomeIcon icon={faChevronLeft} className={style.flip} />
                </button>
              </div>
            );
          })}
          {!exposure.length && <p className={style.status}>{t('No dials reported yet — the camera has to be connected and awake.')}</p>}
          <p className={style.status}>{t('Set on the camera over USB. Its own dials stay locked while the app holds it, so change exposure here.')}</p>
          <p className={style.status}>{t('Shutter and aperture need the mode dial on M.')}</p>
          <button type="button" className={style.small} disabled={exposureBusy} onClick={onExposureRefresh}>
            {t('Read from the camera')}
          </button>
        </div>
      )}

      {tab === 'turntable' && (
        <div className={style.body}>
          <TurntableQuickControls activeView={active} onGo={onGo} />
        </div>
      )}

      {tab === 'live' && (
        <div className={style.body}>
          <LiveAssistControls focusPeaking={focusPeaking} histogram={histogram} parade={parade} magnifier={magnifier} onChange={onSettingsChange} />
        </div>
      )}

      {tab === 'views' && (
        <div className={style.body}>
          <div className={style.cross}>
            {PERSPECTIVES.map(viewButton)}
            <button
              type="button"
              className={`${style.view} ${style.posALL} ${active === null ? style.active : ''}`}
              disabled={busy}
              aria-pressed={active === null}
              title={t('Show references for all views')}
              onClick={() => onSelect(null)}
            >
              {t('ALL')}
            </button>
          </div>
          {onTurn && (
            <p className={style.status}>
              <button type="button" className={style.small} disabled={busy} onClick={onTurn}>
                {t('Turn table here')}
              </button>
            </p>
          )}
          {active && !calibrated[active] && (
            <p className={style.status}>
              {t('{{view}} is not set yet. Its references show on the picture: open the Turntable tab to line the table up with them and set it.', { view: t(active) })}{' '}
              <button type="button" className={style.small} onClick={() => chooseTab('turntable')}>
                {t('Turntable tab')}
              </button>
            </p>
          )}
          <p className={`${style.status} ${busy ? style.moving : ''}`}>
            {reviewing
              ? active
                ? t('Timeline and playback from {{view}}', { view: t(active) })
                : t('Timeline and playback as captured')
              : active
                ? t('Showing {{view}}', { view: t(active) })
                : t('Showing all views')}
          </p>
          {status && <p className={`${style.status} ${busy ? style.moving : ''}`}>{status}</p>}

          <input ref={input} type="file" className={style.hidden} onChange={handleFiles} {...{ webkitdirectory: '', directory: '' }} />
          {importProgress && <p className={style.status}>{t('Importing {{done}} / {{total}} frames…', importProgress)}</p>}

          {groups.map(({ view, refs }) => (
            <section key={view} className={`${style.group} ${active === view || (view === ALL && active === null) ? style.groupActive : ''}`}>
              <div className={style.groupHead}>
                <span className={style.groupTitle}>{view === ALL ? t('All views') : t(view)}</span>
                <button type="button" className={style.small} disabled={!!importProgress} onClick={() => pickFolder(view)}>
                  {t('Import folder…')}
                </button>
              </div>
              {refs.length === 0 && <p className={style.empty}>{t('No reference sequence')}</p>}
              {refs.map((ref) => (
                <div key={ref.id}>
                  <label className={style.ref}>
                    <span className={style.refName} title={ref.name}>
                      {ref.name}
                    </span>
                    <span className={style.refCount}>{ref.frames.length}</span>
                    <Switch checked={ref.enabled} onChange={() => onUpdateReference(ref.id, { enabled: !ref.enabled })} />
                  </label>
                  {ref.enabled && (
                    <div className={style.refTools}>
                      <span className={style.refToolLabel}>{t('Fade')}</span>
                      <input
                        type="range"
                        className={style.refRange}
                        min="0"
                        max="1"
                        step="0.01"
                        value={ref.opacity}
                        aria-label={t('Reference opacity')}
                        onChange={(event) => onUpdateReference(ref.id, { opacity: Number(event.target.value) })}
                      />
                      <span className={style.refToolValue}>{Math.round(ref.opacity * 100)}%</span>
                      <button type="button" className={`${style.small} ${aligning === ref.id ? style.smallActive : ''}`} onClick={() => onAlign(aligning === ref.id ? null : ref.id)}>
                        {aligning === ref.id ? t('Done') : t('Align')}
                      </button>
                      <button type="button" className={style.small} onClick={() => onUpdateReference(ref.id, { x: 0, y: 0, scale: 1 })}>
                        {t('Reset')}
                      </button>
                    </div>
                  )}
                  {ref.enabled && (
                    <div className={style.refTools}>
                      <button
                        type="button"
                        className={`${style.small} ${ref.mirror ? style.smallActive : ''}`}
                        title={t('Flips the reference left to right')}
                        onClick={() => onUpdateReference(ref.id, { mirror: !ref.mirror })}
                      >
                        {t('Mirror')}
                      </button>
                      <span className={style.refToolLabel}>{t('Starts at')}</span>
                      <input
                        type="number"
                        className={style.refNumber}
                        min={1}
                        max={ref.frames.length}
                        step={1}
                        value={ref.offset + 1}
                        aria-label={t('Reference frame shown beside the first frame of the timeline')}
                        onChange={(event) => {
                          const frame = Math.round(Number(event.target.value));
                          if (Number.isFinite(frame)) onUpdateReference(ref.id, { offset: Math.min(ref.frames.length, Math.max(1, frame)) - 1 });
                        }}
                      />
                      <span className={style.refToolValue}>/ {ref.frames.length}</span>
                      <button
                        type="button"
                        className={style.small}
                        title={t('Makes the reference frame on screen now the one beside the first frame of the timeline')}
                        disabled={referencePosition + ref.offset < 0 || referencePosition + ref.offset >= ref.frames.length}
                        onClick={() => onUpdateReference(ref.id, { offset: referencePosition + ref.offset })}
                      >
                        {t('Start here')}
                      </button>
                      <button type="button" className={style.small} disabled={ref.offset === 0} onClick={() => onUpdateReference(ref.id, { offset: 0 })}>
                        {t('From the top')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </FloatingPanel>
  );
};

export default withTranslation()(ViewsPanel);
