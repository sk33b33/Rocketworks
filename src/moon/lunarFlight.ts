import type { FlightEvent, FlightState, ShipSpec } from '../flight/flightModel';
import type { LunarSummary } from '../launch/flightRecord';
import { localFrame, orbitalElements, type OrbitalElements, type Vec2 } from '../flight/orbitMath';
import {
  bodyFrame,
  DEFAULT_MOON_EPHEMERIS,
  moonState,
  type GravityEnv,
  type MoonState,
} from './moonOrbit';
import {
  inLunarOrbit,
  LUNAR_IDLE,
  MOON_BODY,
  runLunarProgram,
  startLunarProgram,
  type LunarGoal,
  type LunarGuidance,
  type LunarOutput,
  type LunarProgramId,
} from './lunarTransfer';
import { samplePath } from './propagate';

/*
 * Everything a Moon mission adds to an orbital flight, owned by the flight runtime: the Moon and
 * its gravity, the lunar guidance programs, refuelling operations and the lunar objectives.
 * Framework-free and stepped at the runtime's fixed steps.
 */

export interface LunarMissionPlan {
  /** 'capture' = go into lunar orbit (landing missions); 'flyby' = free return. */
  readonly goal: LunarGoal;
  readonly landing: boolean;
  /** Refuelling bought in Mission Control: tankers in low Earth orbit, the lunar-orbit depot. */
  readonly refuel: { readonly leo: boolean; readonly depot: boolean };
}

export interface LunarProgress {
  readonly refuelLeo: boolean;
  readonly tli: boolean;
  readonly soi: boolean;
  /** Closest approach to the Moon so far (altitude, m). */
  readonly closestAltM: number | null;
  readonly flyby: boolean;
  readonly lunarOrbit: boolean;
  readonly refuelDepot: boolean;
  /** Back in a closed Earth orbit (or re-entering) after the Moon. */
  readonly earthReturn: boolean;
  /** Lunar landing result (landing missions). */
  readonly landing: LunarSummary['landing'];
  readonly surfaceDone: boolean;
  /** Lifted off and reached lunar orbit again. */
  readonly ascent: boolean;
}

export const NO_LUNAR_PROGRESS: LunarProgress = {
  refuelLeo: false,
  tli: false,
  soi: false,
  closestAltM: null,
  flyby: false,
  lunarOrbit: false,
  refuelDepot: false,
  earthReturn: false,
  landing: null,
  surfaceDone: false,
  ascent: false,
};

/** A flyby counts (photography objective) within this altitude of the Moon. */
export const FLYBY_PHOTO_ALT_M = 20_000_000;

export type RefuelKind = 'leo' | 'depot';

export const REFUEL = {
  /** Tanker rendezvous and transfers in low Earth orbit (abstracted, timed). */
  leoDurationS: 6 * 3_600,
  /** Docking at the pre-positioned depot in lunar orbit and topping up. */
  depotDurationS: 3 * 3_600,
} as const;

export interface RefuelOp {
  readonly kind: RefuelKind;
  readonly startT: number;
  readonly endT: number;
  readonly fromKg: number;
}

export interface LunarView {
  readonly plan: LunarMissionPlan;
  readonly moon: MoonState;
  readonly env: GravityEnv;
  readonly guidance: LunarGuidance;
  readonly progress: LunarProgress;
  /** Elements around the Moon while inside its sphere of influence. */
  readonly moonElements: OrbitalElements | null;
  readonly moonAltitudeM: number;
  readonly inLunarOrbit: boolean;
  readonly refuel: RefuelOp | null;
  readonly refuelAvailable: {
    readonly ok: boolean;
    readonly kind: RefuelKind | null;
    readonly reason?: string;
  };
  /** Predicted coasting path (Earth-centred positions) for the map. */
  readonly path: readonly Vec2[];
}

export const isLunarProgram = (p: string): p is LunarProgramId =>
  p === 'translunar' || p === 'lunar-orbit' || p === 'trans-earth' || p === 'aerocapture';

export class LunarFlight {
  readonly env: GravityEnv;
  private g: LunarGuidance = LUNAR_IDLE;
  private p: LunarProgress = NO_LUNAR_PROGRESS;
  private op: RefuelOp | null = null;
  private path: Vec2[] = [];
  private pathT = -Infinity;
  private pathProp = -1;

  constructor(readonly plan: LunarMissionPlan) {
    this.env = { moon: DEFAULT_MOON_EPHEMERIS };
  }

  get guidance(): LunarGuidance {
    return this.g;
  }
  get progress(): LunarProgress {
    return this.p;
  }
  get refuelling(): RefuelOp | null {
    return this.op;
  }

  startProgram(program: LunarProgramId): void {
    this.g = startLunarProgram(program, this.plan.goal);
  }

  stopProgram(): void {
    this.g = LUNAR_IDLE;
  }

  run(s: FlightState, spec: ShipSpec): LunarOutput {
    const out = runLunarProgram(this.g, s, spec, this.env);
    this.g = out.next;
    if (out.chain === 'none' || out.chain === 'circularize' || out.chain === 'reentry')
      this.g = { ...LUNAR_IDLE, goal: this.plan.goal };
    return out;
  }

  // ---- refuelling ----

  refuelAvailability(s: FlightState): { ok: boolean; kind: RefuelKind | null; reason?: string } {
    if (this.op) return { ok: false, kind: this.op.kind, reason: 'Refuelling in progress.' };
    if (s.phase !== 'flight') return { ok: false, kind: null, reason: 'The ship is down.' };
    if (s.ref === 'moon') {
      if (!this.plan.refuel.depot)
        return { ok: false, kind: null, reason: 'No depot top-up was bought for this mission.' };
      if (this.p.refuelDepot) return { ok: false, kind: null, reason: 'The depot top-up is used.' };
      if (!inLunarOrbit(s, this.env))
        return {
          ok: false,
          kind: 'depot',
          reason: 'Reach a stable lunar orbit to meet the depot.',
        };
      return { ok: true, kind: 'depot' };
    }
    if (!this.plan.refuel.leo)
      return {
        ok: false,
        kind: null,
        reason: 'No orbital refuelling was bought for this mission.',
      };
    if (this.p.refuelLeo) return { ok: false, kind: null, reason: 'The tanker flights are used.' };
    const el = orbitalElements(s.r, s.v);
    if (el.status !== 'orbit' || el.apoapsisAltM > 1_000_000)
      return {
        ok: false,
        kind: 'leo',
        reason: 'Needs a stable low Earth orbit to meet the tankers.',
      };
    return { ok: true, kind: 'leo' };
  }

  startRefuel(s: FlightState): { ok: boolean; reason?: string } {
    const a = this.refuelAvailability(s);
    if (!a.ok || !a.kind) return { ok: false, reason: a.reason };
    const dur = a.kind === 'leo' ? REFUEL.leoDurationS : REFUEL.depotDurationS;
    this.op = { kind: a.kind, startT: s.tS, endT: s.tS + dur, fromKg: s.propKg };
    return { ok: true };
  }

  /** Tops the tanks up gradually while refuelling; returns the updated state. */
  applyRefuel(s: FlightState, spec: ShipSpec): { state: FlightState; done?: string } {
    const op = this.op;
    if (!op) return { state: s };
    const cap = spec.stage.propellantKg;
    const f = Math.min(1, (s.tS - op.startT) / (op.endT - op.startT));
    const propKg = Math.max(s.propKg, op.fromKg + (cap - op.fromKg) * f);
    if (f < 1) return { state: { ...s, propKg } };
    this.op = null;
    this.p = op.kind === 'leo' ? { ...this.p, refuelLeo: true } : { ...this.p, refuelDepot: true };
    return {
      state: { ...s, propKg: cap },
      done:
        op.kind === 'leo'
          ? `Refuelled in orbit: tanks full (${Math.round(cap / 1000)} t).`
          : `Depot top-up complete: tanks full (${Math.round(cap / 1000)} t).`,
    };
  }

  // ---- objectives ----

  /** Tracks lunar objectives after a step; returns log notes. */
  track(s: FlightState): FlightEvent[] {
    const notes: FlightEvent[] = [];
    let p = this.p;
    const note = (text: string, kind: FlightEvent['kind'] = 'success') =>
      notes.push({ tS: s.tS, kind, text });
    const earthEl = orbitalElements(s.r, s.v);
    if (
      !p.tli &&
      s.ref !== 'moon' &&
      (earthEl.status === 'escape' || earthEl.apoapsisAltM > 200_000_000)
    ) {
      p = { ...p, tli: true };
      note('Trans-lunar injection: on the way to the Moon.');
    }
    if (s.ref === 'moon') {
      const f = bodyFrame('moon', s.r, s.v, s.tS, this.env);
      if (!p.soi) p = { ...p, soi: true };
      if (p.closestAltM === null || f.altitudeM < p.closestAltM)
        p = { ...p, closestAltM: f.altitudeM };
      if (!p.flyby && f.altitudeM < FLYBY_PHOTO_ALT_M) {
        p = { ...p, flyby: true };
        note(
          `Lunar flyby: photographing the Moon from ${Math.round(f.altitudeM / 1000).toLocaleString('en-US')} km.`,
        );
      }
      if (!p.lunarOrbit && inLunarOrbit(s, this.env)) {
        const el = orbitalElements(f.r, f.v, MOON_BODY);
        if (el.apoapsisAltM < 5_000_000) {
          p = { ...p, lunarOrbit: true };
          note(
            `Lunar orbit: ${Math.round(el.apoapsisAltM / 1000)} × ${Math.round(el.periapsisAltM / 1000)} km.`,
          );
        }
      }
    } else if (p.soi && !p.earthReturn) {
      const alt = localFrame(s.r).altitudeM;
      if ((earthEl.status !== 'escape' && earthEl.apoapsisAltM < 5_000_000) || alt < 100_000) {
        p = { ...p, earthReturn: true };
        note('Back from the Moon: captured by Earth.');
      }
    }
    this.p = p;
    return notes;
  }

  // ---- warp ----

  /** Extra warp limits for lunar programs and refuelling (null = no extra limit). */
  limit(s: FlightState, program: string): { max: number; reason: string } | null {
    const g = this.g;
    const t = s.tS;
    if (isLunarProgram(program)) {
      if (g.phase === 'burn' || g.phase === 'mcc-burn')
        return { max: 10, reason: 'Engines burning: warp limited to 10×.' };
      if (g.burnStartT !== null && (g.phase === 'wait' || program === 'lunar-orbit')) {
        const togo = g.burnStartT - t;
        if (togo < 300) return { max: 10, reason: 'Burn coming up: warp limited to 10×.' };
        if (togo < 3_000) return { max: 100, reason: 'Burn coming up: warp limited to 100×.' };
      }
      if (g.mccT !== null && g.phase === 'coast') {
        const togo = g.mccT - t;
        if (togo < 120)
          return { max: 10, reason: 'Course correction coming up: warp limited to 10×.' };
      }
      if (program === 'aerocapture' && localFrame(s.r).altitudeM < 400_000)
        return { max: 10, reason: 'Aerocapture pass: warp limited to 10×.' };
      if (program === 'trans-earth' && localFrame(s.r).altitudeM < 3_500_000)
        return { max: 100, reason: 'Approaching Earth: warp limited to 100×.' };
    }
    return null;
  }

  /** Whether deep-space warp (above 1000×) is safe here. */
  deepSpace(s: FlightState): boolean {
    const earthAlt = localFrame(s.r).altitudeM;
    const m = moonState(this.env.moon, s.tS);
    const moonDist = Math.hypot(s.r[0] - m.r[0], s.r[1] - m.r[1]);
    return earthAlt > 60_000_000 && moonDist > 25_000_000 && !this.op;
  }

  // ---- view ----

  view(s: FlightState | null): LunarView {
    const t = s?.tS ?? 0;
    const moon = moonState(this.env.moon, t);
    let moonElements: OrbitalElements | null = null;
    let moonAltitudeM = Infinity;
    if (s) {
      const f = bodyFrame('moon', s.r, s.v, s.tS, this.env);
      moonAltitudeM = f.altitudeM;
      if (s.ref === 'moon') moonElements = orbitalElements(f.r, f.v, MOON_BODY);
      // Refresh the predicted path occasionally (and after burns) — only on lunar trajectories:
      // closed low orbits are drawn from their conic by the map.
      if (s.phase === 'flight' && s.throttle === 0 && !this.op) {
        const earthEl = orbitalElements(s.r, s.v);
        const lunarPath =
          s.ref === 'moon'
            ? !inLunarOrbit(s, this.env)
            : earthEl.status === 'escape' || earthEl.apoapsisAltM > 5_000_000;
        if (!lunarPath) {
          this.path = [];
        } else if (t - this.pathT > 1_800 || Math.abs(s.propKg - this.pathProp) > 1) {
          this.path = samplePath({ r: s.r, v: s.v, tS: s.tS }, this.env, 5 * 86_400, 300);
          this.pathT = t;
          this.pathProp = s.propKg;
        }
      }
    }
    return {
      plan: this.plan,
      moon,
      env: this.env,
      guidance: this.g,
      progress: this.p,
      moonElements,
      moonAltitudeM,
      inLunarOrbit: s ? inLunarOrbit(s, this.env) : false,
      refuel: this.op,
      refuelAvailable: s ? this.refuelAvailability(s) : { ok: false, kind: null },
      path: this.path,
    };
  }
}
