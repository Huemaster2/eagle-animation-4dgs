import flyImage from './assets/fly.png';
import WordmarkSVG from './assets/wordmark.svg?jsx';

import * as style from './style.module.css';

// The pixel photo fly (transparent background) with the PHILIP FRAME wordmark; ICON is the fly alone
const Logo = ({ type = 'logo', className = '', onClick = null }) => {
  const classNames = `${style.logo} ${className}`.trim();

  if (type === 'LOGO') {
    return (
      <div className={`${classNames} ${style.full}`} onClick={onClick}>
        <img className={style.fly} src={flyImage} alt="" draggable={false} />
        <WordmarkSVG className={style.wordmark} />
      </div>
    );
  }

  if (type === 'ICON') {
    return (
      <div className={classNames} onClick={onClick}>
        <img className={style.fly} src={flyImage} alt="Philip Frame" draggable={false} />
      </div>
    );
  }

  return null;
};

export default Logo;
