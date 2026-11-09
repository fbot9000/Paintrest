/**
 * Painting Mode (spesifikasjon §5, datamodell v3 §14, skjema §9).
 * iPad-first: landscape with references on ~1/3 and the plan on ~2/3.
 * Decisions are already made here; the only writes are progress,
 * deviations and completions — all user commands.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useCommand, useView } from '../../app/context';
import type { DeviationKind, Id, LocalDeviation, PaintProduct, Tables } from '../../domain/types';
import { ownershipOf, paintingView, productList } from '../../domain/views';
import type { ElementView, MaterialView, PaintingView, StepView } from '../../domain/views';
import { Logo } from '../../ui/Logo';
import {
  Badge, Button, Dialog, ErrorNote, Field, FileImage, OwnershipFlag, ProductName, Segmented, Stepper, Swatch,
} from '../../ui/components';
import './painting.css';

const ROLE_LABEL: Record<string, string> = {
  base: 'Base', shade: 'Shade', layer: 'Lag', highlight: 'Høylys', wash: 'Wash', glaze: 'Glasur', mix: 'Blanding', other: 'Annet',
};

export function PaintingMode() {
  const { subjectId = '' } = useParams();
  const view = useView((t) => paintingView(t, subjectId), [subjectId]);
  const products = useView(liveProducts);
  const { run, error, clearError } = useCommand();
  const [openId, setOpenId] = useState<Id | null>(null);
  const [refIndex, setRefIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [deviationFor, setDeviationFor] = useState<{ element: ElementView; step: StepView | null } | null>(null);

  // Reopen the part the user had open last time (datamodell v3 §14 «sist åpnede del»).
  useEffect(() => {
    if (view?.last_opened_element_id && openId === null) setOpenId(view.last_opened_element_id);
    // only on first load for this subject
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  if (!view) {
    return <main className="pm-missing"><h1>Fant ikke miniatyren</h1><Link to="/">Til prosjektene</Link></main>;
  }

  const open = view.elements.find((e) => e.element.id === openId) ?? null;
  const openIndex = open ? view.elements.indexOf(open) : -1;
  const s = view.subject;
  const left = s.physical_count - s.finished_count;
  const isGroup = s.grouping === 'group';

  const select = (id: Id | null) => {
    setOpenId(id);
    if (id) run((c) => c.openPart(s.id, id));
  };

  return (
    <div className="pm">
      <header className="pm-bar">
        <Link to={`/p/${view.project.id}/miniatyrer`} className="pm-back" aria-label="Tilbake til miniatyrene">
          <Logo size={20} /> <span>←</span>
        </Link>
        <div className="pm-title">
          <span className="eyebrow">{view.game.primary_name}{view.plan ? ` · plan v${view.plan.version_number}` : ''}</span>
          <h1>{s.name}</h1>
        </div>
        <div className="pm-bar-actions">
          <span className="pm-count mono" aria-label="Ferdigmalt">{s.finished_count}/{s.physical_count}</span>
          {left > 0 && (
            <button
              type="button"
              className={`pm-toggle ${s.in_progress ? 'on' : ''}`}
              aria-pressed={s.in_progress}
              onClick={() => run((c) => c.setInProgress(s.id, !s.in_progress))}
            >
              {s.in_progress ? '✓ Påbegynt' : 'Merk påbegynt'}
            </button>
          )}
          <Button variant="moss" onClick={() => setListOpen(true)} disabled={!view.elements.length}>Finn fram malingene</Button>
          <Button variant="primary" onClick={() => setFinishOpen(true)} disabled={left === 0 || !view.plan}>
            {left === 0 ? 'Ferdig ✓' : isGroup ? 'Marker ferdige' : 'Marker ferdig'}
          </Button>
        </div>
      </header>
      <ErrorNote error={error} onClose={clearError} />

      <div className="pm-body">
        <References view={view} index={refIndex} onIndex={setRefIndex} onZoom={() => setZoom(true)} />

        <section className="pm-plan" aria-label="Maleplan">
          {!view.plan || view.elements.length === 0 ? (
            <div className="pm-empty">
              <h2>Planen er tom</h2>
              <p className="muted">Redigering av maleplanen kommer i bit 4. Eksempelprosjektet har ferdige planer for Merlin og Druid Champions.</p>
            </div>
          ) : open ? (
            <PartDetail
              ev={open}
              isGroup={isGroup}
              physical={s.physical_count}
              onBack={() => select(null)}
              onPrev={openIndex > 0 ? () => select(view.elements[openIndex - 1]!.element.id) : undefined}
              onNext={openIndex < view.elements.length - 1 ? () => select(view.elements[openIndex + 1]!.element.id) : undefined}
              onDone={(done) => run((c) => c.setPartDone(s.id, open.element.id, done))}
              onGroupCount={(n) => run((c) => c.setGroupProgress(s.id, open.element.id, n))}
              onDeviation={(step) => setDeviationFor({ element: open, step })}
              onRemoveDeviation={(id) => run((c) => c.deleteDeviation(id))}
            />
          ) : (
            <Overview view={view} onOpen={select} />
          )}
        </section>
      </div>

      {zoom && view.references[refIndex] && (
        <div className="pm-zoom" role="dialog" aria-label="Forstørret referanse" onClick={() => setZoom(false)}>
          <FileImage fileId={view.references[refIndex]!.file_id} alt={view.references[refIndex]!.label} className="pm-zoom-img" />
          <button type="button" className="pm-zoom-close">Lukk</button>
        </div>
      )}

      <ProductListDialog open={listOpen} onClose={() => setListOpen(false)} view={view} currentElement={open} />

      <FinishDialog
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        view={view}
        onConfirm={async (q) => {
          const r = await run((c) => c.markFinished(s.id, q));
          if (r) setFinishOpen(false);
        }}
      />

      {deviationFor && view.plan && (
        <DeviationDialog
          element={deviationFor.element}
          step={deviationFor.step}
          products={products}
          onClose={() => setDeviationFor(null)}
          onCreateProduct={(name, manufacturer) => run((c) => c.createProduct({ name, manufacturer, owns: true }))}
          onSave={async (kind, payload, stepId) => {
            const r = await run((c) => c.addDeviation(view.plan!.id, {
              element_id: deviationFor.element.element.id, step_id: stepId, kind, payload,
            }));
            if (r) setDeviationFor(null);
          }}
        />
      )}
    </div>
  );
}

function liveProducts(t: Tables) {
  return Object.values(t.paint_product)
    .filter((p) => !p.deleted_at)
    .map((p) => ({ product: p, ownership: ownershipOf(t, p.id) }))
    .sort((a, b) => a.product.name.localeCompare(b.product.name, 'nb'));
}

// ---------- Referanser ----------

function References({ view, index, onIndex, onZoom }:
  { view: PaintingView; index: number; onIndex: (i: number) => void; onZoom: () => void }) {
  const refs = view.references;
  const cur = refs[Math.min(index, refs.length - 1)];
  return (
    <aside className="pm-refs" aria-label="Referanser">
      {cur ? (
        <>
          <button type="button" className="pm-ref-main" onClick={onZoom} aria-label={`Forstørr ${cur.label}`}>
            <FileImage fileId={cur.file_id} alt={cur.label} className="pm-ref-img" fallback={<span>Bildet mangler</span>} />
          </button>
          <p className="pm-ref-caption">
            <strong>{cur.label}</strong>
            <span className="small muted">{cur.source.title}{cur.source.creator ? ` · ${cur.source.creator}` : ''}</span>
            {cur.source.url && <a className="small pm-ref-link" href={cur.source.url} target="_blank" rel="noreferrer">Åpne kilden ↗</a>}
          </p>
          {refs.length > 1 && (
            <div className="pm-thumbs">
              {refs.map((r, i) => (
                <button key={r.asset.id} type="button" className={i === index ? 'on' : ''} onClick={() => onIndex(i)} aria-label={r.label} aria-current={i === index}>
                  <FileImage fileId={r.file_id} alt="" className="pm-thumb" />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="pm-ref-empty">
          <p>Ingen referansebilder.</p>
          <p className="small muted">Legg til et bilde under «Rediger» på miniatyren.</p>
        </div>
      )}
    </aside>
  );
}

// ---------- Oversikt ----------

function Overview({ view, onOpen }: { view: PaintingView; onOpen: (id: Id) => void }) {
  const ops = view.elements.filter((e) => e.element.kind === 'operation');
  const parts = view.elements.filter((e) => e.element.kind === 'part');
  const isGroup = view.subject.grouping === 'group';
  const Tile = ({ ev }: { ev: ElementView }) => {
    const devCount = ev.deviations.length + ev.steps.reduce((n, s) => n + s.deviations.length, 0);
    const swatches = ev.steps.flatMap((s) => s.materials.map((m) => (m.swapped_to?.product ?? m.product).swatch_hex)).slice(0, 6);
    return (
      <button type="button" className={`pm-tile ${ev.done ? 'done' : ''} ${view.last_opened_element_id === ev.element.id ? 'last' : ''}`} onClick={() => onOpen(ev.element.id)}>
        <span className="pm-tile-top">
          <strong>{ev.element.name}</strong>
          {ev.done && <span className="pm-check" aria-label="Ferdig">✓</span>}
        </span>
        <span className="pm-swatches">{swatches.map((h, i) => <Swatch key={i} hex={h} size={16} />)}</span>
        <span className="small muted">
          {ev.steps.length} steg
          {isGroup && ` · ${ev.group_count ?? 0}/${view.subject.physical_count}`}
          {devCount > 0 && ` · ${devCount} avvik`}
          {view.last_opened_element_id === ev.element.id && ' · sist åpnet'}
        </span>
      </button>
    );
  };
  return (
    <div className="pm-overview">
      {ops.length > 0 && (
        <section>
          <h2 className="eyebrow">Felles operasjoner</h2>
          <div className="pm-tiles">{ops.map((ev) => <Tile key={ev.element.id} ev={ev} />)}</div>
        </section>
      )}
      {parts.length > 0 && (
        <section>
          <h2 className="eyebrow">Deler</h2>
          <div className="pm-tiles">{parts.map((ev) => <Tile key={ev.element.id} ev={ev} />)}</div>
        </section>
      )}
      {view.completions.length > 0 && (
        <section className="pm-history">
          <h2 className="eyebrow">Ferdigstilt</h2>
          <ul>
            {view.completions.map((c) => (
              <li key={c.id}>
                <span className="mono">+{c.quantity}</span>
                <span>{new Date(c.created_at).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="muted small">
                  {c.finished_count_after}/{view.subject.physical_count} etterpå
                  {c.deviation_snapshot.length > 0 && ` · ${c.deviation_snapshot.length} avvik lagret`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------- Del ----------

function PartDetail({ ev, isGroup, physical, onBack, onPrev, onNext, onDone, onGroupCount, onDeviation, onRemoveDeviation }: {
  ev: ElementView; isGroup: boolean; physical: number;
  onBack: () => void; onPrev?: () => void; onNext?: () => void;
  onDone: (done: boolean) => void; onGroupCount: (n: number) => void;
  onDeviation: (step: StepView | null) => void; onRemoveDeviation: (id: Id) => void;
}) {
  return (
    <div className="pm-part">
      <div className="pm-part-head">
        <button type="button" className="pm-crumb" onClick={onBack}>← Alle deler</button>
        <div className="pm-part-nav">
          <Button variant="ghost" onClick={onPrev} disabled={!onPrev} aria-label="Forrige del">‹</Button>
          <Button variant="ghost" onClick={onNext} disabled={!onNext} aria-label="Neste del">›</Button>
        </div>
      </div>
      <div className="pm-part-title">
        <span className="eyebrow">{ev.element.kind === 'operation' ? 'Felles operasjon' : 'Del'}</span>
        <h2>{ev.element.name}</h2>
      </div>

      <ol className="pm-steps">
        {ev.steps.map((sv, i) => (
          <li key={sv.step.id} className="pm-step">
            <span className="pm-step-n mono">{i + 1}</span>
            <div className="pm-step-body">
              <InstructionWithDeviations sv={sv} onRemove={onRemoveDeviation} />
              {sv.materials.length > 0 && (
                <ul className="pm-materials">
                  {sv.materials.map((m) => <MaterialRow key={m.material.id} m={m} />)}
                </ul>
              )}
              {sv.mix && (
                <div className="pm-mix">
                  <span className="eyebrow">{sv.mix.label ?? 'Blanding'}</span>
                  <ul className="pm-materials">
                    {sv.mix.components.map((c) => (
                      <li key={c.product.id}>
                        <Swatch hex={c.product.swatch_hex} size={22} />
                        <span className="pm-role mono">{c.component.parts} del{c.component.parts === 1 ? '' : 'er'}</span>
                        <ProductName product={c.product} />
                        <OwnershipFlag ownership={c.ownership} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button type="button" className="pm-dev-link" onClick={() => onDeviation(sv)}>Rediger</button>
            </div>
          </li>
        ))}
        {ev.deviations.map((d) => (
          <li key={d.id} className="pm-step pm-step-extra">
            <span className="pm-step-n mono">+</span>
            <div className="pm-step-body">
              <DeviationNote d={d} onRemove={onRemoveDeviation} />
            </div>
          </li>
        ))}
      </ol>

      <div className="pm-part-foot">
        <Button onClick={() => onDeviation(null)}>Legg til ekstra steg eller merknad</Button>
        {isGroup ? (
          <div className="pm-group">
            <span className="small">Figurer som har fått denne delen</span>
            <Stepper label={`Antall for ${ev.element.name}`} value={ev.group_count ?? 0} min={0} max={physical} onChange={onGroupCount} />
            <span className="mono small">av {physical}</span>
          </div>
        ) : (
          <button type="button" className={`pm-toggle big ${ev.done ? 'on' : ''}`} aria-pressed={ev.done} onClick={() => onDone(!ev.done)}>
            {ev.done ? '✓ Delen er ferdig' : 'Marker delen ferdig'}
          </button>
        )}
      </div>
    </div>
  );
}

function InstructionWithDeviations({ sv, onRemove }: { sv: StepView; onRemove: (id: Id) => void }) {
  const change = [...sv.deviations].reverse().find((d) => d.kind === 'change_instruction');
  return (
    <>
      {change ? (
        <p className="pm-instr">
          <del>{sv.step.instruction}</del>
          <span className="pm-dev-inline">{change.payload.text}</span>
        </p>
      ) : (
        <p className="pm-instr">{sv.step.instruction || <span className="muted">Ingen instruks</span>}</p>
      )}
      {sv.deviations.map((d) => <DeviationNote key={d.id} d={d} onRemove={onRemove} compact />)}
    </>
  );
}

const DEV_LABEL: Record<DeviationKind, string> = {
  swap_product: 'Byttet maling', change_instruction: 'Endret instruks', extra_step: 'Ekstra steg', note: 'Merknad',
};

function DeviationNote({ d, onRemove, compact }: { d: LocalDeviation; onRemove: (id: Id) => void; compact?: boolean }) {
  return (
    <div className={`pm-dev ${compact ? 'compact' : ''}`}>
      <Badge tone="warn">Avvik · {DEV_LABEL[d.kind]}</Badge>
      {d.kind !== 'swap_product' && d.kind !== 'change_instruction' && <span>{d.payload.text}</span>}
      <button type="button" className="link small" onClick={() => onRemove(d.id)}>Fjern</button>
    </div>
  );
}

function MaterialRow({ m }: { m: MaterialView }) {
  const role = m.material.role_label ? `${ROLE_LABEL[m.material.role]} · ${m.material.role_label}` : ROLE_LABEL[m.material.role];
  if (m.swapped_to) {
    return (
      <li className="swapped">
        <Swatch hex={m.swapped_to.product.swatch_hex} size={22} />
        <span className="pm-role mono">{role}</span>
        <span className="pm-swap">
          <ProductName product={m.swapped_to.product} />
          <span className="small muted">i stedet for <del>{m.product.name}</del></span>
        </span>
        <OwnershipFlag ownership={m.swapped_to.ownership} />
      </li>
    );
  }
  return (
    <li>
      <Swatch hex={m.product.swatch_hex} size={22} />
      <span className="pm-role mono">{role}</span>
      <ProductName product={m.product} />
      <OwnershipFlag ownership={m.ownership} />
    </li>
  );
}

// ---------- Dialoger ----------

function ProductListDialog({ open, onClose, view, currentElement }:
  { open: boolean; onClose: () => void; view: PaintingView; currentElement: ElementView | null }) {
  const [scope, setScope] = useState<'all' | 'part'>('all');
  useEffect(() => { if (open) setScope(currentElement ? 'part' : 'all'); }, [open, currentElement]);
  const rows = productList(view, scope === 'part' && currentElement ? [currentElement.element.id] : undefined);
  const missing = rows.filter((r) => r.ownership !== 'owns').length;
  return (
    <Dialog open={open} onClose={onClose} title="Finn fram malingene" wide footer={<Button variant="primary" onClick={onClose}>Lukk</Button>}>
      {currentElement && (
        <Segmented
          label="Omfang"
          value={scope}
          onChange={setScope}
          options={[{ value: 'all', label: 'Hele planen' }, { value: 'part', label: currentElement.element.name }]}
        />
      )}
      <p className="small muted">
        {rows.length} produkter{missing > 0 ? ` · ${missing} er ikke registrert som eid` : ''}. Byttet maling fra åpne avvik er tatt med.
      </p>
      <ul className="pm-list">
        {rows.map((r) => (
          <li key={r.product.id}>
            <Swatch hex={r.product.swatch_hex} size={28} />
            <div>
              <ProductName product={r.product} />
              <span className="small muted">{r.element_names.join(', ')}</span>
            </div>
            <OwnershipFlag ownership={r.ownership} />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function FinishDialog({ open, onClose, view, onConfirm }:
  { open: boolean; onClose: () => void; view: PaintingView; onConfirm: (q: number) => void }) {
  const s = view.subject;
  const left = s.physical_count - s.finished_count;
  const [q, setQ] = useState(1);
  useEffect(() => { if (open) setQ(s.grouping === 'group' ? left : 1); }, [open, left, s.grouping]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={s.grouping === 'group' ? 'Marker figurer ferdige' : `Marker ${s.name} ferdig`}
      footer={<>
        <Button onClick={onClose}>Avbryt</Button>
        <Button variant="primary" onClick={() => onConfirm(q)}>Marker ferdig</Button>
      </>}
    >
      {s.grouping === 'group' && (
        <div className="field-row">
          <span className="field-label">Antall ferdige nå</span>
          <Stepper label="Antall ferdige" value={q} min={1} max={left} onChange={setQ} />
          <span className="small muted">{s.finished_count + q} av {s.physical_count} etterpå</span>
        </div>
      )}
      <p>Plan v{view.plan?.version_number} lagres som det som ble brukt.</p>
      {view.open_deviations.length > 0 ? (
        <p className="pm-warn">
          {view.open_deviations.length} åpne avvik kopieres inn og låses. De vises ikke lenger i malevisningen for denne planversjonen etterpå
          {s.grouping === 'group' && left - q > 0 ? `, heller ikke for de ${left - q} figurene som gjenstår` : ''}.
        </p>
      ) : (
        <p className="small muted">Ingen avvik er registrert.</p>
      )}
    </Dialog>
  );
}

function DeviationDialog({ element, step, products, onClose, onSave, onCreateProduct }: {
  element: ElementView;
  step: StepView | null;
  products: { product: PaintProduct; ownership: ReturnType<typeof ownershipOf> }[];
  onClose: () => void;
  onSave: (kind: DeviationKind, payload: { from_product_id?: Id; to_product_id?: Id; text?: string }, stepId: Id | null) => void;
  onCreateProduct: (name: string, manufacturer: string | null) => Promise<Id | undefined>;
}) {
  const stepMaterials = step ? step.materials.filter((m) => !m.swapped_to) : [];
  const kinds: { value: DeviationKind; label: string }[] = step
    ? [
        ...(stepMaterials.length ? [{ value: 'swap_product' as const, label: 'Bytt maling' }] : []),
        { value: 'change_instruction', label: 'Endre instruks' },
        { value: 'note', label: 'Merknad' },
      ]
    : [{ value: 'extra_step', label: 'Ekstra steg' }, { value: 'note', label: 'Merknad' }];
  const [kind, setKind] = useState<DeviationKind>(kinds[0]!.value);
  const [from, setFrom] = useState<Id>(stepMaterials[0]?.product.id ?? '');
  const [to, setTo] = useState<Id>('');
  const [text, setText] = useState(kind === 'change_instruction' ? step?.step.instruction ?? '' : '');
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newMaker, setNewMaker] = useState('');

  useEffect(() => {
    setText(kind === 'change_instruction' ? step?.step.instruction ?? '' : '');
  }, [kind, step]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => p.product.id !== from)
      .filter((p) => !q || `${p.product.name} ${p.product.manufacturer ?? ''}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [products, query, from]);

  const title = step ? `Avvik i steg ${step.step.position + 1} · ${element.element.name}` : `Avvik · ${element.element.name}`;

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={title}
      footer={<>
        <Button onClick={onClose}>Avbryt</Button>
        <Button
          variant="primary"
          disabled={kind === 'swap_product' ? !to : !text.trim()}
          onClick={() => onSave(kind, kind === 'swap_product' ? { from_product_id: from, to_product_id: to } : { text }, step?.step.id ?? null)}
        >Lagre avvik</Button>
      </>}
    >
      <p className="small muted">Avviket gjelder bare denne planversjonen for denne miniatyren. Oppskrifter og andre figurer endres ikke.</p>
      <Segmented label="Type avvik" value={kind} onChange={setKind} options={kinds} />

      {kind === 'swap_product' ? (
        <>
          <Field label="Maling som byttes ut">
            {(id) => (
              <select id={id} value={from} onChange={(e) => { setFrom(e.target.value); setTo(''); }}>
                {stepMaterials.map((m) => <option key={m.product.id} value={m.product.id}>{m.product.name} ({ROLE_LABEL[m.material.role]})</option>)}
              </select>
            )}
          </Field>
          <Field label="Bruk i stedet">
            {(id) => <input id={id} type="search" value={query} placeholder="Søk i malingene" onChange={(e) => setQuery(e.target.value)} />}
          </Field>
          <ul className="pm-pick" role="listbox" aria-label="Malinger">
            {filtered.map((p) => (
              <li key={p.product.id}>
                <button type="button" role="option" aria-selected={to === p.product.id} className={to === p.product.id ? 'on' : ''} onClick={() => setTo(p.product.id)}>
                  <Swatch hex={p.product.swatch_hex} size={20} />
                  <ProductName product={p.product} />
                  <OwnershipFlag ownership={p.ownership} />
                </button>
              </li>
            ))}
          </ul>
          <details className="pm-newprod">
            <summary>Malingen finnes ikke i listen</summary>
            <div className="pm-newprod-row">
              <Field label="Navn">{(id) => <input id={id} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ny maling" />}</Field>
              <Field label="Produsent (valgfritt)">{(id) => <input id={id} value={newMaker} onChange={(e) => setNewMaker(e.target.value)} />}</Field>
              <Button onClick={async () => {
                const id = await onCreateProduct(newName, newMaker || null);
                if (id) { setTo(id); setNewName(''); setNewMaker(''); }
              }}>Opprett og velg</Button>
            </div>
            <p className="small muted">Lagres som ubekreftet produkt og registreres som eid.</p>
          </details>
        </>
      ) : (
        <Field label={kind === 'change_instruction' ? 'Ny instruks' : kind === 'extra_step' ? 'Hva gjorde du?' : 'Merknad'}>
          {(id) => <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} autoFocus />}
        </Field>
      )}
    </Dialog>
  );
}
