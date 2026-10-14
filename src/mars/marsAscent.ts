import type { FlightControls, FlightState, ShipSpec } from '../flight/flightModel';
import { orbitalElements } from '../flight/orbitMath';
import { marsGeometry } from './marsEntry';
import { marsAccelMax, marsSlewRate, type MarsGround } from './marsModel';
import { MARS_PARKING_ALT_M } from './marsTransfer';
import { MARS_BODY } from './solarSystem';

/*
 * Ascent from the Martian surface to a low parking orbit (gameplay guidance, like the lunar
 * ascent): a short vertical rise to clear the ground, a climb that holds a rate-of-climb profile
 * with the vertical part of the thrust while the rest builds orbital speed, engine cutoff once
 * the apoapsis reaches the parking altitude, a coast up to it and a prograde circularization.
 * The thin air costs a little speed low down; the ship's thrust is ample in Mars gravity.
 */

export type MarsAscentPhase = 'vertical' | 'climb' | 'coast' | 'circularize' | 'done';

export interface MarsAscent {
  readonly phase: MarsAscentPhase;
  /** Eccentricity on the previous circularization step (stop when it starts rising). */
  readonly lastEccentricity: number | null;
}

export const ASCENT_START: MarsAscent = { phase: 'vertical', lastEccentricity: null };

export const MARS_ASCENT_LABELS: Record<MarsAscentPhase, string> = {
  vertical: 'Vertical rise',
  climb: 'Climb to orbit',
  coast: 'Coast to apoapsis',
  circularize: 'Circularize',
  done: 'In Mars orbit',
};

/** Rate of climb the profile holds (m/s), easing off toward the parking altitude. */
const climbRate = (h: number) => Math.max(0, Math.min(700, (MARS_PARKING_ALT_M - h) / 45));

const pitchOf = (ax: number, ah: number) => (Math.atan2(ah, ax) * 180) / Math.PI;
const aligned = (s: FlightState, pitch: number) =>
  Math.abs(((pitch - s.pitchDeg + 540) % 360) - 180) < 3;

export interface MarsAscentOutput {
  readonly controls: FlightControls;
  readonly next: MarsAscent;
  readonly message?: string;
  /** In orbit (or the ascent ended short): the program has finished. */
  readonly done?: boolean;
}

/** Runs the ascent for one step. */
export function runMarsAscent(
  g: MarsAscent,
  s: FlightState,
  spec: ShipSpec,
  ground: MarsGround,
): MarsAscentOutput {
  const geo = marsGeometry(s, ground);
  const el = orbitalElements(s.r, s.v, MARS_BODY);
  const prograde = geo.gammaDeg;
  const slewDegS = marsSlewRate(s);
  const ctl = (targetPitchDeg: number, throttle: number): FlightControls => ({
    targetPitchDeg,
    bankDeg: 0,
    yawDeg: 0,
    throttle,
    slewDegS,
  });
  switch (g.phase) {
    case 'vertical':
      if (geo.radarM > 300)
        return {
          controls: ctl(90, 1),
          next: { ...g, phase: 'climb' },
          message: 'Pitching over toward orbit.',
        };
      return { controls: ctl(90, 1), next: g };
    case 'climb': {
      // (A near-vertical path reads as a huge apoapsis: wait for real orbital speed.)
      if (el.apoapsisAltM >= MARS_PARKING_ALT_M && el.status !== 'escape' && geo.vx > 2_000)
        return {
          controls: ctl(prograde, 0),
          next: { ...g, phase: 'coast' },
          message: `Engine cutoff: coasting up to ${Math.round(el.apoapsisAltM / 1000)} km.`,
        };
      const aMax = marsAccelMax(spec, s.propKg, s.enginesOut);
      const ah = Math.max(
        -aMax * 0.5,
        Math.min(aMax * 0.95, geo.gEff + (climbRate(geo.h) - geo.vh)),
      );
      const ax = Math.sqrt(Math.max(0, aMax * aMax - ah * ah));
      return { controls: ctl(pitchOf(ax, ah), s.propKg > 0 ? 1 : 0), next: g };
    }
    case 'coast':
      if (Math.abs(geo.vh) < 8 || geo.h >= el.apoapsisAltM - 500)
        return {
          controls: ctl(prograde, aligned(s, prograde) ? 1 : 0),
          next: { ...g, phase: 'circularize' },
          message: 'Circularizing in Mars orbit.',
        };
      return { controls: ctl(prograde, 0), next: g };
    case 'circularize': {
      const rising = g.lastEccentricity !== null && el.eccentricity > g.lastEccentricity + 1e-6;
      if (
        (el.status === 'orbit' &&
          el.periapsisAltM >= MARS_PARKING_ALT_M * 0.75 &&
          (rising || el.eccentricity < 0.003)) ||
        s.propKg <= 0
      )
        return {
          controls: ctl(prograde, 0),
          next: { ...g, phase: 'done' },
          message:
            el.status === 'orbit' && el.periapsisAltM > 130_000
              ? `In Mars orbit: ${Math.round(el.apoapsisAltM / 1000)} × ${Math.round(el.periapsisAltM / 1000)} km.`
              : 'Ascent ended short of a safe orbit.',
          done: true,
        };
      return {
        controls: ctl(prograde, aligned(s, prograde) ? 0.5 : 0),
        next: { ...g, lastEccentricity: el.eccentricity },
      };
    }
    default:
      return { controls: ctl(prograde, 0), next: g, done: true };
  }
}
