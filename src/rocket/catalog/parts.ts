import { HULL_RADIUS_M, noseRadiusAt } from '../model/geometry';
import type { PartDefinition, SocketDefinition, SocketSpan, SocketType } from '../model/types';

/*
 * Parts catalog. Masses, capacities and thrust are game-tuned approximations chosen for readable
 * gameplay (e.g. a liftoff thrust-to-weight ratio around 1.5), not real vehicle data.
 */

const R = HULL_RADIUS_M;
const DEG = Math.PI / 180;

/** Stack connector on top of a section. */
function top(type: SocketType, heightM: number): SocketDefinition {
  return { id: 'top', name: 'Top ring', type, position: [0, heightM, 0], rotation: [0, 0, 0] };
}

/** Radial socket on the hull surface; the child's +X points outward. */
function radial(
  id: string,
  name: string,
  type: SocketType,
  angleDeg: number,
  y: number,
  radius = R,
  span?: SocketSpan,
): SocketDefinition {
  const a = angleDeg * DEG;
  return {
    id,
    name,
    type,
    position: [radius * Math.cos(a), y, radius * Math.sin(a)],
    rotation: [0, -a, 0],
    ...(span ? { span } : {}),
  };
}

/** Downward-facing engine mount; the attached engine's +Y points down. */
function engineMount(
  id: string,
  name: string,
  radius: number,
  angleDeg: number,
  y: number,
): SocketDefinition {
  const a = angleDeg * DEG;
  return {
    id,
    name,
    type: 'engine',
    position: [radius * Math.cos(a), y, radius * Math.sin(a)],
    rotation: [Math.PI, 0, 0],
  };
}

function ring(count: number, startDeg: number): number[] {
  return Array.from({ length: count }, (_, i) => startDeg + (360 / count) * i);
}

/** Windward heat-shield slot (the shield covers the +Z half of the section). */
function heatShield(
  heightM: number,
  profile: SocketSpan['profile'] = 'cylinder',
): SocketDefinition {
  return {
    id: 'heat-shield',
    name: 'Windward tile surface',
    type: 'heat-shield',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    span: { heightM, profile },
  };
}

const BOOSTER_ENGINE_SECTION_H = 6;
const BOOSTER_TANK_H = 10;
const BOOSTER_TANK_SHORT_H = 5;
const BOOSTER_FORWARD_H = 5;
const INTERSTAGE_H = 2.5;
const SHIP_AFT_H = 6;
const SHIP_TANK_H = 8;
const SHIP_TANK_EXT_H = 12;
const CABIN_H = 7;
const NOSE_H = 9;

const UNLOCKED = { unlocked: true } as const;

export const PARTS: readonly PartDefinition[] = [
  // ---- Booster ----
  {
    id: 'booster-engine-section',
    name: 'Booster Engine Section',
    description:
      'Thrust structure at the base of the booster. Holds 13 engine mounts (3 inner, 10 outer), four landing-leg hardpoints and the aft skirt.',
    category: 'structure',
    stage: 'booster',
    dryMassKg: 60_000,
    costCredits: 9_000,
    attachesTo: 'root',
    heightM: BOOSTER_ENGINE_SECTION_H,
    sockets: [
      top('booster-stack', BOOSTER_ENGINE_SECTION_H),
      ...ring(3, 90).map((a, i) =>
        engineMount(`engine-inner-${i + 1}`, `Inner engine mount ${i + 1}`, 1.1, a, 0.3),
      ),
      ...ring(10, 0).map((a, i) =>
        engineMount(`engine-outer-${i + 1}`, `Outer engine mount ${i + 1}`, 3.3, a, 0.3),
      ),
      ...ring(4, 45).map((a, i) =>
        radial(`leg-${i + 1}`, `Landing-leg hardpoint ${i + 1}`, 'leg', a, 1.6),
      ),
      radial('detail-1', 'Aft detail slot A', 'detail', 0, 3.6),
      radial('detail-2', 'Aft detail slot B', 'detail', 180, 3.6),
    ],
    visual: 'booster-engine-section',
    unlock: UNLOCKED,
    tags: [],
  },
  {
    id: 'booster-tank',
    name: 'Booster Tank Section',
    description:
      'Welded stainless-steel propellant barrel for the booster. Stack several for more propellant.',
    category: 'tank',
    stage: 'booster',
    dryMassKg: 22_000,
    costCredits: 6_000,
    propellantCapacityKg: 760_000,
    attachesTo: 'booster-stack',
    heightM: BOOSTER_TANK_H,
    rotationStepDeg: 45,
    sockets: [
      top('booster-stack', BOOSTER_TANK_H),
      radial('detail-1', 'Detail slot A', 'detail', 90, 5),
      radial('detail-2', 'Detail slot B', 'detail', 270, 5),
    ],
    visual: 'booster-tank',
    unlock: UNLOCKED,
    tags: [],
  },
  {
    id: 'booster-tank-short',
    name: 'Booster Tank Section (Short)',
    description: 'Half-length booster barrel for fine-tuning propellant load and stack height.',
    category: 'tank',
    stage: 'booster',
    dryMassKg: 12_000,
    costCredits: 3_500,
    propellantCapacityKg: 380_000,
    attachesTo: 'booster-stack',
    heightM: BOOSTER_TANK_SHORT_H,
    rotationStepDeg: 45,
    sockets: [
      top('booster-stack', BOOSTER_TANK_SHORT_H),
      radial('detail-1', 'Detail slot', 'detail', 90, 2.5),
    ],
    visual: 'booster-tank-short',
    unlock: UNLOCKED,
    tags: [],
  },
  {
    id: 'booster-forward-section',
    name: 'Booster Forward Section',
    description:
      'Top dome of the booster with four grid-fin actuators. Caps the booster stack and takes the interstage.',
    category: 'structure',
    stage: 'booster',
    dryMassKg: 18_000,
    costCredits: 5_000,
    attachesTo: 'booster-stack',
    heightM: BOOSTER_FORWARD_H,
    rotationStepDeg: 90,
    sockets: [
      top('interstage', BOOSTER_FORWARD_H),
      ...ring(4, 45).map((a, i) =>
        radial(`grid-fin-${i + 1}`, `Grid-fin actuator ${i + 1}`, 'grid-fin', a, 3.2),
      ),
    ],
    visual: 'booster-forward-section',
    unlock: UNLOCKED,
    tags: [],
  },
  {
    id: 'hot-stage-interstage',
    name: 'Hot-Stage Interstage Ring',
    description:
      'Vented connection ring between booster and ship. Lets the ship light its engines before separation.',
    category: 'structure',
    stage: 'booster',
    dryMassKg: 9_000,
    costCredits: 3_000,
    attachesTo: 'interstage',
    heightM: INTERSTAGE_H,
    sockets: [top('ship-base', INTERSTAGE_H)],
    visual: 'interstage',
    unlock: UNLOCKED,
    tags: [],
  },

  // ---- Ship ----
  {
    id: 'ship-aft-section',
    name: 'Ship Aft Section',
    description:
      'Engine bay and aft skirt of the upper stage: six engine mounts, aft flap hinges and leg hardpoints.',
    category: 'structure',
    stage: 'ship',
    dryMassKg: 30_000,
    costCredits: 8_000,
    propellantCapacityKg: 30_000,
    attachesTo: 'ship-base',
    heightM: SHIP_AFT_H,
    sockets: [
      top('ship-stack', SHIP_AFT_H),
      ...ring(3, 90).map((a, i) =>
        engineMount(`engine-inner-${i + 1}`, `Inner engine mount ${i + 1}`, 1.0, a, 0.5),
      ),
      ...ring(3, 30).map((a, i) =>
        engineMount(`engine-outer-${i + 1}`, `Outer engine mount ${i + 1}`, 2.9, a, 0.5),
      ),
      radial('flap-aft-1', 'Aft flap hinge (starboard)', 'flap-aft', 0, 2.8),
      radial('flap-aft-2', 'Aft flap hinge (port)', 'flap-aft', 180, 2.8),
      ...ring(4, 45).map((a, i) =>
        radial(`leg-${i + 1}`, `Landing-leg hardpoint ${i + 1}`, 'leg', a, 1.2),
      ),
      heatShield(SHIP_AFT_H),
      radial('detail-1', 'Detail slot', 'detail', 270, 3),
    ],
    visual: 'ship-aft-section',
    unlock: UNLOCKED,
    tags: [],
  },
  {
    id: 'ship-tank',
    name: 'Ship Tank Section',
    description: 'Propellant segment for the upper stage.',
    category: 'tank',
    stage: 'ship',
    dryMassKg: 16_000,
    costCredits: 5_000,
    propellantCapacityKg: 520_000,
    attachesTo: 'ship-stack',
    heightM: SHIP_TANK_H,
    sockets: [
      top('ship-stack', SHIP_TANK_H),
      heatShield(SHIP_TANK_H),
      radial('detail-1', 'Detail slot A', 'detail', 0, 4),
      radial('detail-2', 'Detail slot B', 'detail', 270, 4),
    ],
    visual: 'ship-tank',
    unlock: UNLOCKED,
    tags: [],
  },
  {
    id: 'ship-tank-extended',
    name: 'Extended Ship Tank',
    description: 'A stretched ship tank segment with 50% more propellant.',
    category: 'tank',
    stage: 'ship',
    dryMassKg: 23_000,
    costCredits: 8_000,
    propellantCapacityKg: 800_000,
    attachesTo: 'ship-stack',
    heightM: SHIP_TANK_EXT_H,
    sockets: [
      top('ship-stack', SHIP_TANK_EXT_H),
      heatShield(SHIP_TANK_EXT_H),
      radial('detail-1', 'Detail slot A', 'detail', 0, 6),
      radial('detail-2', 'Detail slot B', 'detail', 270, 6),
    ],
    visual: 'ship-tank-extended',
    unlock: {
      unlocked: false,
      reason: 'Research "Extended Tankage" in the Program panel.',
      techId: 'extended-tankage',
    },
    tags: [],
  },
  {
    id: 'crew-cabin',
    name: 'Crew Cabin',
    description: 'Pressurized crew deck with a window band, seats for 8 and an EVA hatch slot.',
    category: 'crew',
    stage: 'ship',
    dryMassKg: 22_000,
    costCredits: 12_000,
    crewCapacity: 8,
    attachesTo: 'ship-stack',
    heightM: CABIN_H,
    sockets: [
      top('ship-stack', CABIN_H),
      heatShield(CABIN_H),
      radial('detail-1', 'Hatch / detail slot', 'detail', 270, 3.2),
    ],
    visual: 'crew-cabin',
    unlock: UNLOCKED,
    tags: ['crew'],
  },
  {
    id: 'cargo-bay',
    name: 'Cargo Bay Module',
    description:
      'Unpressurized payload bay with a large clamshell door. Use instead of (or with) a crew cabin.',
    category: 'crew',
    stage: 'ship',
    dryMassKg: 14_000,
    costCredits: 6_000,
    attachesTo: 'ship-stack',
    heightM: CABIN_H,
    sockets: [
      top('ship-stack', CABIN_H),
      heatShield(CABIN_H),
      radial('detail-1', 'Detail slot', 'detail', 0, 3.5),
    ],
    visual: 'cargo-bay',
    unlock: UNLOCKED,
    tags: ['payload'],
  },
  {
    id: 'nose-cone',
    name: 'Nose Cone',
    description: 'Blunt aerodynamic nose with forward flap hinges and a docking port at the tip.',
    category: 'structure',
    stage: 'ship',
    dryMassKg: 12_000,
    costCredits: 5_000,
    attachesTo: 'ship-stack',
    heightM: NOSE_H,
    sockets: [
      {
        id: 'docking',
        name: 'Nose docking port',
        type: 'docking',
        position: [0, NOSE_H, 0],
        rotation: [0, 0, 0],
      },
      radial(
        'flap-forward-1',
        'Forward flap hinge (starboard)',
        'flap-forward',
        0,
        2.5,
        noseRadiusAt(2.5, NOSE_H),
      ),
      radial(
        'flap-forward-2',
        'Forward flap hinge (port)',
        'flap-forward',
        180,
        2.5,
        noseRadiusAt(2.5, NOSE_H),
      ),
      heatShield(NOSE_H, 'ogive'),
    ],
    visual: 'nose-cone',
    unlock: UNLOCKED,
    tags: [],
  },

  // ---- Propulsion ----
  {
    id: 'engine-sl',
    name: 'Forge-SL Engine',
    description: 'Sea-level methalox engine with gimbal. Fits any engine mount.',
    category: 'propulsion',
    dryMassKg: 1_600,
    costCredits: 2_000,
    thrustN: 4_500_000,
    ispSeaLevelS: 330,
    ispVacuumS: 350,
    attachesTo: 'engine',
    sockets: [],
    visual: 'engine-sl',
    unlock: UNLOCKED,
    tags: [],
  },
  {
    id: 'engine-sl-b2',
    name: 'Forge-SL Block 2 Engine',
    description:
      'Uprated sea-level engine: more thrust and slightly better efficiency for little extra mass.',
    category: 'propulsion',
    dryMassKg: 1_700,
    costCredits: 3_200,
    thrustN: 5_200_000,
    ispSeaLevelS: 335,
    ispVacuumS: 356,
    attachesTo: 'engine',
    sockets: [],
    visual: 'engine-sl-b2',
    unlock: {
      unlocked: false,
      reason: 'Research "Engine Block 2" in the Program panel.',
      techId: 'engine-block-2',
    },
    tags: [],
  },
  {
    id: 'engine-vac',
    name: 'Forge-V Vacuum Engine',
    description:
      'Vacuum-optimized engine with a large nozzle extension. Inefficient in the lower atmosphere.',
    category: 'propulsion',
    dryMassKg: 2_100,
    costCredits: 3_500,
    thrustN: 3_200_000,
    ispSeaLevelS: 250,
    ispVacuumS: 380,
    attachesTo: 'engine',
    sockets: [],
    visual: 'engine-vac',
    unlock: {
      unlocked: false,
      reason: 'Research "Vacuum Propulsion" in the Program panel.',
      techId: 'vacuum-propulsion',
    },
    tags: ['vacuum'],
  },

  // ---- Control surfaces ----
  {
    id: 'grid-fin',
    name: 'Grid Fin',
    description: 'Lattice steering fin for booster descent control.',
    category: 'control',
    dryMassKg: 3_000,
    costCredits: 1_200,
    attachesTo: 'grid-fin',
    sockets: [],
    visual: 'grid-fin',
    unlock: UNLOCKED,
    tags: ['landing'],
  },
  {
    id: 'flap-forward',
    name: 'Forward Flap',
    description: 'Small hinged flap on the nose for belly-flop re-entry control.',
    category: 'control',
    dryMassKg: 2_500,
    costCredits: 1_500,
    attachesTo: 'flap-forward',
    sockets: [],
    visual: 'flap-forward',
    unlock: UNLOCKED,
    tags: ['reentry'],
  },
  {
    id: 'flap-aft',
    name: 'Aft Flap',
    description: 'Large hinged flap on the aft section for re-entry attitude control.',
    category: 'control',
    dryMassKg: 4_000,
    costCredits: 2_000,
    attachesTo: 'flap-aft',
    sockets: [],
    visual: 'flap-aft',
    unlock: UNLOCKED,
    tags: ['reentry'],
  },

  // ---- Landing / thermal / docking ----
  {
    id: 'landing-leg',
    name: 'Landing Leg',
    description: 'Folding leg with a crush-core foot pad for propulsive landings.',
    category: 'landing',
    dryMassKg: 2_000,
    costCredits: 1_000,
    attachesTo: 'leg',
    sockets: [],
    visual: 'landing-leg',
    unlock: UNLOCKED,
    tags: ['landing'],
  },
  {
    id: 'heat-shield',
    name: 'Heat-Shield Tile Section',
    description: 'Hexagonal ceramic tiles covering the windward half of one ship section.',
    category: 'thermal',
    dryMassKg: 3_500,
    costCredits: 1_800,
    attachesTo: 'heat-shield',
    sockets: [],
    visual: 'heat-shield',
    unlock: UNLOCKED,
    tags: ['reentry'],
  },
  {
    id: 'docking-adapter',
    name: 'Docking Adapter',
    description:
      'Androgynous docking ring with guide petals, needed for station rendezvous missions.',
    category: 'docking',
    dryMassKg: 1_500,
    costCredits: 3_000,
    attachesTo: 'docking',
    sockets: [],
    visual: 'docking-adapter',
    unlock: UNLOCKED,
    tags: ['docking'],
  },

  // ---- Details ----
  {
    id: 'rcs-block',
    name: 'RCS Thruster Block',
    description: 'Cold-gas reaction-control thruster pod for fine attitude control.',
    category: 'detail',
    dryMassKg: 400,
    costCredits: 600,
    attachesTo: 'detail',
    rotationStepDeg: 90,
    sockets: [],
    visual: 'rcs-block',
    unlock: UNLOCKED,
    tags: ['rcs'],
  },
  {
    id: 'antenna',
    name: 'Comms Antenna',
    description: 'Low-gain antenna mast for telemetry.',
    category: 'detail',
    dryMassKg: 80,
    costCredits: 300,
    attachesTo: 'detail',
    rotationStepDeg: 90,
    sockets: [],
    visual: 'antenna',
    unlock: UNLOCKED,
    tags: [],
  },
  {
    id: 'access-hatch',
    name: 'Access Hatch',
    description: 'Hinged service hatch for ground-crew access.',
    category: 'detail',
    dryMassKg: 150,
    costCredits: 200,
    attachesTo: 'detail',
    sockets: [],
    visual: 'access-hatch',
    unlock: UNLOCKED,
    tags: [],
  },
  {
    id: 'plumbing-conduit',
    name: 'Chine Conduit',
    description: 'External raceway carrying plumbing and wiring along the hull.',
    category: 'detail',
    dryMassKg: 600,
    costCredits: 400,
    attachesTo: 'detail',
    sockets: [],
    visual: 'plumbing-conduit',
    unlock: UNLOCKED,
    tags: [],
  },
  {
    id: 'solar-array',
    name: 'Deployable Solar Array',
    description: 'Roll-out solar wing for long-duration missions.',
    category: 'detail',
    dryMassKg: 900,
    costCredits: 2_500,
    attachesTo: 'detail',
    sockets: [],
    visual: 'solar-array',
    unlock: {
      unlocked: false,
      reason: 'Research "Long-Duration Power" in the Program panel.',
      techId: 'long-duration-power',
    },
    tags: [],
  },
];

const PART_INDEX = new Map(PARTS.map((p) => [p.id, p]));

export function findPart(id: string): PartDefinition | undefined {
  return PART_INDEX.get(id);
}

export function getPart(id: string): PartDefinition {
  const part = PART_INDEX.get(id);
  if (!part) throw new Error(`Unknown part: ${id}`);
  return part;
}

export const CATEGORY_LABELS: Record<PartDefinition['category'], string> = {
  structure: 'Structure & hull',
  tank: 'Tanks',
  crew: 'Crew & payload',
  propulsion: 'Engines',
  control: 'Steering surfaces',
  landing: 'Landing',
  thermal: 'Thermal protection',
  docking: 'Docking',
  detail: 'Details & systems',
};

export const SOCKET_TYPE_LABELS: Record<SocketType, string> = {
  root: 'the assembly stand',
  'booster-stack': 'a booster stack ring',
  interstage: 'the booster forward ring',
  'ship-base': 'the interstage top ring',
  'ship-stack': 'a ship stack ring',
  engine: 'an engine mount',
  'grid-fin': 'a grid-fin actuator',
  'flap-forward': 'a forward flap hinge',
  'flap-aft': 'an aft flap hinge',
  leg: 'a landing-leg hardpoint',
  'heat-shield': 'a ship section surface',
  detail: 'a detail slot',
  docking: 'a docking port',
};
