import { useEffect } from 'react';
import { useGameStore } from '../app/gameStore';

/** Shows rejected actions (e.g. locked navigation) instead of failing silently. */
export function NoticeBar() {
  const notice = useGameStore((s) => s.notice);
  const dismiss = useGameStore((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div className="notice" role="alert">
      <span className="notice-icon" aria-hidden="true">
        ⚠
      </span>
      <span>{notice}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss notice">
        ✕
      </button>
    </div>
  );
}
