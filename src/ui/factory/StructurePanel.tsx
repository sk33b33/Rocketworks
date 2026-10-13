import { useState } from 'react';
import { selectProgram, useGameStore } from '../../app/gameStore';
import { canAttach, STAND_SOCKET } from '../../rocket/assembly/compatibility';
import { findPart, PARTS } from '../../rocket/catalog/parts';
import type { PartInstance, RocketBlueprint, SocketRef } from '../../rocket/model/types';
import { formatCredits } from '../format';

const refKey = (ref: SocketRef) => `${ref.parentId ?? 'stand'}/${ref.socketId}`;

interface NodeProps {
  readonly bp: RocketBlueprint;
  readonly openSlot: string | null;
  readonly setOpenSlot: (key: string | null) => void;
}

/** Free attachment point with an inline list of parts that fit there. */
function FreeSlot({
  bp,
  socketRef,
  label,
  openSlot,
  setOpenSlot,
}: NodeProps & { socketRef: SocketRef; label: string }) {
  const attach = useGameStore((s) => s.attachPartTo);
  const unlocked = useGameStore(selectProgram).unlockedPartIds;
  const key = refKey(socketRef);
  const open = openSlot === key;
  const options = open ? PARTS.filter((p) => canAttach(bp, p.id, socketRef, unlocked).ok) : [];
  return (
    <li className="slot">
      <button
        type="button"
        className="slot-btn"
        aria-expanded={open}
        onClick={() => setOpenSlot(open ? null : key)}
      >
        ＋ {label} <span className="muted">(empty)</span>
      </button>
      {open && (
        <ul className="slot-options" aria-label={`Parts that fit ${label}`}>
          {options.length === 0 && <li className="muted">No unlocked part fits here.</li>}
          {options.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  if (attach(p.id, socketRef)) setOpenSlot(null);
                }}
              >
                {p.name} <span className="muted">{formatCredits(p.costCredits)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Stack connectors continue the main column instead of nesting deeper. */
const isStackSocket = (type: string) =>
  ['booster-stack', 'interstage', 'ship-base', 'ship-stack'].includes(type);

function InstanceNode({ bp, inst, ...rest }: NodeProps & { inst: PartInstance }) {
  const selection = useGameStore((s) => s.selection);
  const select = useGameStore((s) => s.selectInstance);
  const part = findPart(inst.partId);
  if (!part) return null;
  const selected = selection?.kind === 'instance' && selection.instanceId === inst.id;
  const children = bp.parts.filter((p) => p.parent.parentId === inst.id);
  const attachments = part.sockets.filter((sk) => !isStackSocket(sk.type));
  return (
    <li>
      <button
        type="button"
        className={`node-btn ${selected ? 'active' : ''}`}
        aria-pressed={selected}
        onClick={() => select(inst.id)}
      >
        {part.name}
        {inst.rotationDeg ? <span className="muted"> · {inst.rotationDeg}°</span> : null}
      </button>
      {attachments.length > 0 && (
        <ul>
          {attachments.map((socket) => {
            const child = children.find((c) => c.parent.socketId === socket.id);
            return child ? (
              <InstanceNode key={socket.id} bp={bp} inst={child} {...rest} />
            ) : (
              <FreeSlot
                key={socket.id}
                bp={bp}
                socketRef={{ parentId: inst.id, socketId: socket.id }}
                label={socket.name}
                {...rest}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** The main stack from the stand upward, plus the free stack ring at the top (if any). */
function stackChain(bp: RocketBlueprint): {
  sections: PartInstance[];
  openTop: { ref: SocketRef; label: string } | null;
} {
  const sections: PartInstance[] = [];
  let current = bp.parts.find((p) => p.parent.parentId === null);
  let openTop: { ref: SocketRef; label: string } | null = null;
  while (current) {
    sections.push(current);
    const def = findPart(current.partId);
    const stackSocket = def?.sockets.find((sk) => isStackSocket(sk.type));
    if (!stackSocket) break;
    const id: string = current.id;
    const next = bp.parts.find(
      (p) => p.parent.parentId === id && p.parent.socketId === stackSocket.id,
    );
    if (!next)
      openTop = {
        ref: { parentId: id, socketId: stackSocket.id },
        label: `${def!.name} › ${stackSocket.name}`,
      };
    current = next;
  }
  return { sections, openTop };
}

/**
 * List-based assembly: the whole vehicle as a nested list. Every free attachment point can be filled
 * from here without the 3D view (keyboard and screen-reader friendly).
 */
export function StructurePanel() {
  const bp = useGameStore((s) => s.blueprint);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const { sections, openTop } = stackChain(bp);
  const slotProps = { bp, openSlot, setOpenSlot };
  return (
    <div className="structure">
      <p className="hint">
        Every part and attachment point. Select a part to inspect it, or open an empty point to add
        a part.
      </p>
      <ol className="tree" aria-label="Main stack, bottom to top">
        {sections.length === 0 && (
          <FreeSlot
            {...slotProps}
            socketRef={{ parentId: null, socketId: STAND_SOCKET.id }}
            label={STAND_SOCKET.name}
          />
        )}
        {sections.map((inst) => (
          <InstanceNode key={inst.id} inst={inst} {...slotProps} />
        ))}
        {openTop && <FreeSlot {...slotProps} socketRef={openTop.ref} label={openTop.label} />}
      </ol>
    </div>
  );
}
