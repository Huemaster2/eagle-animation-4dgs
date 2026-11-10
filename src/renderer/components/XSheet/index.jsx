import FloatingPanel from '@components/FloatingPanel';
import { pruneSelection, selectionClick, selectionStep } from '@core/frameSelection';
import { getPictureLink } from '@core/resize';
import { useEffect, useRef, useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '');

// Exposure-sheet view of the scene: one row per frame with its exposure range, hold, rotation and note.
// Selection follows desktop rules (click, Cmd/Ctrl-click, Shift-click, arrows, Cmd/Ctrl+A); the toolbar acts on it.
const XSheet = ({
  t,
  layout = {},
  pictures = [],
  projectTitle = '',
  sceneNumber = 1,
  fps = 12,
  current = false,
  selected = [],
  anchor = null,
  replacing = [],
  onSelectionChange = () => {},
  onShowFrame = () => {},
  onDelete = () => {},
  onReplaceWithCapture = () => {},
  onReplaceWithFile = () => {},
  onCancelReplace = () => {},
  onNote = () => {},
  onLayoutChange = () => {},
  onClose = () => {},
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [focus, setFocus] = useState(null);
  const list = useRef(null);
  const fileInput = useRef(null);
  const order = pictures.map((p) => p.id);
  const sel = pruneSelection(order, selected);
  const selectedSet = new Set(sel);
  const replacingSet = new Set(replacing);

  // Exposure numbers count holds: a frame held for 3 takes three exposure rows' worth of numbers
  let exposure = 1;
  const rows = pictures.map((p, i) => {
    const length = p.length || 1;
    const row = { picture: p, index: i, from: exposure, to: exposure + length - 1, length };
    if (!p.hidden) exposure += length;
    return row;
  });
  const endFrame = exposure - 1;

  useEffect(() => setConfirmDelete(false), [sel.join(',')]);

  // Keep the shown frame in view while scrubbing or playing
  useEffect(() => {
    if (current === false || !list.current) return;
    list.current.querySelector(`[data-frame-id="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  // Latest selection, so quick successive clicks build on each other before the next render
  const latest = useRef({ selected: sel, anchor });
  latest.current = { selected: sel, anchor };
  const select = (next, show = null) => {
    latest.current = { selected: next.selected, anchor: next.anchor };
    onSelectionChange(next.selected, next.anchor);
    if (show !== null) onShowFrame(show);
  };

  const handleRowClick = (event, id) => {
    const toggle = event.metaKey || event.ctrlKey;
    const next = selectionClick({ order, ...latest.current }, id, { shift: event.shiftKey, toggle });
    setFocus(id);
    select(next, event.shiftKey || toggle ? null : id);
  };

  const handleKeyDown = (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      select({ selected: order, anchor: order[0] ?? null });
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const next = selectionStep({ order, selected: sel, anchor, focus: focus ?? sel[sel.length - 1] ?? null }, event.key === 'ArrowDown' ? 1 : -1, { shift: event.shiftKey });
      setFocus(next.focus);
      select(next, next.focus);
      list.current?.querySelector(`[data-frame-id="${next.focus}"]`)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && sel.length) {
      event.preventDefault();
      event.stopPropagation();
      setConfirmDelete(true);
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (confirmDelete) setConfirmDelete(false);
      else select({ selected: [], anchor: null });
    }
  };

  const numberOf = (id) => order.indexOf(id) + 1;
  const selectionLabel = sel.length === 0 ? t('No frames selected') : sel.length === 1 ? t('Frame {{n}} selected', { n: numberOf(sel[0]) }) : t('{{n}} frames selected', { n: sel.length });

  return (
    <FloatingPanel title={t('X-sheet')} layout={layout} defaults={{ X: null, Y: 70, W: 430, H: 620 }} minWidth={300} minHeight={220} keepFocus onLayoutChange={onLayoutChange} onClose={onClose}>
      <div className={style.sheet} onKeyDown={handleKeyDown}>
        <div className={style.header}>
          <div className={style.cell}>
            <span className={style.caption}>{t('PRODUCTION')}</span>
            <span className={style.value}>{projectTitle || t('Untitled')}</span>
          </div>
          <div className={style.cell}>
            <span className={style.caption}>{t('SCENE')}</span>
            <span className={style.value}>{`${sceneNumber}`.padStart(3, '0')}</span>
          </div>
          <div className={style.cell}>
            <span className={style.caption}>{t('FRAMES')}</span>
            <span className={style.value}>{endFrame ? `1 – ${endFrame}` : '–'}</span>
          </div>
          <div className={style.cell}>
            <span className={style.caption}>{t('FPS')}</span>
            <span className={style.value}>{fps}</span>
          </div>
        </div>

        <div className={style.toolbar}>
          <span className={style.count}>{selectionLabel}</span>
          {confirmDelete ? (
            <>
              <span className={style.warn}>{t('Delete {{n}}?', { n: sel.length === 1 ? t('frame {{n}}', { n: numberOf(sel[0]) }) : t('{{n}} frames', { n: sel.length }) })}</span>
              <button type="button" className={`${style.button} ${style.danger}`} onClick={() => onDelete(sel)} autoFocus>
                {t('Delete')}
              </button>
              <button type="button" className={style.button} onClick={() => setConfirmDelete(false)}>
                {t('Cancel')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={style.button} disabled={!sel.length} title={t('Delete the selected frames (Delete key). Undo brings them back.')} onClick={() => setConfirmDelete(true)}>
                {t('Delete')}
              </button>
              <button
                type="button"
                className={style.button}
                disabled={!sel.length}
                title={t('The next capture replaces the selected frame; with several selected, each capture replaces the next one in order')}
                onClick={() => onReplaceWithCapture(sel)}
              >
                {t('Replace with capture')}
              </button>
              <button type="button" className={style.button} disabled={sel.length !== 1} title={t('Replace the selected frame with an image file')} onClick={() => fileInput.current?.click()}>
                {t('Replace from file…')}
              </button>
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className={style.hidden}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file && sel.length === 1) onReplaceWithFile(sel[0], file);
            }}
          />
        </div>

        {replacing.length > 0 && (
          <div className={style.replaceBar}>
            <span>
              {t('Next capture replaces frame {{n}}', { n: numberOf(replacing[0]) })}
              {replacing.length > 1 ? ` (${t('{{n}} to go', { n: replacing.length })})` : ''}
            </span>
            <button type="button" className={style.button} onClick={onCancelReplace}>
              {t('Cancel replace')}
            </button>
          </div>
        )}

        <div className={style.columns}>
          <span className={style.colFrm}>{t('FRM')}</span>
          <span className={style.colThumb} />
          <span className={style.colExp}>{t('EXPOSURES')}</span>
          <span className={style.colNotes}>{t('NOTES')}</span>
        </div>
        <div className={style.rows} ref={list} tabIndex={0} role="listbox" aria-multiselectable="true" aria-label={t('Frames')}>
          {rows.map(({ picture, index, from, to, length }) => {
            const isSelected = selectedSet.has(picture.id);
            const tags = [
              length > 1 ? `×${length}` : null,
              picture.hidden ? t('hidden') : null,
              picture.masking ? t('mask') : null,
              picture.sequence?.shots?.length ? `⟳${picture.sequence.shots.length}` : null,
              picture.replaced?.length ? t('replaced') : null,
            ].filter(Boolean);
            return (
              <div
                key={picture.id}
                data-frame-id={picture.id}
                role="option"
                aria-selected={isSelected}
                className={`${style.row} ${isSelected ? style.selected : ''} ${current === picture.id ? style.current : ''} ${replacingSet.has(picture.id) ? style.replacing : ''} ${picture.hidden ? style.hiddenFrame : ''} ${(index + 1) % 8 === 0 ? style.eighth : ''}`}
                onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                onClick={(e) => {
                  list.current?.focus({ preventScroll: true });
                  handleRowClick(e, picture.id);
                }}
              >
                <span className={style.colFrm}>{picture.hidden ? '–' : from === to ? from : `${from}–${to}`}</span>
                <span className={style.colThumb}>{picture.link && <img alt="" src={getPictureLink(picture.link, { w: 64, h: 40, m: 'cover', f: 'jpg' })} loading="lazy" />}</span>
                <span className={style.colExp}>
                  <span className={style.mark}>{picture.hidden ? '·' : 'X'}</span>
                  {tags.join(' ')}
                </span>
                <input
                  className={style.colNotes}
                  value={picture.note || ''}
                  placeholder=""
                  aria-label={t('Note for frame {{n}}', { n: index + 1 })}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onNote(picture.id, e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                  }}
                />
              </div>
            );
          })}
          {!rows.length && <p className={style.empty}>{t('No frames yet')}</p>}
        </div>
        <p className={style.hint}>
          {isMac
            ? t('Click, ⌘-click to add or remove, Shift-click for a range, ⌘A for all, ↑↓ to move.')
            : t('Click, Ctrl-click to add or remove, Shift-click for a range, Ctrl+A for all, ↑↓ to move.')}
        </p>
      </div>
    </FloatingPanel>
  );
};

export default withTranslation()(XSheet);
