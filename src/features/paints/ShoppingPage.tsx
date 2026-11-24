import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useCommand, useView } from '../../app/context';
import { KIND_LABEL, OWNERSHIP_LABEL, liveProducts, paintLabel } from '../../domain/paints';
import { PRIORITY_LABEL, SHOPPING_PRIORITIES, projectName, shoppingList, shoppingProjects } from '../../domain/shopping';
import type { ShoppingRow } from '../../domain/shopping';
import type { Id, ShoppingPriority } from '../../domain/types';
import { Badge, Button, ErrorNote, Swatch } from '../../ui/components';
import { Chip } from '../library/parts';
import './paints.css';

/**
 * Handlelisten (O-14): paints the approved plans need and you do not have, and
 * the ones you put on it yourself. One row per paint.
 */
export function ShoppingPage() {
  const [project, setProject] = useState<Id | null>(null);
  const [adding, setAdding] = useState(false);
  const { run, error, clearError } = useCommand();

  const data = useView((t) => {
    const all = shoppingList(t);
    const projects = shoppingProjects(all);
    const shown = project && projects.some((p) => p.id === project) ? project : null;
    const onList = new Set(all.map((r) => r.product.id));
    return {
      all,
      rows: shown ? shoppingList(t, { project_id: shown }) : all,
      shown,
      projects,
      candidates: liveProducts(t).filter((p) => !onList.has(p.id))
        .sort((a, b) => paintLabel(a).localeCompare(paintLabel(b), 'nb')),
      allProjects: Object.values(t.project).filter((p) => !p.deleted_at)
        .map((p) => ({ id: p.id, name: projectName(t, p.id) })).sort((a, b) => a.name.localeCompare(b.name, 'nb')),
    };
  }, [project]);

  const groups = useMemo(() => SHOPPING_PRIORITIES
    .map((priority) => ({ priority, rows: data.rows.filter((r) => r.priority === priority) }))
    .filter((g) => g.rows.length > 0), [data.rows]);

  return (
    <main className="page paints-page shopping-page">
      <div className="page-head">
        <div>
          <span className="eyebrow"><Link to="/malinger">Malinger</Link></span>
          <h1>Handleliste</h1>
          <p className="muted">
            Malinger du ikke har, og som godkjente maleplaner bruker, kommer på listen av seg selv. Du kan også legge til selv.
            «Kjøpt» setter malingen som din.
          </p>
        </div>
        <div className="head-actions">
          <Button variant="primary" icon="+" onClick={() => setAdding(true)}>Legg til maling</Button>
        </div>
      </div>

      <ErrorNote error={error} onClose={clearError} />

      {adding && (
        <AddForm candidates={data.candidates} projects={data.allProjects} defaultProject={data.shown}
          onCancel={() => setAdding(false)}
          onAdd={async (product_id, priority, project_id) => {
            const ok = await run(async (c) => { await c.addToShoppingList(product_id, { priority, project_ids: project_id ? [project_id] : [] }); return true; });
            if (ok) setAdding(false);
          }} />
      )}

      {data.all.length === 0 ? (
        <div className="empty">
          <p>Handlelisten er tom. Ingen godkjent maleplan bruker en maling du ikke har, og du har ikke lagt til noe selv.</p>
        </div>
      ) : (
        <>
          {data.projects.length > 0 && (
            <div className="filters" role="toolbar" aria-label="Filtrer per prosjekt">
              <Chip on={!data.shown} onClick={() => setProject(null)}>Alle <span className="chip-count">{data.all.length}</span></Chip>
              {data.projects.map((p) => (
                <Chip key={p.id} on={data.shown === p.id} onClick={() => setProject(data.shown === p.id ? null : p.id)}>
                  {p.name} <span className="chip-count">{p.count}</span>
                </Chip>
              ))}
            </div>
          )}
          <div className="paint-list">
            {groups.map((g) => (
              <section key={g.priority} className="paint-group" aria-label={PRIORITY_LABEL[g.priority]}>
                <h2 className="paint-group-h">{PRIORITY_LABEL[g.priority]} <span className="chip-count">{g.rows.length}</span></h2>
                <ul>
                  {g.rows.map((r) => (
                    <li key={r.product.id}>
                      <ShoppingLine row={r}
                        onPriority={(p) => run((c) => c.setShoppingPriority(r.product.id, p))}
                        onBought={() => run((c) => c.markPurchased([r.product.id]))}
                        onRemove={() => run((c) => c.removeFromShoppingList(r.product.id))} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function why(r: ShoppingRow): string {
  const parts: string[] = [];
  if (r.plans.length) {
    const names = r.plans.map((p) => `${p.name} (${r.projects.find((x) => x.id === p.project_id)?.name ?? ''})`);
    parts.push(`Maleplanen for ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` og ${names.length - 3} til` : ''}`);
  }
  if (r.manual) {
    const own = r.projects.filter((p) => !r.plans.some((x) => x.project_id === p.id)).map((p) => p.name);
    parts.push(own.length ? `Lagt til av deg, for ${own.join(', ')}` : 'Lagt til av deg');
  }
  return parts.join(' · ');
}

function ShoppingLine({ row, onPriority, onBought, onRemove }: {
  row: ShoppingRow; onPriority: (p: ShoppingPriority) => void; onBought: () => void; onRemove: () => void;
}) {
  const p = row.product;
  return (
    <div className="paint-line shopping-line">
      <span className="paint-swatch"><Swatch hex={p.swatch_hex} size={28} /></span>
      <div className="paint-line-main shopping-main">
        <span className="paint-line-name">
          <strong>{paintLabel(p)}</strong>
          {p.product_code && <span className="mono small muted">{p.product_code}</span>}
          {row.ownership === 'unknown' && <Badge tone="warn">Ukjent om du har den</Badge>}
          {row.ownership === 'owns' && <Badge tone="moss">{OWNERSHIP_LABEL.owns}</Badge>}
        </span>
        <span className="small muted">{KIND_LABEL[p.product_kind]} · {why(row)}</span>
        {row.need?.note && <span className="small">{row.need.note}</span>}
      </div>
      <div className="shopping-actions">
        <select className="prio-select" value={row.priority} aria-label={`Prioritet for ${p.name}`}
          onChange={(e) => onPriority(e.target.value as ShoppingPriority)}>
          {SHOPPING_PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}
        </select>
        <Button onClick={onBought} aria-label={`Kjøpt: ${p.name}`}>Kjøpt</Button>
        {row.manual && !row.plans.length && (
          <button type="button" className="link" onClick={onRemove} aria-label={`Fjern ${p.name} fra handlelisten`}>Fjern</button>
        )}
      </div>
    </div>
  );
}

function AddForm({ candidates, projects, defaultProject, onAdd, onCancel }: {
  candidates: { id: Id; name: string; manufacturer: string | null; range_name: string | null }[];
  projects: { id: Id; name: string }[];
  defaultProject: Id | null;
  onAdd: (product_id: Id, priority: ShoppingPriority, project_id: Id | null) => void;
  onCancel: () => void;
}) {
  const [product, setProduct] = useState<Id>('');
  const [priority, setPriority] = useState<ShoppingPriority>('recommended');
  const [project, setProject] = useState<Id>(defaultProject ?? '');
  return (
    <form className="paint-add shopping-add card" onSubmit={(e) => { e.preventDefault(); if (product) onAdd(product, priority, project || null); }}>
      <div className="paint-form-grid">
        <div className="pf-field pf-name">
          <label htmlFor="sh-product">Maling</label>
          <select id="sh-product" value={product} required onChange={(e) => setProduct(e.target.value)}>
            <option value="">Velg en maling fra samlingen …</option>
            {candidates.map((p) => <option key={p.id} value={p.id}>{paintLabel(p)}</option>)}
          </select>
        </div>
        <div className="pf-field">
          <label htmlFor="sh-prio">Prioritet</label>
          <select id="sh-prio" value={priority} onChange={(e) => setPriority(e.target.value as ShoppingPriority)}>
            {SHOPPING_PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}
          </select>
        </div>
        <div className="pf-field">
          <label htmlFor="sh-project">Prosjekt</label>
          <select id="sh-project" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Ingen bestemt</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <p className="small muted">Finnes ikke malingen i samlingen? <Link to="/malinger">Legg den inn</Link> først, gjerne som «Har ikke».</p>
      <div className="head-actions">
        <Button type="button" onClick={onCancel}>Avbryt</Button>
        <Button type="submit" variant="primary" disabled={!product}>Legg på listen</Button>
      </div>
    </form>
  );
}
