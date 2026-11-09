import CustomSlider from '@components/CustomSlider';
import { turntable } from '@core/turntable';
import { createAngleFollower } from '@core/turntableFollow';
import { angleOf } from '@core/turntableMath';
import { useRef, useState } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const follower = createAngleFollower(turntable);

// 0–360° slider; the table follows while you drag and stops on the last angle
const TurntableAngleSlider = ({ t, state, onError = () => {} }) => {
  const [dragging, setDragging] = useState(null);
  const endTimer = useRef(null);
  const enabled = state.connected && !state.jogging;
  const current = angleOf(state.position ?? 0, state.stepsPerRev);
  const value = dragging ?? Math.round(current * 10) / 10;

  const handleChange = (deg) => {
    clearTimeout(endTimer.current);
    setDragging(deg);
    follower.setTarget(deg).catch((err) => onError(err.message));
  };

  return (
    <div className={style.wrap}>
      <div className={style.scale}>
        {[0, 90, 180, 270, 360].map((d) => (
          <span key={d}>{d}°</span>
        ))}
      </div>
      <CustomSlider
        min={0}
        max={360}
        step={0.5}
        value={value}
        maxWidth="100%"
        disabled={!enabled}
        onChange={enabled ? handleChange : () => {}}
        onChangeComplete={() => {
          endTimer.current = setTimeout(() => setDragging(null), 400);
        }}
      />
      <span className={style.readout}>
        {t('Table at {{angle}}', { angle: `${current.toFixed(1)}°` })}
        {dragging !== null && Math.abs(dragging - current) > 0.2 && ` → ${dragging.toFixed(1)}°`}
      </span>
    </div>
  );
};

export default withTranslation()(TurntableAngleSlider);
