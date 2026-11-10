/**
 * Palett for miniatyren (datamodell v3 §8): the paints used, grouped by part,
 * with role. Edited directly; the plan's own steps are not changed by this.
 */
import { useState } from 'react';
import { useCommand, useView } from '../../app/context';
import type { PaintPlanPayload } from '../../domain/agent';
import type { MiniatureSubject, Tables } from '../../domain/types';
import { subjectPalette } from '../../domain/views';
import type { PaletteView } from '../../domain/views';
import { Button, ErrorNote, InlineText, OwnershipFlag, ProductName, Swatch } from '../../ui/components';

function view(t: Tables, s: MiniatureSubject) {
  const palette = subjectPalette(t, s);
  const openTasks = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === s.project_id).map((x) => x.id));
  const pendingPalette = Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && (p.result_type === 'paint_plan' || p.result_type === 'plan_revision') && openTasks.has(p.task_id)
      && (p.payload as PaintPlanPayload).subject_id === s.id)
    .reduce((n, p) => n + ((p.payload as PaintPlanPayload).palette?.length ?? 0), 0);
  return {
    own: palette.filter((p) => !p.project_wide),
    shared: palette.filter((p) => p.project_wide),
    pendingPalette,
    products: Object.values(t.paint_product).filter((p) => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'nb')),
  };
}

export function PaletteTab({ subject: s }: { subject: MiniatureSubject }) {
  const data = useView((t) => view(t, s), [s]);
  const { run, error, clearError } = useCommand();
  const [productId, setProductId] = useState('');
  const [part, setPart] = useState('');
  const [role, setRole] = useState('');

  const groups = new Map<string, PaletteView[]>();
  for (const p of data.own) groups.set(p.entry.note ?? 'Uten del', [...(groups.get(p.entry.note ?? 'Uten del') ?? []), p]);

  return (
    <div className="wspal">
      <div className="ws-toolbar">
        <div>
          <h2>Palett</h2>
          <p className="small muted">Malingene {s.name} males med, gruppert per del. Maleplanen fyller paletten når den godkjennes; her kan du justere den selv.</p>
        </div>
      </div>
      <ErrorNote error={error} onClose={clearError} />
      {data.pendingPalette > 0 && <p className="ws-note">Forslaget i Maleplan-fanen har {data.pendingPalette} malinger. De legges i paletten når du godkjenner planen.</p>}

      {data.own.length === 0 ? (
        <div className="ws-empty"><p>Paletten er tom.</p><p className="small muted">Lag en maleplan med AI, eller legg til malinger nedenfor.</p></div>
      ) : (
        [...groups].map(([name, rows]) => (
          <section key={name} className="wspal-group">
            <h3 className="eyebrow">{name}</h3>
            <ul>
              {rows.map((p) => (
                <li key={p.entry.id}>
                  <Swatch hex={p.product.swatch_hex} size={36} />
                  <span className="wspal-name">
                    <ProductName product={p.product} />
                    <span className="small">
                      <InlineText label="Rolle" value={p.entry.role_label ?? '—'} onSave={(v) => run((c) => c.updatePaletteEntry(p.entry.id, { role_label: v === '—' ? null : v }))} />
                    </span>
                  </span>
                  <OwnershipFlag ownership={p.ownership} />
                  <span className="wspal-actions">
                    <InlineText label="Del" value={p.entry.note ?? 'Uten del'} onSave={(v) => run((c) => c.updatePaletteEntry(p.entry.id, { part: v === 'Uten del' ? null : v }))} />
                    <button type="button" className="link small" onClick={() => run((c) => c.removePaletteEntry(p.entry.id))}>Fjern</button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {data.shared.length > 0 && (
        <section className="wspal-group">
          <h3 className="eyebrow">Fra prosjektets felles palett</h3>
          <ul>
            {data.shared.map((p) => (
              <li key={p.entry.id}>
                <Swatch hex={p.product.swatch_hex} size={28} />
                <span className="wspal-name"><ProductName product={p.product} /><span className="small muted">{p.entry.role_label ?? ''}</span></span>
                <OwnershipFlag ownership={p.ownership} />
                <span />
              </li>
            ))}
          </ul>
        </section>
      )}

      <form className="wspal-add" onSubmit={(e) => {
        e.preventDefault();
        if (!productId) return;
        run((c) => c.addPaletteEntry(s.id, productId, { part, role_label: role })).then(() => { setProductId(''); setRole(''); });
      }}>
        <h3 className="eyebrow">Legg til maling</h3>
        <select aria-label="Maling" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Velg maling …</option>
          {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.manufacturer ? ` (${p.manufacturer})` : ''}</option>)}
        </select>
        <input aria-label="Del" placeholder="Del, for eksempel Kappe" value={part} onChange={(e) => setPart(e.target.value)} />
        <input aria-label="Rolle" placeholder="Rolle, for eksempel skygge" value={role} onChange={(e) => setRole(e.target.value)} />
        <Button variant="primary" type="submit" disabled={!productId}>Legg til</Button>
      </form>
    </div>
  );
}
