import * as style from './style.module.css';

// One-line message above the controls (capture problems, turntable warnings); click to dismiss
const NoticeBanner = ({ message = '', tone = 'error', onDismiss = () => {} }) =>
  message ? (
    <button type="button" className={`${style.banner} ${style[tone] || ''}`} onClick={onDismiss} title={message}>
      {message}
    </button>
  ) : null;

export default NoticeBanner;
