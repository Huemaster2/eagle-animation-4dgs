import { getPictureLink } from '@core/resize';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import faPlay from '@icons/faPlay';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

// A whole turn is 0°, not 360°: the last step of a turn lands a hundredth of a degree short
const fmt = (deg) => `${(Math.round(deg * 10) / 10) % 360}°`;

// One timeline per calibrated view: each row holds every frame's photo taken at that angle.
// Rows scroll together; clicking a photo shows that frame from that view.
const ViewTimelines = ({ t, rows = [], active = null, current = false, onPick = () => {}, onPlay = () => {} }) => {
  if (!rows.length) return null;

  return (
    <div className={style.box} aria-label={t('View timelines')}>
      <p className={style.head}>
        <span className={style.headName}>{t('Timelines by view')}</span>
        <span className={style.headHint}>{t('Every frame at that angle. Click a photo to show that frame from that view, or ▸ to play the row.')}</span>
      </p>
      <div className={style.scroll}>
        {rows.map((row) => (
          <div key={row.view} className={`${style.row} ${active === row.view ? style.rowActive : ''}`}>
            <div className={style.label}>
              <button type="button" className={style.play} title={t('Play the {{view}} timeline', { view: t(row.view) })} onClick={() => onPlay(row.view)}>
                <FontAwesomeIcon icon={faPlay} />
              </button>
              <button type="button" className={style.name} aria-pressed={active === row.view} onClick={() => onPick(false, row.view)}>
                {t(row.view)}
              </button>
              <span className={style.angle}>{fmt(row.angle)}</span>
            </div>
            <div className={style.thumbs}>
              {row.frames.map((frame, index) => (
                <button
                  key={frame.id}
                  type="button"
                  className={`${style.thumb} ${frame.id === current ? style.thumbCurrent : ''} ${frame.own || frame.off ? style.thumbOwn : ''}`}
                  title={
                    frame.own
                      ? t('Frame {{n}} has no full turn — showing the frame as captured', { n: index + 1 })
                      : frame.off
                        ? t('Frame {{n}} has no photo at this view: nearest is {{angle}}', { n: index + 1, angle: fmt(frame.angle) })
                        : t('Frame {{n}} at {{angle}}', { n: index + 1, angle: fmt(frame.angle) })
                  }
                  onClick={() => onPick(frame.id, row.view)}
                >
                  {frame.link ? <img alt="" className={style.img} src={getPictureLink(frame.link, { w: 72, h: 72, m: 'cover', f: 'jpg' })} loading="lazy" /> : <span className={style.empty} />}
                  <span className={style.number}>{index + 1}</span>
                  {frame.off && <span className={style.offMark}>{fmt(frame.angle)}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default withTranslation()(ViewTimelines);
