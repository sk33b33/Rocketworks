import { CATEGORY_LABELS, SOCKET_TYPE_LABELS } from '../../rocket/catalog/parts';
import type { PartDefinition, SocketType } from '../../rocket/model/types';
import { formatCredits, formatForce, formatMass } from '../format';

/** Readable part specification table shared by catalog selection and placed-part inspection. */
export function PartFacts({ part }: { part: PartDefinition }) {
  const socketCounts = new Map<SocketType, number>();
  for (const s of part.sockets) socketCounts.set(s.type, (socketCounts.get(s.type) ?? 0) + 1);
  return (
    <>
      <div className="eyebrow">{CATEGORY_LABELS[part.category]}</div>
      <h3 className="part-name">{part.name}</h3>
      {!part.unlock.unlocked && (
        <p className="locked-banner" role="note">
          🔒 Locked. {part.unlock.reason}
        </p>
      )}
      <p className="part-desc">{part.description}</p>
      <dl className="facts">
        <dt>Dry mass</dt>
        <dd>{formatMass(part.dryMassKg)}</dd>
        {part.propellantCapacityKg ? (
          <>
            <dt>Propellant</dt>
            <dd>{formatMass(part.propellantCapacityKg)}</dd>
          </>
        ) : null}
        {part.thrustN ? (
          <>
            <dt>Thrust (sea level)</dt>
            <dd>{formatForce(part.thrustN)}</dd>
          </>
        ) : null}
        {part.crewCapacity ? (
          <>
            <dt>Crew seats</dt>
            <dd>{part.crewCapacity}</dd>
          </>
        ) : null}
        <dt>Cost</dt>
        <dd>{formatCredits(part.costCredits)}</dd>
        <dt>Attaches to</dt>
        <dd>{SOCKET_TYPE_LABELS[part.attachesTo]}</dd>
        {socketCounts.size > 0 && (
          <>
            <dt>Provides</dt>
            <dd>
              {[...socketCounts]
                .map(([type, n]) => `${n}× ${SOCKET_TYPE_LABELS[type].replace(/^(a|an|the) /, '')}`)
                .join(', ')}
            </dd>
          </>
        )}
        <dt>Rotation</dt>
        <dd>{part.rotationStepDeg ? `${part.rotationStepDeg}° steps` : 'Fixed'}</dd>
      </dl>
    </>
  );
}
