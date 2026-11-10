import { useRef } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Drag the reference over the live view to line it up; the wheel scales it around the middle.
// x and y are halves of the picture, which is what the layer's transform uses.
const ReferenceAlignLayer = ({ t, reference = null, width = 0, height = 0, onChange = () => {}, onCommit = () => {}, onDone = () => {} }) => {
  const drag = useRef(null);
  const settle = useRef(null);
  if (!reference) return null;

  const move = (event) => {
    if (!drag.current) return;
    const { x, y, px, py } = drag.current;
    onChange({
      x: clamp(x + ((event.clientX - px) * 2) / Math.max(1, width), -1, 1),
      y: clamp(y + ((event.clientY - py) * 2) / Math.max(1, height), -1, 1),
    });
  };

  const end = (event) => {
    if (drag.current) onCommit();
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <div
      className={style.layer}
      onPointerDown={(event) => {
        drag.current = { x: reference.x, y: reference.y, px: event.clientX, py: event.clientY };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onWheel={(event) => {
        onChange({ scale: clamp(reference.scale * (event.deltaY < 0 ? 1.03 : 1 / 1.03), 0.1, 4) });
        clearTimeout(settle.current);
        settle.current = setTimeout(onCommit, 300);
      }}
      onDoubleClick={() => {
        onChange({ x: 0, y: 0, scale: 1 });
        onCommit();
      }}
    >
      <span className={style.hint}>
        {t('Aligning {{name}} — drag to move, wheel to size, double-click to reset', { name: reference.name || t('reference') })}
        <button type="button" className={style.done} onPointerDown={(event) => event.stopPropagation()} onClick={onDone}>
          {t('Done')}
        </button>
      </span>
    </div>
  );
};

export default withTranslation()(ReferenceAlignLayer);
