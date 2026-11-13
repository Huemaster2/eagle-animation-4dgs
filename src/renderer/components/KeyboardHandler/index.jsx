import SHORTCUTS from '@core/shortcuts';
import { useEffect, useState } from 'react';
import KeyboardEventHandler from 'react-keyboard-event-handler';

const FIELDS = 'input, select, textarea, [contenteditable="true"]';

const KeyboardHandler = ({ onAction = null, disabled = false }) => {
  // Keys typed into a field are text, not shortcuts: without this, naming a scene would take pictures
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const check = () => setTyping(!!document.activeElement?.matches?.(FIELDS));
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    check();
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
    };
  }, []);

  const handleAction = (action) => () => {
    if (onAction) {
      onAction(action);
    }
  };

  return (
    <>
      {Object.keys(SHORTCUTS).map((action) => (
        <KeyboardEventHandler key={`KEY-${action}`} handleKeys={SHORTCUTS[action]} onKeyEvent={handleAction(action)} handleFocusableElements disabled={disabled || typing} />
      ))}
    </>
  );
};

export default KeyboardHandler;
