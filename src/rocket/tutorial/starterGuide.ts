import { findPart, getPart } from '../catalog/parts';
import { compatibleTargets, resolveSocket } from '../assembly/compatibility';
import { attachPart } from '../assembly/operations';
import type { RocketBlueprint, SocketRef } from '../model/types';

/**
 * Guided starter build. Steps are checked independently against the blueprint (no hidden tutorial
 * state), so the checklist stays correct after removals, reloads or free-form building.
 */

export interface GuideStep {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  /** Part(s) the step asks for, in the order the auto-builder uses them. */
  readonly partIds: readonly string[];
  readonly required: boolean;
  isDone(bp: RocketBlueprint): boolean;
  /** Restricts auto-build targets, e.g. ship engines go on the ship aft section only. */
  targetFilter?(ref: SocketRef, bp: RocketBlueprint): boolean;
}

function countParts(bp: RocketBlueprint, partIds: readonly string[]): number {
  return bp.parts.filter((p) => partIds.includes(p.partId)).length;
}

/** Number of `childPartIds` attached directly to any instance of `parentPartId`. */
function countAttachedTo(
  bp: RocketBlueprint,
  parentPartId: string,
  childPartIds: readonly string[],
): number {
  const parents = new Set(bp.parts.filter((p) => p.partId === parentPartId).map((p) => p.id));
  return bp.parts.filter(
    (p) =>
      p.parent.parentId !== null &&
      parents.has(p.parent.parentId) &&
      childPartIds.includes(p.partId),
  ).length;
}

function socketsOfTypeOn(parentPartId: string, type: string): number {
  return getPart(parentPartId).sockets.filter((s) => s.type === type).length;
}

const parentIs = (parentPartId: string) => (ref: SocketRef, bp: RocketBlueprint) =>
  resolveSocket(bp, ref)?.parentPart?.id === parentPartId;

const ENGINES = ['engine-sl', 'engine-vac'];
const SHIP_TANKS = ['ship-tank', 'ship-tank-extended'];
const SHIP_SECTIONS = [
  'ship-aft-section',
  'ship-tank',
  'ship-tank-extended',
  'crew-cabin',
  'cargo-bay',
  'nose-cone',
];
const DETAILS = ['rcs-block', 'antenna', 'access-hatch', 'plumbing-conduit', 'solar-array'];

export const STARTER_GUIDE: readonly GuideStep[] = [
  {
    id: 'booster-base',
    title: 'Place the booster engine section',
    hint: 'Select Booster Engine Section and click the glowing ring on the assembly stand.',
    partIds: ['booster-engine-section'],
    required: true,
    isDone: (bp) => countParts(bp, ['booster-engine-section']) >= 1,
  },
  {
    id: 'booster-engines',
    title: 'Fit 13 engines to the booster',
    hint: 'Select Forge-SL Engine, then use "Fill all" or click each engine mount under the booster.',
    partIds: ['engine-sl'],
    required: true,
    isDone: (bp) =>
      countAttachedTo(bp, 'booster-engine-section', ENGINES) >=
      socketsOfTypeOn('booster-engine-section', 'engine'),
    targetFilter: parentIs('booster-engine-section'),
  },
  {
    id: 'booster-tanks',
    title: 'Stack 3 booster tank sections',
    hint: 'Booster Tank Sections snap onto the top ring of the booster stack, one above the other.',
    partIds: ['booster-tank'],
    required: true,
    isDone: (bp) => countParts(bp, ['booster-tank']) >= 3,
  },
  {
    id: 'booster-forward',
    title: 'Cap the booster with its forward section',
    hint: 'Add the Booster Forward Section on top of the last booster tank.',
    partIds: ['booster-forward-section'],
    required: true,
    isDone: (bp) => countParts(bp, ['booster-forward-section']) >= 1,
  },
  {
    id: 'grid-fins',
    title: 'Mount 4 grid fins',
    hint: 'Grid Fins attach to the four actuators on the booster forward section.',
    partIds: ['grid-fin'],
    required: true,
    isDone: (bp) => countAttachedTo(bp, 'booster-forward-section', ['grid-fin']) >= 4,
  },
  {
    id: 'booster-legs',
    title: 'Add 4 landing legs to the booster',
    hint: 'Landing Legs fit the hardpoints around the booster engine section; needed for recovery.',
    partIds: ['landing-leg'],
    required: true,
    isDone: (bp) => countAttachedTo(bp, 'booster-engine-section', ['landing-leg']) >= 4,
    targetFilter: parentIs('booster-engine-section'),
  },
  {
    id: 'interstage',
    title: 'Install the hot-stage interstage',
    hint: 'The Hot-Stage Interstage Ring sits on the booster forward section.',
    partIds: ['hot-stage-interstage'],
    required: true,
    isDone: (bp) => countParts(bp, ['hot-stage-interstage']) >= 1,
  },
  {
    id: 'ship-aft',
    title: 'Start the ship with its aft section',
    hint: 'The Ship Aft Section goes on top of the interstage.',
    partIds: ['ship-aft-section'],
    required: true,
    isDone: (bp) => countParts(bp, ['ship-aft-section']) >= 1,
  },
  {
    id: 'ship-engines',
    title: 'Fit 6 ship engines',
    hint: 'Select Forge-SL Engine again; the ship engine mounts hang inside the interstage.',
    partIds: ['engine-sl'],
    required: true,
    isDone: (bp) =>
      countAttachedTo(bp, 'ship-aft-section', ENGINES) >=
      socketsOfTypeOn('ship-aft-section', 'engine'),
    targetFilter: parentIs('ship-aft-section'),
  },
  {
    id: 'ship-tanks',
    title: 'Stack 2 ship tank sections',
    hint: 'Ship Tank Sections stack on the ship aft section.',
    partIds: ['ship-tank'],
    required: true,
    isDone: (bp) => countParts(bp, SHIP_TANKS) >= 2,
  },
  {
    id: 'crew-cabin',
    title: 'Add the crew cabin',
    hint: 'The Crew Cabin (with windows) goes above the ship tanks.',
    partIds: ['crew-cabin'],
    required: true,
    isDone: (bp) => countParts(bp, ['crew-cabin']) >= 1,
  },
  {
    id: 'nose',
    title: 'Close the ship with a nose cone',
    hint: 'The Nose Cone tops the ship stack.',
    partIds: ['nose-cone'],
    required: true,
    isDone: (bp) => countParts(bp, ['nose-cone']) >= 1,
  },
  {
    id: 'flaps',
    title: 'Attach 2 forward and 2 aft flaps',
    hint: 'Forward Flaps hinge on the nose; Aft Flaps hinge on the ship aft section.',
    partIds: ['flap-forward', 'flap-aft'],
    required: true,
    isDone: (bp) => countParts(bp, ['flap-forward']) >= 2 && countParts(bp, ['flap-aft']) >= 2,
  },
  {
    id: 'heat-shield',
    title: 'Tile every ship section with heat shield',
    hint: 'Each ship section has one windward tile surface. "Fill all" covers them in one go.',
    partIds: ['heat-shield'],
    required: true,
    isDone: (bp) => {
      const sections = countParts(bp, SHIP_SECTIONS);
      return sections > 0 && countParts(bp, ['heat-shield']) >= sections;
    },
  },
  {
    id: 'docking',
    title: 'Optional: fit a docking adapter',
    hint: 'The Docking Adapter sits on the nose tip; later station missions will need it.',
    partIds: ['docking-adapter'],
    required: false,
    isDone: (bp) => countParts(bp, ['docking-adapter']) >= 1,
  },
  {
    id: 'outfit',
    title: 'Optional: outfit with 2+ detail modules',
    hint: 'RCS blocks, antennas, hatches and conduits fit any detail slot on the hull.',
    partIds: ['rcs-block', 'antenna'],
    required: false,
    isDone: (bp) => countParts(bp, DETAILS) >= 2,
  },
];

export interface GuideProgress {
  readonly steps: readonly { step: GuideStep; done: boolean }[];
  readonly currentStep: GuideStep | null;
  readonly requiredDone: number;
  readonly requiredTotal: number;
  /** 0..1 share of required steps complete: the "build completeness" stat. */
  readonly completeness: number;
}

export function evaluateGuide(
  bp: RocketBlueprint,
  guide: readonly GuideStep[] = STARTER_GUIDE,
): GuideProgress {
  const steps = guide.map((step) => ({ step, done: step.isDone(bp) }));
  const required = steps.filter((s) => s.step.required);
  const requiredDone = required.filter((s) => s.done).length;
  return {
    steps,
    currentStep: steps.find((s) => !s.done)?.step ?? null,
    requiredDone,
    requiredTotal: required.length,
    completeness: required.length === 0 ? 1 : requiredDone / required.length,
  };
}

/** Performs a step for the player, attaching its parts until done or blocked. */
export function autoCompleteStep(
  bp: RocketBlueprint,
  step: GuideStep,
  now: string,
): { ok: true; blueprint: RocketBlueprint; attached: number } | { ok: false; reason: string } {
  let current = bp;
  let attached = 0;
  for (let guard = 0; guard < 64 && !step.isDone(current); guard++) {
    let progressed = false;
    for (const partId of step.partIds) {
      const target = compatibleTargets(current, partId).find(
        (t) => step.targetFilter?.(t.ref, current) ?? true,
      );
      if (!target) continue;
      const result = attachPart(current, partId, target.ref, now);
      if (result.ok) {
        current = result.blueprint;
        attached++;
        progressed = true;
        if (step.isDone(current)) break;
      }
    }
    if (!progressed) break;
  }
  if (step.isDone(current)) return { ok: true, blueprint: current, attached };
  const names = step.partIds.map((id) => findPart(id)?.name ?? id).join(' / ');
  return {
    ok: false,
    reason: `No free attachment point for ${names}. Stack sections build bottom-up: remove the part blocking the stack top, or complete earlier steps first.`,
  };
}
