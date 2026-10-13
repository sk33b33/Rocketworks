import { useEffect, useSyncExternalStore } from 'react';
import { flightRuntime } from '../../app/flightBinding';
import type { FlightSnapshot, ManualKey } from '../../flight/flightRuntime';

/** Throttled flight snapshot (≤10 updates/s), safe for React rendering. */
export function useFlightSnapshot(): FlightSnapshot {
  return useSyncExternalStore(flightRuntime.subscribe, flightRuntime.getSnapshot);
}

const HELD_KEYS: Record<string, ManualKey> = {
  w: 'pitch-up',
  s: 'pitch-down',
  q: 'bank-left',
  e: 'bank-right',
  Shift: 'throttle-up',
  Control: 'throttle-down',
};

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

/** Held manual-control keys (pitch, bank, throttle) forwarded to the runtime while flying. */
export function useFlightKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const keyOf = (e: KeyboardEvent) => HELD_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = keyOf(e);
      if (!k) return;
      e.preventDefault();
      flightRuntime.setKey(k, true);
    };
    const up = (e: KeyboardEvent) => {
      const k = keyOf(e);
      if (k) flightRuntime.setKey(k, false);
    };
    const blur = () => {
      for (const k of Object.values(HELD_KEYS)) flightRuntime.setKey(k, false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      blur();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [enabled]);
}

export const fmt = (n: number, d = 0) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
    : '∞';

export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
