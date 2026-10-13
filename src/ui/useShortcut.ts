import { useEffect, useRef } from 'react';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable)
  );
}

/** Global keyboard shortcut, ignored while typing in a form field or with modifier keys held. */
export function useShortcut(keys: readonly string[], handler: () => void, enabled = true): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const keyList = keys.join('|');
  useEffect(() => {
    if (!enabled) return;
    const list = keyList.split('|');
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (!list.includes(e.key)) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyList, enabled]);
}
