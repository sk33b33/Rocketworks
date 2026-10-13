import { attachPart } from '../assembly/operations';
import { BLUEPRINT_SCHEMA_VERSION, type RocketBlueprint } from '../model/types';
import { autoCompleteStep, STARTER_GUIDE } from '../tutorial/starterGuide';

/** An empty build: nothing on the assembly stand yet. */
export function createEmptyBlueprint(
  now: string,
  name = 'Starter Heavy Lifter',
  id = 'bp-starter',
): RocketBlueprint {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    nextInstanceNumber: 1,
    parts: [],
    finish: 'brushed',
    role: 'crew',
    certification: null,
  };
}

/** The guided build's starting point: the booster engine section already on the stand. */
export function createStarterBlueprint(now: string, name?: string, id?: string): RocketBlueprint {
  const empty = createEmptyBlueprint(now, name, id);
  const result = attachPart(
    empty,
    'booster-engine-section',
    { parentId: null, socketId: 'stand' },
    now,
  );
  if (!result.ok) throw new Error(result.reason);
  return result.blueprint;
}

/** The finished reference design, produced by running every guide step. */
export function createCompleteStarterDesign(
  now: string,
  name?: string,
  id?: string,
): RocketBlueprint {
  let bp = createEmptyBlueprint(now, name, id);
  for (const step of STARTER_GUIDE) {
    const result = autoCompleteStep(bp, step, now);
    if (!result.ok) throw new Error(`Starter design step "${step.id}" failed: ${result.reason}`);
    bp = result.blueprint;
  }
  return bp;
}
