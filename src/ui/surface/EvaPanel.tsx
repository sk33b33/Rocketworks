import { useEffect } from 'react';
import { flightRuntime } from '../../app/flightBinding';
import type { EvaKey, FlightSnapshot } from '../../flight/flightRuntime';
import { bearingTo, EVA_LOW_O2, EVA_RULES, nearestOpen, type EvaState } from '../../surface/eva';

const KEYS: Record<string, EvaKey> = {
  w: 'forward',
  s: 'back',
  a: 'left',
  d: 'right',
  e: 'collect',
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** Held EVA keys (W/S walk, A/D turn, E collect; arrows too) forwarded to the runtime. */
function useEvaKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const keyOf = (e: KeyboardEvent) => KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = keyOf(e);
      if (!k) return;
      e.preventDefault();
      flightRuntime.setEvaKey(k, true);
    };
    const up = (e: KeyboardEvent) => {
      const k = keyOf(e);
      if (k) flightRuntime.setEvaKey(k, false);
    };
    const release = () => {
      for (const k of new Set(Object.values(KEYS))) flightRuntime.setEvaKey(k, false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      release();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, [enabled]);
}

/** A touch-friendly button that holds an EVA control while pressed. */
function HoldButton({ k, label, title }: { k: EvaKey; label: string; title: string }) {
  const set = (down: boolean) => flightRuntime.setEvaKey(k, down);
  return (
    <button
      type="button"
      className="eva-hold"
      title={title}
      aria-label={title}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
    >
      {label}
    </button>
  );
}

const mmss = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** Surface EVA: send an astronaut out, guide them to the samples and back aboard. */
export function EvaPanel({ snap }: { snap: FlightSnapshot }) {
  const eva = snap.eva;
  useEvaKeys(!!eva);
  const done = snap.progress.eva;
  const body = snap.mars ? 'mars' : 'moon';
  const total = done?.total ?? EVA_RULES[body].samples;
  if (!eva) {
    const check = flightRuntime.evaAvailability();
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>EVA</h2>
        </div>
        <p className="small-text">
          {done
            ? `${done.samples} of ${total} geology samples from this site are aboard.`
            : `${total} geology samples are marked around the landing site. Walk out, collect them and bring them back aboard before the suit's oxygen runs low.`}
        </p>
        <div className="actions">
          <button
            type="button"
            className={check.ok ? 'primary' : undefined}
            disabled={!check.ok}
            title={check.ok ? 'Send an astronaut outside (time warp stops)' : check.reason}
            onClick={() => flightRuntime.beginEva()}
          >
            Start EVA
          </button>
        </div>
        {!check.ok && <p className="small-text muted">{check.reason}</p>}
      </div>
    );
  }
  return <EvaOutside eva={eva} body={body} />;
}

function EvaOutside({ eva, body }: { eva: EvaState; body: 'moon' | 'mars' }) {
  const rules = EVA_RULES[body];
  const o2 = eva.o2S / rules.o2S;
  const tone = o2 < EVA_LOW_O2 ? 'warn' : 'ok';
  const target = nearestOpen(eva);
  const toTarget = target ? bearingTo(eva, target.x, target.z) : null;
  const toShip = bearingTo(eva, eva.shipX, eva.shipZ);
  const inReach = target && toTarget && toTarget.distM <= rules.reachM ? target : null;
  const board = flightRuntime.boardAvailability();
  const bagged = eva.samples.filter((s) => s.progress >= 1).length;
  return (
    <div className="panel" aria-label="EVA">
      <div className="panel-header">
        <h2>EVA</h2>
        <span className="badge tone-warn">OUTSIDE</span>
      </div>
      <div className="meter-row">
        <span>Suit oxygen</span>
        <div
          className="progress"
          role="meter"
          aria-label="Suit oxygen"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(o2 * 100)}
        >
          <div className={`progress-fill fill-${tone}`} style={{ width: `${o2 * 100}%` }} />
        </div>
        <span className={`tone-${tone}`}>{mmss(eva.o2S)}</span>
      </div>
      <dl className="facts">
        <dt>Next sample</dt>
        <dd>
          {target && toTarget
            ? `${target.name}: ${Math.round(toTarget.distM)} m ${toTarget.dir}`
            : 'All bagged: head back to the ship.'}
        </dd>
        <dt>Ship</dt>
        <dd>
          {Math.round(toShip.distM)} m {toShip.dir}
        </dd>
        <dt>Bagged</dt>
        <dd>
          {bagged} of {eva.samples.length}
        </dd>
      </dl>
      {inReach && (
        <p className="tone-ok small-text" role="status">
          At the {inReach.name}: hold E (or Collect) — {Math.round(inReach.progress * 100)}%
        </p>
      )}
      <div className="eva-pad" role="group" aria-label="Walk">
        <span />
        <HoldButton k="forward" label="▲" title="Walk forward (W)" />
        <span />
        <HoldButton k="left" label="◀" title="Turn left (A)" />
        <HoldButton k="back" label="▼" title="Step back (S)" />
        <HoldButton k="right" label="▶" title="Turn right (D)" />
      </div>
      <div className="actions">
        <HoldButton k="collect" label="Collect" title="Collect the sample within reach (hold E)" />
        <button
          type="button"
          className={board.ok ? 'primary' : undefined}
          disabled={!board.ok}
          title={board.ok ? 'Climb back aboard with the samples' : board.reason}
          onClick={() => flightRuntime.boardShip()}
        >
          Board the ship
        </button>
      </div>
      {!board.ok && <p className="small-text muted">{board.reason}</p>}
      <p className="small-text muted">
        W/S walk, A/D turn, hold E to collect. Samples count once they're aboard; if the oxygen runs
        out they're dropped.
      </p>
    </div>
  );
}
