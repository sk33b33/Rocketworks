import { selectProgram, useGameStore } from '../../app/gameStore';
import { isPartUnlocked } from '../../rocket/assembly/compatibility';
import type { PartDefinition } from '../../rocket/model/types';

/** Lock state that accounts for research progress. */
export function usePartAccess() {
  const program = useGameStore(selectProgram);
  return {
    unlocked: program.unlockedPartIds,
    isUnlocked: (part: PartDefinition) => isPartUnlocked(part, program.unlockedPartIds),
    lockReason: (part: PartDefinition) =>
      isPartUnlocked(part, program.unlockedPartIds) || part.unlock.unlocked
        ? undefined
        : part.unlock.reason,
  };
}
