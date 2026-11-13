import { getPictureLink } from '@core/resize';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import faXmark from '@icons/faXmark';
import { useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const fileTitle = (shot) => (shot.files || []).map((f) => (f.onCard ? `${f.path} (on card)` : f.path)).join('\n');

// Every photo of one frame's rotation, one row per camera height; clicking a photo shows it full size
const SequenceStrip = ({
  t,
  frame = null,
  frameNumber = 0,
  selected = null,
  canReshoot = false,
  views = [],
  picks = {},
  onPick = null,
  onPreview = () => {},
  onReshootHeight = null,
  onClose = () => {},
}) => {
  const [everyFrame, setEveryFrame] = useState(false);
  const sequence = frame?.sequence;
  if (!sequence?.shots?.length) return null;
  const selectedShot = selected ? sequence.shots.find((s) => s.filename === selected) || null : null;
  const standsFor = (shot) => views.filter((view) => picks[view] && picks[view].height === shot.height && picks[view].index === shot.index);
  const heights = [...new Set(sequence.shots.map((s) => s.height))].sort((a, b) => a - b);
  const expected = (sequence.shotsPerPass || 0) * (sequence.heights || 0);
  const where = sequence.saveTarget === 'card' ? t('originals on the camera card') : sequence.saveTarget === 'both' ? t('originals on the Mac and the card') : t('originals on the Mac');

  return (
    <div className={style.strip} aria-label={t('Rotation photos')}>
      <div className={style.head}>
        <span className={style.title}>
          {t('Frame #{{n}} — {{count}} photos', { n: frameNumber, count: sequence.shots.length })}
          {!sequence.complete && expected ? ` (${t('stopped early, {{n}} planned', { n: expected })})` : ''}
        </span>
        <span className={style.meta}>
          {sequence.saveTarget !== 'card' && sequence.folder ? `${sequence.folder} · ` : ''}
          {where}
        </span>
        {selected && (
          <button type="button" className={style.button} onClick={() => onPreview(null)}>
            {t('Back to timeline photo')}
          </button>
        )}
        <button type="button" className={style.close} aria-label={t('Close')} title={t('Close')} onClick={onClose}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
      {onPick && views.length > 0 && (
        <div className={style.pickBar}>
          {selectedShot ? (
            <>
              <span>{t('Show this photo in the timeline for')}</span>
              {views.map((view) => {
                const isPick = picks[view]?.picked && picks[view].height === selectedShot.height && picks[view].index === selectedShot.index;
                return (
                  <button
                    key={view}
                    type="button"
                    className={`${style.button} ${isPick ? style.buttonOn : ''}`}
                    title={
                      isPick
                        ? t('Picked for {{view}}: click to go back to the photo nearest the motor angle', { view: t(view) })
                        : t('Use this photo whenever the timeline shows {{view}}', { view: t(view) })
                    }
                    onClick={() => onPick(view, isPick ? null : selectedShot, isPick ? picks[view].picked === 'all' : everyFrame)}
                  >
                    {t(view)}
                  </button>
                );
              })}
              <label className={style.pickScope}>
                <input type="checkbox" checked={everyFrame} onChange={() => setEveryFrame(!everyFrame)} />
                {t('in every frame (same height and photo number)')}
              </label>
            </>
          ) : (
            <span>{t('Click a photo, then choose which view it stands for in the timeline.')}</span>
          )}
        </div>
      )}
      <div className={style.rows}>
        {heights.map((h) => (
          <div key={h} className={style.row}>
            <span className={style.rowLabel}>
              H{h}
              {h === sequence.heroHeight ? '★' : ''}
            </span>
            {onReshootHeight && (
              <button
                type="button"
                className={style.reshoot}
                disabled={!canReshoot}
                title={canReshoot ? t('Shoot height {{h}} again: the same angles, replacing these photos', { h }) : t('Connect the turntable to shoot a height again')}
                onClick={() => onReshootHeight(h)}
              >
                {t('Re-shoot')}
              </button>
            )}
            {sequence.shots
              .filter((s) => s.height === h)
              .sort((a, b) => a.index - b.index)
              .map((shot) => {
                const isSelected = selected === shot.filename;
                return (
                  <button
                    key={`${shot.height}-${shot.index}-${shot.filename}`}
                    type="button"
                    className={`${style.shot} ${isSelected ? style.shotSelected : ''}`}
                    title={`${t('Height {{h}}, photo {{n}}, {{deg}}°', { h: shot.height, n: shot.index + 1, deg: Math.round(shot.offset ?? shot.angle) })}\n${fileTitle(shot)}`}
                    onClick={() => onPreview(isSelected ? null : shot.filename)}
                  >
                    {shot.link && <img alt="" src={getPictureLink(shot.link, { w: 96, h: 64, m: 'cover', f: 'jpg' })} loading="lazy" />}
                    <span className={style.angle}>{Math.round((shot.offset ?? shot.angle) % 360)}°</span>
                    {standsFor(shot).length > 0 && (
                      <span className={style.viewMark}>
                        {standsFor(shot)
                          .map((view) => t(view))
                          .join(' · ')}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default withTranslation()(SequenceStrip);
