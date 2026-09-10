import { useEffect } from 'react';

let locks = 0;
let restore;

export default function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) return;
    if (locks++ === 0) {
      const body = document.body;
      const previous = body.getAttribute('style');
      const x = window.scrollX;
      const y = window.scrollY;
      Object.assign(body.style, {
        position: 'fixed', top: `-${y}px`, left: `-${x}px`,
        width: '100%', overflow: 'hidden',
      });
      restore = () => {
        if (previous === null) body.removeAttribute('style');
        else body.setAttribute('style', previous);
        window.scrollTo(x, y);
      };
    }
    return () => {
      if (--locks === 0) restore();
    };
  }, [active]);
}
