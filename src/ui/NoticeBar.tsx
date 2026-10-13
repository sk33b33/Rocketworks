import { useEffect } from 'react';
import { useGameStore } from '../app/gameStore';

const ICONS = { info: 'ℹ', success: '✓', warning: '⚠' } as const;

/** Shows the result of the last action, including rejected ones (never fail silently). */
export function NoticeBar() {
  const notice = useGameStore((s) => s.notice);
  const dismiss = useGameStore((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, notice.tone === 'warning' ? 8000 : 4500);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div
      className={`notice notice-${notice.tone}`}
      role={notice.tone === 'warning' ? 'alert' : 'status'}
    >
      <span className="notice-icon" aria-hidden="true">
        {ICONS[notice.tone]}
      </span>
      <span>{notice.text}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss notice">
        ✕
      </button>
    </div>
  );
}
