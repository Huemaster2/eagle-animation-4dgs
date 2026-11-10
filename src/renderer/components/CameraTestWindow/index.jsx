import ActionCard from '@components/ActionCard';
import Heading from '@components/Heading';
import Select from '@components/Select';
import { getStopMoCameraStatus, stopmoCapture, stopmoFetch, stopmoReleaseToBody } from '@core/stopmoCamera';
import { useEffect, useRef, useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const SAVE_OPTIONS = [
  { value: 'both', label: 'Card and Mac (two copies)' },
  { value: 'mac', label: 'Mac only (nothing written to the card)' },
  { value: 'card', label: 'Card only (Mac keeps just the preview)' },
];

const QUALITY_OPTIONS = [
  { value: '0', label: 'RAW (CR2) only' },
  { value: '1', label: 'RAW + Large Fine JPEG' },
  { value: '2', label: 'Large Fine JPEG only' },
];

const mb = (bytes) => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;
const yes = (v) => (v === true ? '✓' : v === false ? '✗' : '–');

// A capture only counts as good when every file is complete, signed and decodable at full size.
// Card-only files never cross USB, so they are judged on their header and full-size preview instead.
const fileIsGood = (f) =>
  f.onCard ? f.signatureOK && f.structureOK !== false && (f.kind !== 'CR2' || (f.width || 0) >= 5000) : f.sizeMatches && f.signatureOK && f.structureOK !== false && (f.width || 0) >= 5000;

const CameraTestWindow = ({ t, isOpened = false, settings = null, onSettingsChange = () => {}, onTakeControl = null }) => {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState('');
  const [folderMissing, setFolderMissing] = useState(false);
  const stopRepeat = useRef(false);
  const saveTarget = settings?.STOPMO_SAVE_TARGET || 'both';
  const storageFolder = settings?.STOPMO_STORAGE_FOLDER || '';

  useEffect(() => {
    if (!isOpened || !storageFolder) {
      setFolderMissing(false);
      return;
    }
    window
      .EA('STOPMO_FOLDER_STATUS', { folder: storageFolder })
      .then((r) => setFolderMissing(!r?.usable))
      .catch(() => setFolderMissing(true));
  }, [isOpened, storageFolder]);

  const chooseFolder = async () => {
    const folder = await window.EA('STOPMO_SELECT_FOLDER', { title: t('Folder for camera originals') }).catch(() => null);
    if (folder) onSettingsChange({ STOPMO_STORAGE_FOLDER: folder });
  };

  useEffect(() => {
    if (!isOpened) return undefined;
    let alive = true;
    const poll = async () => {
      const s = await getStopMoCameraStatus().catch(() => null);
      if (alive) setStatus(s);
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isOpened]);

  const shootOnce = async () => {
    const { dir, baseName } = await window.EA('STOPMO_CAMERA_NEXT_TEST_NAME', { storage_folder: storageFolder });
    setMessage(saveTarget === 'card' ? t('Shutter fired — checking the file on the card…') : t('Shutter fired — waiting for {{name}}…', { name: baseName }));
    const r = await stopmoCapture({ rawDir: dir, baseName, saveTarget }).catch((err) => ({ ok: false, error: err.message, files: [], seconds: 0 }));
    const good = r.ok && r.files.length > 0 && r.files.every(fileIsGood);
    for (const f of r.files.length ? r.files : [{}]) {
      await window.EA('STOPMO_CAMERA_LOG_TEST', {
        ok: good,
        file: f,
        seconds: r.seconds?.toFixed?.(2),
        error: r.error || (good ? '' : 'verification failed'),
        storage_folder: storageFolder,
      });
    }
    setResults((prev) => [{ at: new Date(), ok: good, error: r.error, files: r.files, seconds: r.seconds }, ...prev].slice(0, 50));
    return good;
  };

  const runTest = async (count) => {
    setBusy(true);
    stopRepeat.current = false;
    let passed = 0;
    for (let i = 0; i < count && !stopRepeat.current; i++) {
      if (await shootOnce()) passed += 1;
    }
    setMessage(t('{{passed}} of {{count}} captures verified', { passed, count }));
    setBusy(false);
  };

  const handOver = async () => {
    setBusy(true);
    setMessage(t('Handing the camera back…'));
    const ok = await stopmoReleaseToBody();
    setMessage(ok ? t('The camera has its dials back. Live view is off until you take control again.') : t('The camera did not let go.'));
    setBusy(false);
  };

  const takeBack = async () => {
    if (!onTakeControl) return;
    setBusy(true);
    setMessage(t('Taking control again…'));
    await onTakeControl().catch(() => null);
    setMessage(t('Live view is back.'));
    setBusy(false);
  };

  const setQuality = async (value) => {
    setBusy(true);
    await stopmoFetch('/cameras/canon-eos-ptp/parameters', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image_quality', value }),
    }).catch(() => null);
    setBusy(false);
  };

  const connected = !!status?.ready;
  const lastFile = results[0]?.files?.[0];

  return (
    <div className={style.container}>
      <Heading h={1}>{t('Canon camera')}</Heading>

      <div className={style.statusRow}>
        <span className={`${style.dot} ${connected ? style.ok : style.bad}`} />
        <span className={style.statusText}>
          {!status?.helperRunning && t('Camera helper not running')}
          {status?.helperRunning && !connected && t('No camera — plug in the 5D Mark II, switch it on, close Dragonframe / EOS Utility')}
          {connected && `${status.model || 'Canon'} · ${t('firmware')} ${status.firmware || '?'}`}
        </span>
      </div>
      {connected && (
        <p className={style.hint}>
          {t('Recording')}: <b>{status.quality || '?'}</b>
          {status.exposure ? ' · ' : ''}
          {status.exposure ? <b>{status.exposure}</b> : null} · {t('Live view')}: {status.liveView ? `${status.fps || 0} fps` : t('off')}
          {status.settingsRaw && Object.keys(status.settingsRaw).length > 0 && (
            <>
              {' · '}
              {t('Camera codes')}:{' '}
              {Object.entries(status.settingsRaw)
                .map(([k, v]) => `${k} ${v}`)
                .join(', ')}
            </>
          )}
        </p>
      )}
      {connected && status.focus === 'AF' && <p className={style.warning}>{t('Lens is on AF. The 5D Mark II will not fire if autofocus cannot lock — switch the lens to MF for stop motion.')}</p>}
      {status?.lastError && <p className={style.error}>{status.lastError}</p>}

      {connected && (
        <>
          <div className={style.row}>
            <span className={style.label}>{t('Camera dials')}</span>
            <span className={style.path}>{status.bodyLocked ? t('Held by the app — the body shows "busy"') : t('Free — set what you like on the camera')}</span>
            {status.bodyLocked ? (
              <ActionCard sizeAuto secondary disabled={busy} title={t('Hand back to the camera')} onClick={handOver} />
            ) : (
              <ActionCard sizeAuto secondary disabled={busy || !onTakeControl} title={t('Take control again')} onClick={takeBack} />
            )}
          </div>
          <p className={style.hint}>
            {status.bodyLocked
              ? t(
                  'A Canon locks its own dials while a computer holds it, as it does for EOS Utility. Set shutter, aperture and ISO from the camera settings window, or hand the camera back for a moment.'
                )
              : t('Live view is off while the camera is free. Take control again when you are ready to shoot.')}
          </p>
        </>
      )}

      <div className={style.row}>
        <span className={style.label}>{t('Image quality (set on the camera over USB)')}</span>
        <Select options={QUALITY_OPTIONS} value={status?.qualityId !== undefined ? String(status.qualityId) : ''} disabled={!connected || busy} onChange={(e) => setQuality(e.target.value)} />
      </div>

      <div className={style.row}>
        <span className={style.label}>{t('Save photos to')}</span>
        <Select options={SAVE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} value={saveTarget} disabled={busy} onChange={(e) => onSettingsChange({ STOPMO_SAVE_TARGET: e.target.value })} />
      </div>
      {saveTarget === 'card' && (
        <p className={style.hint}>
          {t('Originals stay on the card only. The Mac keeps the full-size preview for the timeline, and the files are checked on the card after every shot. Copy the card before formatting it.')}
        </p>
      )}

      <div className={style.row}>
        <span className={style.label}>{t('Folder for originals')}</span>
        <span className={style.path} title={storageFolder}>
          {storageFolder || t('Inside each project (raw folder) · tests in Pictures/StopMo')}
        </span>
        <ActionCard sizeAuto secondary title={t('Change…')} onClick={chooseFolder} />
        {storageFolder && <ActionCard sizeAuto secondary title={t('Use project folder')} onClick={() => onSettingsChange({ STOPMO_STORAGE_FOLDER: '' })} />}
      </div>
      {folderMissing && <p className={style.error}>{t('This folder is not available (drive unplugged?). Captures will stop with an error rather than save somewhere else.')}</p>}
      {saveTarget === 'card' && storageFolder && <p className={style.hint}>{t('Card only is selected, so this folder is not used until you switch back.')}</p>}

      <div className={style.buttons}>
        <ActionCard sizeAuto disabled={!connected || busy} title={busy ? t('Capturing…') : t('TEST SHUTTER')} onClick={!connected || busy ? () => {} : () => runTest(1)} />
        <ActionCard sizeAuto secondary disabled={!connected || busy} title={t('Reliability test ×5')} onClick={!connected || busy ? () => {} : () => runTest(5)} />
        {busy && <ActionCard sizeAuto secondary title={t('Stop after this shot')} onClick={() => (stopRepeat.current = true)} />}
        <ActionCard
          sizeAuto
          secondary
          title={t('Show Camera_Test folder')}
          onClick={async () =>
            window.EA('STOPMO_SHOW_PATH', { path: lastFile?.path && !lastFile.onCard ? lastFile.path : (await window.EA('STOPMO_CAMERA_NEXT_TEST_NAME', { storage_folder: storageFolder }))?.dir })
          }
        />
      </div>
      {message && <p className={style.hint}>{message}</p>}

      <table className={style.table}>
        <thead>
          <tr>
            <th>{t('Result')}</th>
            <th>{t('File')}</th>
            <th>{t('Size')}</th>
            <th>{t('Complete')}</th>
            <th>{t('CR2/JPEG signature')}</th>
            <th>{t('Structure')}</th>
            <th>{t('Decoded')}</th>
            <th>{t('Time')}</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) =>
            (r.files.length ? r.files : [null]).map((f, j) => (
              <tr key={`${i}-${j}`} className={r.ok ? style.okRow : style.badRow}>
                <td>{j === 0 ? (r.ok ? t('PASS') : t('FAIL')) : ''}</td>
                <td>{f ? `${f.path.split('/').pop()}${f.onCard ? ` (${t('on card')})` : ''}` : r.error}</td>
                <td>{f ? mb(f.size) : ''}</td>
                <td>{f ? (f.onCard ? t('on card') : yes(f.sizeMatches)) : ''}</td>
                <td>{f ? `${yes(f.signatureOK)} ${f.kind}` : ''}</td>
                <td>{f ? yes(f.structureOK) : ''}</td>
                <td>{f?.width ? `${f.width}×${f.height}` : f ? '✗' : ''}</td>
                <td>{j === 0 ? `${Number(r.seconds || 0).toFixed(1)} s` : ''}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <p className={style.hint}>
        {t('Test files: {{folder}}/Test_NNN.CR2 — existing files are never overwritten. Every attempt is logged in capture_log.csv.', {
          folder: storageFolder ? `${storageFolder}/Camera_Test` : 'Pictures/StopMo/Camera_Test',
        })}
      </p>
    </div>
  );
};

export default withTranslation()(CameraTestWindow);
