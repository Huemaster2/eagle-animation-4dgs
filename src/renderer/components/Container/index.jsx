import { useLayoutEffect } from 'react';
import { withTranslation } from 'react-i18next';

import * as style from './style.module.css';

const Container = ({ children, t }) => {
  useLayoutEffect(() => {
    document.title = t('Philip Frame');
  }, [t]);

  return <div className={style.container}>{children}</div>;
};

export default withTranslation()(Container);
