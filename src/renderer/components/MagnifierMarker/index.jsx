import { clampCenter, magnifierCrop } from '@core/magnifier';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

// Box on the live view showing what the magnifier sees; drag it to move the loupe
const MagnifierMarker = ({ t, srcW, srcH, center, zoom, aspect, reverseX = false, reverseY = false, onMove = () => {}, onCommit = () => {} }) => {
  if (!srcW || !srcH) return null;
  const { sx, sy, sw, sh } = magnifierCrop({ srcW, srcH, cx: center.cx, cy: center.cy, zoom, aspect });
  // The live view may be mirrored on screen, the crop is in picture coordinates
  const left = reverseX ? 1 - (sx + sw) / srcW : sx / srcW;
  const top = reverseY ? 1 - (sy + sh) / srcH : sy / srcH;

  const startDrag = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.parentNode.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, ...center };
    let latest = { cx: center.cx, cy: center.cy };
    const move = (e) => {
      const dx = ((e.clientX - start.x) / box.width) * (reverseX ? -1 : 1);
      const dy = ((e.clientY - start.y) / box.height) * (reverseY ? -1 : 1);
      latest = clampCenter({ srcW, srcH, cx: start.cx + dx, cy: start.cy + dy, zoom, aspect });
      onMove(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCommit(latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={style.layer}>
      <div
        className={style.marker}
        title={t('Magnifier area: drag to move')}
        style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${(sw / srcW) * 100}%`, height: `${(sh / srcH) * 100}%` }}
        onPointerDown={startDrag}
      />
    </div>
  );
};

export default withTranslation()(MagnifierMarker);
