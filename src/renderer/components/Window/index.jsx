import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import faXmark from '@icons/faXmark';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import * as style from './style.module.css';

// tone picks the window's fill from the colour kit (yellow, mint, lime, lavender, peach); title sits in the stripes
const Window = ({ children, onClose = () => {}, isOpened = false, isFullScreen = false, zIndex = 0, title = '', tone = '' }) => {
  const ref = useRef();
  const mouseDownTarget = useRef();

  const getWindowRootFromEventTarget = (target) => {
    if (!(target instanceof Element)) return null;
    return target.closest('[data-window-root="true"]');
  };

  useLayoutEffect(() => {
    document.body.style.overflow = isOpened ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpened]);

  return createPortal(
    <div
      style={{ zIndex: 999999 + zIndex }}
      className={`${style.bgd} ${isOpened ? style.opened : ''}`}
      onMouseUp={(event) => {
        const clickedWindowRoot = getWindowRootFromEventTarget(event.target);
        if (clickedWindowRoot && clickedWindowRoot !== ref.current) return;

        if (mouseDownTarget.current && !ref.current.contains(mouseDownTarget.current) && !ref.current.contains(event.target)) {
          onClose(event);
          event.stopPropagation();
        }
      }}
      onMouseDown={(event) => {
        mouseDownTarget.current = event.target;
      }}
    >
      <div className={`${style.window} ${isFullScreen ? style.fullscreen : ''}`} style={tone ? { '--pf-window-fill': `var(--pf-fill-${tone})` } : undefined} ref={ref} data-window-root="true">
        <div className={style.titleBar}>
          <button
            type="button"
            aria-label="Close"
            className={style.close}
            onClick={(event) => {
              event.stopPropagation();
              onClose(event);
            }}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
          <span className={style.stripes} />
          {title && <span className={style.title}>{title}</span>}
          {title && <span className={style.stripes} />}
        </div>
        <div className={style.content}>{children}</div>
      </div>
    </div>,
    document.body
  );
};

export default Window;
