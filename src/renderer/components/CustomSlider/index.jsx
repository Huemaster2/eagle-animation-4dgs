import Slider from 'rc-slider';
import { cloneElement } from 'react';

import 'rc-slider/assets/index.css';

const HANDLE_SIZE = 24;
const HANDLE_RADIUS = HANDLE_SIZE / 2;

// rc-slider centers the handle on the value, so at the extremes it overflows
// the rail by its radius. We inset the handle so its edges never exceed the
// rail: at min the left edge aligns with the rail start, at max the right edge
// aligns with the rail end.
const makeHandleRenderer =
  (min, max) =>
  (origin, { value }) => {
    const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
    const percent = ratio * 100;
    const offset = HANDLE_RADIUS - ratio * HANDLE_SIZE;

    return cloneElement(origin, {
      style: {
        ...origin.props.style,
        left: `calc(${percent}% + ${offset}px)`,
      },
    });
  };

const CustomSlider = ({ step, min, max, value, disabled = false, maxWidth = null, onChange = () => {}, ...rest }) => (
  <Slider
    keyboard={false}
    {...rest}
    step={step}
    min={min}
    max={max}
    value={value}
    handleRender={makeHandleRenderer(min, max)}
    style={{ maxWidth: maxWidth || '500px', padding: '0', height: '10px', ...(disabled ? { cursor: 'not-allowed', opacity: '0.2' } : {}) }}
    styles={{
      track: {
        backgroundColor: 'var(--pf-line)',
        height: '10px',
      },
      rail: {
        backgroundColor: 'var(--color-theme-light)',
        height: '10px',
      },
      handle: {
        backgroundColor: 'var(--color-theme-dark)',
        border: '2px solid var(--pf-line)',
        borderRadius: 'var(--border-radius-small)',
        height: `${HANDLE_SIZE}px`,
        width: `${HANDLE_SIZE}px`,
        marginLeft: `-${HANDLE_RADIUS}px`,
        marginTop: '-7px',
        boxShadow: 'none',
        opacity: '1',
        transform: 'none',
        ...(disabled ? { cursor: 'not-allowed' } : {}),
      },
    }}
    onChange={onChange}
  />
);

export default CustomSlider;
