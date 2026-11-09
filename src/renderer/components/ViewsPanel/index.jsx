import FloatingPanel from '@components/FloatingPanel';
import LiveAssistControls from '@components/LiveAssistControls';
import Switch from '@components/Switch';
import TurntableQuickControls from '@components/TurntableQuickControls';
import { normalizeReference, sequenceNameFromFiles, sortSequenceFiles } from '@core/referenceSequence';
import { PERSPECTIVES } from '@core/turntableMath';
import { useRef, useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const ALL = 'ALL';
const TABS = ['views', 'turntable', 'live'];

// Floating live controls: views and their references, turntable, focus peaking. Nothing here fires the shutter.
const ViewsPanel = ({
  t,
  layout = {},
  active = null,
  status = '',
  busy = false,
  calibrated = {},
  references = [],
  importProgress = null,
  onSelect = () => {},
  onImport = () => {},
  onUpdateReference = () => {},
  onLayoutChange = () => {},
  onClose = () => {},
  focusPeaking,
  histogram,
  magnifier,
  onSettingsChange = () => {},
}) => {
  const input = useRef(null);
  const importFor = useRef(ALL);
  const [tab, setTab] = useState(TABS.includes(layout.TAB) ? layout.TAB : 'views');
  const chooseTab = (next) => {
    setTab(next);
    onLayoutChange({ TAB: next });
  };

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
      title={calibrated[view] ? t('Turn to {{view}} and show its references', { view: t(view) }) : t('{{view}}: references only (not calibrated on the turntable)', { view: t(view) })}
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
        {[
          ['views', t('Views')],
          ['turntable', t('Turntable')],
          ['live', t('Focus')],
        ].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`${style.tab} ${tab === key ? style.tabActive : ''}`} onClick={() => chooseTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'turntable' && (
        <div className={style.body}>
          <TurntableQuickControls activeView={active} />
        </div>
      )}

      {tab === 'live' && (
        <div className={style.body}>
          <LiveAssistControls focusPeaking={focusPeaking} histogram={histogram} magnifier={magnifier} onChange={onSettingsChange} />
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
          {active && !calibrated[active] && (
            <p className={style.status}>
              {t('{{view}} is not set yet. Its references show on the picture: open the Turntable tab to line the table up with them and set it.', { view: t(active) })}{' '}
              <button type="button" className={style.small} onClick={() => chooseTab('turntable')}>
                {t('Turntable tab')}
              </button>
            </p>
          )}
          <p className={`${style.status} ${busy ? style.moving : ''}`}>{status || (active ? t('Showing {{view}}', { view: t(active) }) : t('Showing all views'))}</p>

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
                <label key={ref.id} className={style.ref}>
                  <span className={style.refName} title={ref.name}>
                    {ref.name}
                  </span>
                  <span className={style.refCount}>{ref.frames.length}</span>
                  <Switch checked={ref.enabled} onChange={() => onUpdateReference(ref.id, { enabled: !ref.enabled })} />
                </label>
              ))}
            </section>
          ))}
        </div>
      )}
    </FloatingPanel>
  );
};

export default withTranslation()(ViewsPanel);
