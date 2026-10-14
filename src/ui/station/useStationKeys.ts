import { useEffect } from 'react';
import { flightRuntime } from '../../app/flightBinding';
import type { ProxKey } from '../../station/proximitySession';

/** Keyboard RCS: W/S forward/back, A/D left/right, R/F up/down, arrows pitch/yaw, Q/E roll. */
export const PROX_KEYS: Record<string, ProxKey> = {
  w: 'forward',
  s: 'back',
  a: 'left',
  d: 'right',
  r: 'up',
  f: 'down',
  ArrowUp: 'pitch-down',
  ArrowDown: 'pitch-up',
  ArrowLeft: 'yaw-left',
  ArrowRight: 'yaw-right',
  q: 'roll-left',
  e: 'roll-right',
};

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
}

export function useStationKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const keyOf = (e: KeyboardEvent) => PROX_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = keyOf(e);
      if (!k) return;
      e.preventDefault();
      flightRuntime.setProxKey(k, true);
    };
    const up = (e: KeyboardEvent) => {
      const k = keyOf(e);
      if (k) flightRuntime.setProxKey(k, false);
    };
    const blur = () => Object.values(PROX_KEYS).forEach((k) => flightRuntime.setProxKey(k, false));
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
