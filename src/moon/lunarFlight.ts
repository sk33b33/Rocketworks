import type { FlightEvent, FlightState, ShipSpec } from '../flight/flightModel';
import type { LunarSummary } from '../launch/flightRecord';
import { localFrame, orbitalElements, type OrbitalElements, type Vec2 } from '../flight/orbitMath';
import {
  bodyFrame,
  DEFAULT_MOON_EPHEMERIS,
  moonState,
  surfaceState,
  type GravityEnv,
  type MoonState,
} from './moonOrbit';
import {
  ASCENT_START,
  DESCENT_START,
  lunarRatingLimits,
  MANUAL_LUNAR_ALT_M,
  runAscent,
  runDescent,
  siteGeometry,
  surfaceProgress,
  surfaceTasks,
  type LandingGuidance,
  type SiteGeometry,
  type SurfaceTask,
} from './lunarLanding';
import {
  DEFAULT_SITE_ID,
  findLunarSite,
  LUNAR_SITES,
  SiteTerrain,
  terrainEnv,
  type LunarSite,
} from './lunarSites';
import { rateLanding } from '../recovery/rating';
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
  /** Surface cargo to unload (the surface science package). */
  readonly cargo?: boolean;
}

export interface SurfaceView {
  readonly startT: number;
  readonly elapsedS: number;
  readonly tasks: readonly SurfaceTask[];
  readonly progress: readonly number[];
  readonly done: boolean;
  /** Where the ship stands (selenographic angle). */
  readonly seleno: number;
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
  /** The chosen landing site and its terrain (landing missions). */
  readonly site: LunarSite;
  readonly terrain: SiteTerrain;
  readonly canChangeSite: boolean;
  /** Descent/ascent guidance state, and the ship's geometry over the site when near it. */
  readonly landing: LandingGuidance | null;
  readonly geometry: SiteGeometry | null;
  readonly surface: SurfaceView | null;
}

const LUNAR_PROGRAMS: readonly string[] = [
  'translunar',
  'lunar-orbit',
  'lunar-descent',
  'lunar-ascent',
  'trans-earth',
  'aerocapture',
];
export const isLunarProgram = (p: string): p is LunarProgramId => LUNAR_PROGRAMS.includes(p);

export class LunarFlight {
  private envNow: GravityEnv;
  private siteNow: LunarSite;
  private terrainNow: SiteTerrain;
  private lg: LandingGuidance | null = null;
  private surface: { startT: number; seleno: number; tasks: SurfaceTask[] } | null = null;
  private surfaceElapsed = 0;
  /** Flown below 500 m without / with the landing program (manual landing credit). */
  private manualLow = false;
  private assistedLow = false;
  private g: LunarGuidance = LUNAR_IDLE;
  private p: LunarProgress = NO_LUNAR_PROGRESS;
  private op: RefuelOp | null = null;
  private path: Vec2[] = [];
  private pathT = -Infinity;
  private pathProp = -1;

  constructor(readonly plan: LunarMissionPlan) {
    this.siteNow = findLunarSite(DEFAULT_SITE_ID) ?? LUNAR_SITES[0]!;
    this.terrainNow = new SiteTerrain(this.siteNow);
    this.envNow = { moon: DEFAULT_MOON_EPHEMERIS, terrain: terrainEnv(this.terrainNow) };
  }

  get env(): GravityEnv {
    return this.envNow;
  }
  get site(): LunarSite {
    return this.siteNow;
  }
  get terrain(): SiteTerrain {
    return this.terrainNow;
  }
  get onSurface(): boolean {
    return this.surface !== null;
  }

  /** The site can change until the descent has started. */
  get canChangeSite(): boolean {
    return this.plan.landing && !this.lg && !this.surface && !this.p.landing;
  }

  setSite(id: string): boolean {
    const site = findLunarSite(id);
    if (!site || !this.canChangeSite) return false;
    this.siteNow = site;
    this.terrainNow = new SiteTerrain(site);
    this.envNow = { ...this.envNow, terrain: terrainEnv(this.terrainNow) };
    return true;
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
    this.lg =
      program === 'lunar-descent'
        ? DESCENT_START
        : program === 'lunar-ascent'
          ? ASCENT_START
          : null;
  }

  stopProgram(): void {
    this.g = LUNAR_IDLE;
    this.lg = null;
  }

  run(s: FlightState, spec: ShipSpec, dt: number): LunarOutput {
    if (this.lg && (this.g.program === 'lunar-descent' || this.g.program === 'lunar-ascent')) {
      const out =
        this.lg.kind === 'descent'
          ? runDescent(this.lg, s, spec, this.env, this.siteNow, this.terrainNow, dt)
          : runAscent(this.lg, s, spec, this.env, this.terrainNow);
      this.lg = out.next;
      if (out.done) {
        if (this.lg.kind === 'ascent' && inLunarOrbit(s, this.env))
          this.p = { ...this.p, ascent: true };
        this.g = { ...LUNAR_IDLE, goal: this.plan.goal };
        this.lg = null;
      }
      return {
        controls: out.controls,
        next: this.g,
        ...(out.message ? { message: out.message } : {}),
        ...(out.done ? { chain: 'none' as const } : {}),
      };
    }
    const out = runLunarProgram(this.g, s, spec, this.env);
    this.g = out.next;
    if (out.chain === 'none' || out.chain === 'circularize' || out.chain === 'reentry')
      this.g = { ...LUNAR_IDLE, goal: this.plan.goal };
    return out;
  }

  // ---- landing and surface ----

  /** Records a touchdown on the Moon. Returns true if the ship stands (surface operations). */
  onTouchdown(s: FlightState): boolean {
    const td = s.touchdown;
    if (td?.body !== 'moon' || this.p.landing) return false;
    const x = this.terrainNow.offsetOf(td.seleno ?? 0);
    const outcome = s.phase === 'landed' ? 'landed' : s.phase === 'tipped' ? 'tipped' : 'crashed';
    const manual = this.manualLow && !this.assistedLow;
    this.p = {
      ...this.p,
      landing: {
        siteId: this.siteNow.id,
        siteName: this.siteNow.name,
        outcome,
        grade:
          outcome === 'landed'
            ? rateLanding(
                {
                  missM: x,
                  vertMS: td.vertMS,
                  horizMS: td.horizMS,
                  tiltDeg: td.tiltDeg + (td.slopeDeg ?? 0),
                },
                lunarRatingLimits(),
              ).grade
            : null,
        manual,
        missM: Math.abs(x),
      },
    };
    this.g = { ...LUNAR_IDLE, goal: this.plan.goal };
    this.lg = null;
    if (outcome !== 'landed') return false;
    this.surface = {
      startT: s.tS,
      seleno: td.seleno ?? this.siteNow.seleno,
      tasks: surfaceTasks(this.siteNow, !!this.plan.cargo),
    };
    this.surfaceElapsed = 0;
    return true;
  }

  /** Advances surface time; returns a note when the tasks complete. */
  surfaceStep(dt: number): string | null {
    if (!this.surface) return null;
    this.surfaceElapsed += dt;
    const done = surfaceProgress(this.surface.tasks, this.surfaceElapsed).every((p) => p >= 1);
    if (done && !this.p.surfaceDone) {
      this.p = { ...this.p, surfaceDone: true };
      return 'Surface tasks complete: ready to lift off.';
    }
    return null;
  }

  /** Lifts off: the ship's state on the pad at time t, and the ascent program engaged. */
  liftOff(s: FlightState): FlightState | null {
    const surf = this.surface;
    if (!surf) return null;
    const ground = this.envNow.terrain?.heightAt(surf.seleno) ?? 0;
    const { r, v } = surfaceState(surf.seleno, s.tS, this.envNow.moon, ground + 0.5);
    this.surface = null;
    this.g = startLunarProgram('lunar-ascent', this.plan.goal);
    this.lg = ASCENT_START;
    const { touchdown: _td, ...rest } = s;
    void _td;
    return { ...rest, r, v, phase: 'flight', pitchDeg: 90, throttle: 0, ref: 'moon' };
  }

  /** Surface state of a ship standing on the Moon at time t. */
  standing(s: FlightState): FlightState {
    const surf = this.surface;
    if (!surf) return s;
    const ground = this.envNow.terrain?.heightAt(surf.seleno) ?? 0;
    const { r, v } = surfaceState(surf.seleno, s.tS, this.envNow.moon, ground);
    return { ...s, r, v };
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
  track(s: FlightState, program: string): FlightEvent[] {
    const notes: FlightEvent[] = [];
    let p = this.p;
    if (s.ref === 'moon' && s.phase === 'flight' && this.plan.landing && !p.landing) {
      const geo = siteGeometry(s, this.envNow, this.terrainNow);
      if (geo.radarM < MANUAL_LUNAR_ALT_M && Math.abs(geo.x) < this.terrainNow.halfSpanM) {
        if (program === 'lunar-descent') this.assistedLow = true;
        else if (program === 'none') this.manualLow = true;
      }
    }
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
    if ((program === 'lunar-descent' || program === 'lunar-ascent') && this.lg) {
      const lg = this.lg;
      if (lg.kind === 'ascent')
        return lg.ascent === 'coast'
          ? { max: 100, reason: 'Ascent coast: warp limited to 100×.' }
          : { max: 10, reason: 'Ascent burn: warp limited to 10×.' };
      if (lg.descent === 'deorbit-wait') {
        if (lg.tgo < 300)
          return { max: 10, reason: 'Descent burn coming up: warp limited to 10×.' };
        if (lg.tgo < 3_000)
          return { max: 100, reason: 'Descent burn coming up: warp limited to 100×.' };
        return null;
      }
      if (lg.descent === 'coast') {
        const geo = siteGeometry(s, this.envNow, this.terrainNow);
        const togo =
          lg.descent === 'coast' ? Math.abs(geo.x) / Math.max(1, Math.abs(geo.vx)) : Infinity;
        if (togo < 400) return { max: 10, reason: 'Braking burn coming up: warp limited to 10×.' };
        return { max: 100, reason: 'Descending: warp limited to 100×.' };
      }
      return { max: 10, reason: 'Powered descent: warp limited to 10×.' };
    }
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
      site: this.siteNow,
      terrain: this.terrainNow,
      canChangeSite: this.canChangeSite,
      landing: this.lg,
      geometry:
        s && s.ref === 'moon' && this.plan.landing && moonAltitudeM < 200_000
          ? siteGeometry(s, this.envNow, this.terrainNow)
          : null,
      surface: this.surface
        ? {
            startT: this.surface.startT,
            elapsedS: this.surfaceElapsed,
            tasks: this.surface.tasks,
            progress: surfaceProgress(this.surface.tasks, this.surfaceElapsed),
            done: this.p.surfaceDone,
            seleno: this.surface.seleno,
          }
        : null,
    };
  }
}
