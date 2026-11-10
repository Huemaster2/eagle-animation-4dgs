import { getPictureLink } from '@core/resize';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import faXmark from '@icons/faXmark';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const fileTitle = (shot) => (shot.files || []).map((f) => (f.onCard ? `${f.path} (on card)` : f.path)).join('\n');

// Every photo of one frame's rotation, one row per camera height; clicking a photo shows it full size
const SequenceStrip = ({ t, frame = null, frameNumber = 0, selected = null, onPreview = () => {}, onClose = () => {} }) => {
  const sequence = frame?.sequence;
  if (!sequence?.shots?.length) return null;
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
      <div className={style.rows}>
        {heights.map((h) => (
          <div key={h} className={style.row}>
            <span className={style.rowLabel}>
              H{h}
              {h === sequence.heroHeight ? '★' : ''}
            </span>
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
                    <span className={style.angle}>{Math.round(shot.offset ?? shot.angle)}°</span>
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
