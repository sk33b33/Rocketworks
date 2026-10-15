import type { LunarGoal } from './lunarTransfer';

/*
 * Moon-mission rules shared by Mission Control and the flight: refuelling prices and the Δv
 * each leg of a lunar mission needs. Game values chosen for progression, not mission design.
 */

export interface RefuelChoice {
  /** Tanker flights that fill the ship in low Earth orbit before trans-lunar injection. */
  readonly leo: boolean;
  /** A top-up from a fictional pre-positioned depot in lunar orbit (stocked by uncrewed tankers). */
  readonly depot: boolean;
}

export const NO_REFUEL: RefuelChoice = { leo: false, depot: false };

/** Propellant one tanker flight delivers in low Earth orbit. */
export const TANKER_CAPACITY_KG = 220_000;
/** Cost of one (reusable) tanker flight. */
export const TANKER_FLIGHT_CREDITS = 9_000;
/** Cost of the lunar depot top-up (its tankers flew earlier, uncrewed). */
export const DEPOT_TOPUP_CREDITS = 60_000;

/** Researched logistics: bigger tankers and cheaper depot top-ups. */
export interface LogisticsTech {
  readonly heavyTankers?: boolean;
  readonly lunarLogistics?: boolean;
}

export function tankerFlights(shipCapacityKg: number, tech: LogisticsTech = {}): number {
  const per = TANKER_CAPACITY_KG * (tech.heavyTankers ? 1.5 : 1);
  return Math.max(1, Math.ceil(shipCapacityKg / per));
}

export function refuelCost(
  choice: RefuelChoice,
  shipCapacityKg: number,
  tech: LogisticsTech = {},
): number {
  return (
    (choice.leo ? tankerFlights(shipCapacityKg, tech) * TANKER_FLIGHT_CREDITS : 0) +
    (choice.depot ? Math.round(DEPOT_TOPUP_CREDITS * (tech.lunarLogistics ? 0.6 : 1)) : 0)
  );
}

/** One leg of a Moon mission and the Δv it needs from the ship. */
export interface LunarLeg {
  readonly id: 'trip' | 'outbound' | 'surface' | 'home';
  readonly label: string;
  readonly requiredDvMS: number;
  /** The refuelling that fills the tanks at the start of this leg ('none' = carry over). */
  readonly refuel: keyof RefuelChoice | 'none';
}

export interface LunarMissionRules {
  readonly goal: LunarGoal;
  readonly landing: boolean;
  readonly legs: readonly LunarLeg[];
}

export const FLYBY_RULES: LunarMissionRules = {
  goal: 'flyby',
  landing: false,
  legs: [
    {
      id: 'trip',
      label: 'Trans-lunar injection, flyby and return to orbit',
      requiredDvMS: 3_650,
      refuel: 'leo',
    },
  ],
};

export const LANDING_RULES: LunarMissionRules = {
  goal: 'capture',
  landing: true,
  legs: [
    {
      id: 'outbound',
      label: 'Trans-lunar injection and lunar orbit insertion',
      requiredDvMS: 4_250,
      refuel: 'leo',
    },
    {
      id: 'surface',
      label: 'Descent, ascent and the trip home',
      requiredDvMS: 5_150,
      refuel: 'depot',
    },
  ],
};

/** Contract runs to the lunar depot: into lunar orbit, unload at the depot, then home. */
export const DEPOT_RULES: LunarMissionRules = {
  goal: 'capture',
  landing: false,
  legs: [
    {
      id: 'outbound',
      label: 'Trans-lunar injection and lunar orbit insertion',
      requiredDvMS: 4_250,
      refuel: 'leo',
    },
    {
      // The depot takes the pallet but sells no propellant on a delivery run.
      id: 'home',
      label: 'Trans-Earth injection and the Earth arrival',
      requiredDvMS: 1_600,
      refuel: 'none',
    },
  ],
};

export interface LegCheck {
  readonly leg: LunarLeg;
  /** Δv the ship has for this leg (m/s). */
  readonly availableMS: number;
  readonly ok: boolean;
}

/**
 * Δv available for each leg: a refuelled leg starts with full tanks; otherwise the ship carries
 * over what's left (from orbit insertion, or from the previous leg).
 * @param fullShipDvMS ship Δv with full tanks and the mission's payload
 * @param inOrbitDvMS ship Δv left on reaching orbit
 * @param ispS ship vacuum Isp, to carry leftover propellant between legs
 */
export function checkLegs(
  rules: LunarMissionRules,
  refuel: RefuelChoice,
  fullShipDvMS: number,
  inOrbitDvMS: number,
): LegCheck[] {
  let carried = inOrbitDvMS;
  return rules.legs.map((leg) => {
    const available = leg.refuel !== 'none' && refuel[leg.refuel] ? fullShipDvMS : carried;
    carried = Math.max(0, available - leg.requiredDvMS);
    return { leg, availableMS: available, ok: available >= leg.requiredDvMS };
  });
}

/** Refuelling a mission needs by default (the legs that can't be flown on what's left). */
export function defaultRefuel(rules: LunarMissionRules | undefined): RefuelChoice {
  if (!rules) return NO_REFUEL;
  return {
    leo: rules.legs.some((l) => l.refuel === 'leo'),
    depot: rules.legs.some((l) => l.refuel === 'depot'),
  };
}
