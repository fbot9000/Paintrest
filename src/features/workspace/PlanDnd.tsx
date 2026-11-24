/**
 * O-19: dragging in a plan draft. Parts and steps are dragged by their handle (⠿) to a new place,
 * and a paint from the tray (the miniature's palette) onto a step. On a touch screen, where dragging
 * may not work, a paint is tapped and then «+ …» on a step, and parts and steps move with the arrows.
 */
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { PaintProduct } from '../../domain/types';
import { Swatch } from '../../ui/components';

export type Drag =
  | { kind: 'element'; e: number }
  | { kind: 'step'; e: number; s: number }
  | { kind: 'paint'; product: PaintProduct; role_label: string | null };

export interface PlanDnd {
  drag: Drag | null;
  over: string | null;
  /** Props for something that can be dragged. */
  handle: (d: Drag) => { draggable: true; onDragStart: (ev: DragEvent) => void; onDragEnd: () => void };
  /** Props for a part or a step that takes a drop. */
  target: (key: string, accepts: (d: Drag) => boolean, onDrop: (d: Drag) => void) => {
    onDragOver: (ev: DragEvent) => void; onDragLeave: (ev: DragEvent) => void; onDrop: (ev: DragEvent) => void;
  };
  /** The paint tapped in the tray, to add with «+» on a step (touch). */
  picked: { product: PaintProduct; role_label: string | null } | null;
  pick: (x: { product: PaintProduct; role_label: string | null } | null) => void;
}

const TYPE = 'application/x-paintrest-plan';

export function usePlanDnd(): PlanDnd {
  const [drag, setDragState] = useState<Drag | null>(null);
  // Read by the drop handlers, which may run before React has drawn the new state.
  const current = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => { current.current = d; setDragState(d); };
  const [over, setOver] = useState<string | null>(null);
  const [picked, pick] = useState<PlanDnd['picked']>(null);
  return {
    drag, over, picked, pick,
    handle: (d) => ({
      draggable: true,
      onDragStart: (ev) => {
        ev.stopPropagation();
        ev.dataTransfer.setData(TYPE, d.kind);
        ev.dataTransfer.setData('text/plain', '');
        ev.dataTransfer.effectAllowed = d.kind === 'paint' ? 'copy' : 'move';
        // Drag the whole part or step, not only the handle.
        const row = (ev.currentTarget as HTMLElement).closest('[data-drag-row]');
        if (row) ev.dataTransfer.setDragImage(row, 16, 16);
        setDrag(d);
      },
      onDragEnd: () => { setDrag(null); setOver(null); },
    }),
    target: (key, accepts, onDrop) => ({
      onDragOver: (ev) => {
        const d = current.current;
        if (!d || !ev.dataTransfer.types.includes(TYPE) || !accepts(d)) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = d.kind === 'paint' ? 'copy' : 'move';
        setOver(key);
      },
      onDragLeave: (ev) => {
        if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node | null)) setOver((cur) => (cur === key ? null : cur));
      },
      onDrop: (ev) => {
        const d = current.current;
        if (!d || !accepts(d)) return;
        ev.preventDefault();
        ev.stopPropagation();
        onDrop(d);
        setDrag(null);
        setOver(null);
      },
    }),
  };
}

/** The miniature's paints, to drag onto a step, or tap and then «+» on a step. */
export function PaintTray({ paints, dnd }: { paints: { product: PaintProduct; role_label: string | null }[]; dnd: PlanDnd }) {
  if (!paints.length) return null;
  return (
    <div className="plan-tray" role="group" aria-label="Malinger å dra inn i et steg">
      <span className="small muted">Dra en maling til et steg, eller trykk på den og så «+» på steget:</span>
      <div className="plan-tray-paints">
        {paints.map((x) => {
          const on = dnd.picked?.product.id === x.product.id;
          return (
            <button key={x.product.id} type="button" className={`plan-tray-paint ${on ? 'on' : ''}`} aria-pressed={on}
              title={[x.role_label, x.product.manufacturer].filter(Boolean).join(' · ') || undefined}
              onClick={() => dnd.pick(on ? null : x)}
              {...dnd.handle({ kind: 'paint', product: x.product, role_label: x.role_label })}>
              <Swatch hex={x.product.swatch_hex} size={14} />
              {x.product.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
