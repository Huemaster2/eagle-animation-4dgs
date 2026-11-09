import { Link as ReactLink } from 'react-router-dom';

import * as style from './style.module.css';

const Action = ({ onClick = false, target = '_blank', className = '', ...props }) => {
  const dest = onClick;
  const actionType = dest && typeof dest;

  if (actionType === 'function') {
    // Exposed as a real button so keyboard users and accessibility tools can press it
    const onKeyDown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dest(e);
      }
    };
    return <span role="button" tabIndex={0} className={`${style.action} ${className}`} onClick={dest} onKeyDown={onKeyDown} {...props} />;
  }

  if (actionType === 'string' && dest[0] === '/') {
    return <ReactLink className={`${style.action} ${className}`} to={dest} {...props} />;
  }

  if (actionType === 'string' && /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,25})+$/.test(dest)) {
    return <a className={`${style.action} ${className}`} href={`mailto:${dest}`} rel="noopener noreferrer" {...props} />;
  }

  if (actionType === 'string' && dest[0] === '#') {
    return <a className={`${style.action} ${className}`} href={dest} {...props} />;
  }

  if (actionType === 'string' && dest[0] !== '/') {
    return <a className={`${style.action} ${className}`} href={dest} rel="noopener noreferrer" {...(target ? { target } : {})} {...props} />;
  }

  return <span className={`${style.action} ${style.noaction} ${className}`} {...props} />;
};

export default Action;
