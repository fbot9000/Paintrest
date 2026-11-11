import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApp, useCommand, useView } from '../../app/context';
import { KIND_LABEL, OWNERSHIP_LABEL, hiddenProducts, makersIn, normText, paintCounts, paintLabel, paintRows, productUsage, sampleProducts, usageDetail, usageText } from '../../domain/paints';
import type { OwnershipFilter, PaintRow } from '../../domain/paints';
import type { Id, Ownership, PaintProduct } from '../../domain/types';
import { Badge, Button, Dialog, ErrorNote, Swatch } from '../../ui/components';
import { Chip, SearchBox } from '../library/parts';
import { EMPTY_PAINT, PaintForm, valueOf } from './PaintForm';
import type { PaintValue } from './PaintForm';
import { useImport } from './importStore';
import './paints.css';

const FILTERS: { value: OwnershipFilter; label: string }[] = [
  { value: 'owns', label: 'Har' }, { value: 'not_owned', label: 'Har ikke' }, { value: 'unknown', label: 'Ukjent' }, { value: 'all', label: 'Alle' },
];

/**
 * Malingssamlingen: every paint in the catalogue and whether you have it.
 * Add one at a time here, or import a whole list with the AI.
 */
export function PaintsPage() {
  const [query, setQuery] = useState('');
  const [own, setOwn] = useState<OwnershipFilter>('all');
  const [maker, setMaker] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Id | null>(null);
  const [purge, setPurge] = useState<Id[] | null>(null);
  const { run, error, clearError } = useCommand();
  const draft = useImport().draft;

  const data = useView((t) => {
    const samples = sampleProducts(t);
    return {
      rows: paintRows(t, { query, ownership: own, maker }),
      counts: paintCounts(t),
      makers: makersIn(t),
      hidden: hiddenProducts(t),
      samples,
      sampleUsage: usageText(productUsage(t, samples.map((p) => p.id))),
    };
  }, [query, own, maker]);

  const groups = useMemo(() => {
    const out: { maker: string; rows: PaintRow[] }[] = [];
    for (const r of data.rows) {
      const name = r.product.manufacturer?.trim() || 'Uten produsent';
      const last = out.at(-1);
      if (last && last.maker.toLowerCase() === name.toLowerCase()) last.rows.push(r);
      else out.push({ maker: name, rows: [r] });
    }
    return out;
  }, [data.rows]);

  const add = async (v: PaintValue, estimated: boolean): Promise<string | null> => {
    const sum = await run((c) => c.importProducts([{ ...input(v), swatch_estimated: estimated, confirmed: true }], { source: 'manual' }));
    if (!sum) return null;
    const label = paintLabel({ manufacturer: v.manufacturer.trim() || null, range_name: v.range_name.trim() || null, name: v.name.trim() });
    if (sum.created) return `Lagt til: ${label}.`;
    if (sum.restored) return `Tatt i bruk igjen: ${label}.`;
    return `Fantes fra før, oppdatert: ${label}.`;
  };

  const empty = data.counts.all === 0;

  return (
    <main className="page paints-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Malinger</span>
          <h1>Malingssamlingen</h1>
          <p className="muted">
            {empty ? 'Malingene du har, og dem du vil ha. Agenten bruker listen når den lager maleplaner og oppskrifter.'
              : `${data.counts.owns} du har · ${data.counts.not_owned} du ikke har · ${data.counts.unknown} ukjent`}
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-secondary" to="import">{draft ? 'Fortsett importen' : 'Importer en liste'}</Link>
          <Button variant="primary" icon="+" onClick={() => { setAdding(true); setEditing(null); }}>Legg til maling</Button>
        </div>
      </div>
      <ErrorNote error={error} onClose={clearError} />

      {data.samples.length > 0 && (
        <section className="sample-banner" aria-labelledby="sample-h">
          <div>
            <h2 id="sample-h">Eksempelmalinger fra testdataene</h2>
            <p>
              {data.samples.length} malinger kom med eksempeldataene, ikke fra deg
              ({data.samples.slice(0, 4).map((p) => p.name).join(', ')}{data.samples.length > 4 ? ' …' : ''}).
              {data.sampleUsage ? ` De brukes i ${data.sampleUsage}.` : ''}
            </p>
            <p className="small muted">
              Fjerner du dem, skjules de og står ikke lenger som dine. Planer og oppskrifter som bruker dem, beholder dem.
              Legger du inn den samme malingen selv senere, tas den i bruk igjen, og planene peker da på din.
            </p>
          </div>
          <Button variant="primary" onClick={() => run((c) => c.removeSampleProducts())}>Fjern eksempelmalingene</Button>
        </section>
      )}

      {adding && (
        <section className="card paint-add" aria-label="Legg til maling">
          <h2>Legg til maling</h2>
          <PaintForm mode="add" initial={EMPTY_PAINT} onSave={add} onCancel={() => setAdding(false)} />
        </section>
      )}

      {draft && (
        <p className="import-pending small">
          Du har en import som ikke er lagret ennå ({draft.rows.filter((r) => r.include).length} malinger). <Link to="import">Fortsett importen</Link>
        </p>
      )}

      {empty && !adding ? (
        <div className="empty paints-empty">
          <h2>Ingen malinger ennå</h2>
          <p className="muted">Legg dem inn en og en, eller lim inn en liste du har (et regneark, en ordrebekreftelse, notater). AI-en leser listen og spør når noe er uklart.</p>
          <div className="head-actions">
            <Button onClick={() => setAdding(true)}>Legg til en og en</Button>
            <Link className="btn btn-primary" to="import">Importer en liste</Link>
          </div>
        </div>
      ) : !empty && (
        <>
          <SearchBox value={query} onChange={setQuery} label="Søk i malingene" placeholder="Søk etter navn, produsent, serie, type eller kode" />
          <div className="filters" role="toolbar" aria-label="Filtrer">
            {FILTERS.map((f) => (
              <Chip key={f.value} on={own === f.value} onClick={() => setOwn(f.value)}>
                {f.label} <span className="chip-count">{data.counts[f.value]}</span>
              </Chip>
            ))}
            {data.makers.length > 1 && <span className="filters-sep" />}
            {data.makers.length > 1 && data.makers.map((m) => (
              <Chip key={m.key} on={maker === m.key} onClick={() => setMaker(maker === m.key ? null : m.key)}>
                {m.name} <span className="chip-count">{m.count}</span>
              </Chip>
            ))}
          </div>

          {data.rows.length === 0 ? <p className="muted">Ingen malinger passer søket eller filteret.</p> : (
            <div className="paint-list">
              {groups.map((g) => (
                <section key={g.maker} className="paint-group" aria-label={g.maker}>
                  <h2 className="paint-group-h">{g.maker} <span className="chip-count">{g.rows.length}</span></h2>
                  <ul>
                    {g.rows.map((r) => (
                      <li key={r.product.id} className={editing === r.product.id ? 'open' : ''}>
                        {editing === r.product.id ? (
                          <PaintForm mode="edit" productId={r.product.id} initial={valueOf(r.product, r.ownership)}
                            onCancel={() => setEditing(null)}
                            onDelete={async () => { if (await run(async (c) => { await c.deleteProduct(r.product.id); return true; })) setEditing(null); }}
                            onSave={async (v, estimated) => {
                              const ok = await run(async (c) => {
                                const p = r.product;
                                const sameHex = v.swatch_hex === p.swatch_hex;
                                await c.updateProduct(p.id, {
                                  name: v.name, manufacturer: v.manufacturer, range_name: v.range_name, product_code: v.product_code,
                                  product_kind: v.product_kind, finish: v.finish,
                                  ...(sameHex ? {} : { swatch_hex: v.swatch_hex, swatch_estimated: estimated }),
                                  identity_status: v.manufacturer.trim() ? 'confirmed' : p.identity_status,
                                });
                                if (v.ownership !== r.ownership) await c.setOwnership(p.id, v.ownership);
                                return true;
                              });
                              if (!ok) return null;
                              setEditing(null);
                              return '';
                            }} />
                        ) : <PaintLine row={r} onEdit={() => { setEditing(r.product.id); setAdding(false); }}
                          onOwn={(o) => run((c) => c.setOwnership(r.product.id, o))} />}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {data.hidden.length > 0 && (
        <details className="paint-hidden">
          <summary>Skjulte malinger ({data.hidden.length})</summary>
          <p className="small muted">
            Skjulte malinger vises ikke i samlingen og når du velger maling. Planer og oppskrifter som bruker dem, beholder dem.
            «Slett for godt» fjerner malingen helt, også fra planene og oppskriftene.
          </p>
          <ul>
            {data.hidden.map((p) => (
              <li key={p.id}>
                <Swatch hex={p.swatch_hex} /> <span>{paintLabel(p)}</span>
                <button type="button" className="link" aria-label={`Gjenopprett ${p.name}`} onClick={() => run((c) => c.restoreProduct(p.id))}>Gjenopprett</button>
                <button type="button" className="link link-danger" aria-label={`Slett ${p.name} for godt`} onClick={() => setPurge([p.id])}>Slett for godt</button>
              </li>
            ))}
          </ul>
          {data.hidden.length > 1 && (
            <Button variant="danger" onClick={() => setPurge(data.hidden.map((p) => p.id))}>Slett alle {data.hidden.length} for godt</Button>
          )}
        </details>
      )}
      {purge && <PurgeDialog ids={purge} onClose={() => setPurge(null)} />}
    </main>
  );
}

/** «Slett for godt»: says exactly what changes, and that a backup is taken first. */
function PurgeDialog({ ids, onClose }: { ids: Id[]; onClose: () => void }) {
  const { store } = useApp();
  const { run, error, busy } = useCommand();
  const info = useView((t) => ({
    paints: ids.flatMap((id) => (t.paint_product[id] ? [t.paint_product[id]!] : [])),
    usage: usageDetail(t, ids),
  }), [ids.join()]);
  const n = info.paints.length;
  const list = (xs: string[]) => (xs.length <= 6 ? xs.join(', ') : `${xs.slice(0, 6).join(', ')} og ${xs.length - 6} til`);
  const used = info.usage.plans.length + info.usage.recipes.length + info.usage.palettes.length > 0;
  return (
    <Dialog open onClose={onClose} title={n === 1 ? `Slette ${info.paints[0]?.name ?? 'malingen'} for godt?` : `Slette ${n} malinger for godt?`}
      footer={<>
        <Button onClick={onClose}>Avbryt</Button>
        <Button variant="danger" disabled={busy || n === 0} onClick={async () => {
          if (await run((c) => c.purgeProducts(ids)) !== undefined) onClose();
        }}>{busy ? 'Sletter …' : 'Slett for godt'}</Button>
      </>}>
      {n > 1 && <ul className="purge-list">{info.paints.map((p) => <li key={p.id}><Swatch hex={p.swatch_hex} /> {paintLabel(p)}</li>)}</ul>}
      {used ? (
        <div className="purge-usage">
          <p>{n === 1 ? 'Malingen' : 'Malingene'} fjernes også fra:</p>
          <ul>
            {info.usage.plans.length > 0 && <li>maleplanen for {list(info.usage.plans)}</li>}
            {info.usage.recipes.length > 0 && <li>{info.usage.recipes.length === 1 ? 'oppskriften' : 'oppskriftene'} {list(info.usage.recipes)}</li>}
            {info.usage.palettes.length > 0 && <li>paletten for {list(info.usage.palettes)}</li>}
          </ul>
          <p className="small muted">Stegene og oppskriftene blir stående med teksten sin, bare uten {n === 1 ? 'denne malingen' : 'disse malingene'}. Avvik som allerede er lagret som ferdigmalt, blir stående som historikk.</p>
        </div>
      ) : <p>{n === 1 ? 'Malingen' : 'Malingene'} brukes ikke i noen plan, oppskrift eller palett.</p>}
      <p className="small muted">
        Det kan ikke angres i appen.
        {store.persistence.kind === 'server' ? ' Det tas en sikkerhetskopi av datamappen først (backups/).' : ' Dataene ligger i nettleseren, så det tas ingen sikkerhetskopi.'}
      </p>
      <ErrorNote error={error} />
    </Dialog>
  );
}

function input(v: PaintValue) {
  return {
    manufacturer: v.manufacturer.trim() || null, range_name: v.range_name.trim() || null, name: v.name.trim(),
    product_code: v.product_code.trim() || null, product_kind: v.product_kind, finish: v.finish.trim() || null,
    swatch_hex: v.swatch_hex, ownership: v.ownership,
  };
}

/** «Model Color · Layer · matt»; the type is left out when the range already says it («Base · Base»). */
function details(p: PaintProduct): string {
  const kind = KIND_LABEL[p.product_kind];
  const sameAsRange = !!p.range_name && normText(kind).split(' ').includes(normText(p.range_name));
  return [p.range_name, sameAsRange || p.product_kind === 'other' && p.range_name ? null : kind, p.finish].filter(Boolean).join(' · ');
}

function PaintLine({ row, onEdit, onOwn }: { row: PaintRow; onEdit: () => void; onOwn: (o: Ownership) => void }) {
  const p = row.product;
  return (
    <div className="paint-line">
      <span className="paint-swatch" title={p.swatch_hex ? (p.swatch_estimated ? `Omtrentlig farge (anslått av AI-en): ${p.swatch_hex}` : p.swatch_hex) : 'Ingen farge'}>
        <Swatch hex={p.swatch_hex} size={28} />
        {p.swatch_estimated && <span className="swatch-est" aria-label="omtrentlig farge">≈</span>}
      </span>
      <button type="button" className="paint-line-main" onClick={onEdit} aria-label={`Rediger ${paintLabel(p)}`}>
        <span className="paint-line-name">
          <strong>{p.name}</strong>
          {p.product_code && <span className="mono small muted">{p.product_code}</span>}
          {p.identity_status === 'unconfirmed' && <Badge tone="warn">Ubekreftet</Badge>}
        </span>
        <span className="small muted">{details(p)}</span>
      </button>
      <select className={`own-select own-${row.ownership}`} value={row.ownership} aria-label={`Har du ${p.name}?`}
        onChange={(e) => onOwn(e.target.value as Ownership)}>
        {(['owns', 'not_owned', 'unknown'] as Ownership[]).map((o) => <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>)}
      </select>
    </div>
  );
}
