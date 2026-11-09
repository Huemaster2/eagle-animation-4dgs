import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import faChevronDown from '@icons/faChevronDown';
import faXmark from '@icons/faXmark';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const TITLE_H = 22;
// Last-clicked floating window comes to the front
let topLayer = 0;

const clampRect = ({ x, y, w, h }, minW, minH) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(minW, w), vw);
  const height = Math.min(Math.max(minH, h), vh);
  return { x: Math.min(Math.max(0, x), vw - width), y: Math.min(Math.max(0, y), vh - TITLE_H), w: width, h: height };
};

// Floating window that stays over the live view: drag by the title bar, resize from the corner,
// collapse to its title bar (System 7 window shade). Layout is reported as { X, Y, W, H, COLLAPSED }.
const FloatingPanel = ({ t, title = '', layout = {}, defaults = {}, minWidth = 200, minHeight = 120, onLayoutChange = () => {}, onClose = () => {}, children }) => {
  const [rect, setRect] = useState(() =>
    clampRect(
      {
        x: layout.X ?? defaults.X ?? window.innerWidth - (layout.W || defaults.W || 300) - 24,
        y: layout.Y ?? defaults.Y ?? 80,
        w: layout.W || defaults.W || 300,
        h: layout.H || defaults.H || 300,
      },
      minWidth,
      minHeight
    )
  );
  const [collapsed, setCollapsed] = useState(!!layout.COLLAPSED);
  const [layer, setLayer] = useState(() => ++topLayer);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const root = useRef(null);

  useEffect(() => {
    const onResize = () => setRect((r) => clampRect(r, minWidth, minHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [minWidth, minHeight]);

  const track = (event, apply) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = { px: event.clientX, py: event.clientY, ...rectRef.current };
    const move = (e) => setRect(clampRect(apply(start, e.clientX - start.px, e.clientY - start.py), minWidth, minHeight));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const r = rectRef.current;
      onLayoutChange({ X: Math.round(r.x), Y: Math.round(r.y), W: Math.round(r.w), H: Math.round(r.h) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    onLayoutChange({ COLLAPSED: !collapsed });
  };

  // Clicked controls give focus back, so Space/Enter keep meaning "take picture" and never press a panel button
  const releaseFocus = () =>
    setTimeout(() => {
      if (root.current?.contains(document.activeElement)) document.activeElement.blur();
    }, 0);

  return createPortal(
    <div
      ref={root}
      className={`${style.panel} ${collapsed ? style.collapsed : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: collapsed ? undefined : rect.h, zIndex: 990000 + layer }}
      role="dialog"
      aria-label={title}
      onPointerUp={releaseFocus}
      onPointerDownCapture={() => layer !== topLayer && setLayer(++topLayer)}
    >
      <div
        className={style.titleBar}
        onPointerDown={(event) => !event.target.closest('button') && track(event, (s, dx, dy) => ({ ...s, x: s.x + dx, y: s.y + dy }))}
        onDoubleClick={(event) => !event.target.closest('button') && toggleCollapsed()}
      >
        <button type="button" aria-label={t('Close')} title={t('Close')} className={style.box} onClick={onClose}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
        <span className={style.stripes} />
        <span className={style.title}>{title}</span>
        <span className={style.stripes} />
        <button
          type="button"
          aria-label={collapsed ? t('Expand') : t('Collapse')}
          title={collapsed ? t('Expand') : t('Collapse')}
          aria-expanded={!collapsed}
          className={`${style.box} ${collapsed ? style.flip : ''}`}
          onClick={toggleCollapsed}
        >
          <FontAwesomeIcon icon={faChevronDown} />
        </button>
      </div>
      {!collapsed && (
        <>
          <div className={style.content}>{children}</div>
          <span className={style.grow} onPointerDown={(event) => track(event, (s, dx, dy) => ({ ...s, w: s.w + dx, h: s.h + dy }))} aria-hidden="true" />
        </>
      )}
    </div>,
    document.body
  );
};

export default withTranslation()(FloatingPanel);
