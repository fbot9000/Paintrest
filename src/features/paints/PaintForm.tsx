import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAiStatus } from '../../app/ai-status';
import { useApp, useView } from '../../app/context';
import type { Id, Ownership, PaintProduct, ProductKind } from '../../domain/types';
import { COMMON_MAKERS, KIND_LABEL, OWNERSHIP_LABEL, PRODUCT_KINDS, findProduct, makersIn, paintLabel, rangesFor } from '../../domain/paints';
import type { ImportField } from '../../domain/paints';
import { ownershipOf } from '../../domain/views';
import { Badge, Button, ErrorNote, Segmented } from '../../ui/components';

export interface PaintValue {
  manufacturer: string;
  range_name: string;
  name: string;
  product_code: string;
  product_kind: ProductKind;
  finish: string;
  swatch_hex: string | null;
  ownership: Ownership;
}

export const EMPTY_PAINT: PaintValue = {
  manufacturer: '', range_name: '', name: '', product_code: '', product_kind: 'other', finish: '', swatch_hex: null, ownership: 'owns',
};

export function valueOf(p: PaintProduct, ownership: Ownership): PaintValue {
  return {
    manufacturer: p.manufacturer ?? '', range_name: p.range_name ?? '', name: p.name, product_code: p.product_code ?? '',
    product_kind: p.product_kind, finish: p.finish ?? '', swatch_hex: p.swatch_hex, ownership,
  };
}

const FINISHES = ['matt', 'satin', 'blank', 'metallisk'];

/**
 * One paint: maker, range, name, code, type, finish, colour and whether you have it.
 * «Fyll ut med AI» fills the empty fields; what the AI filled is marked until you change it.
 */
export function PaintForm({ mode, initial, productId, onSave, onCancel, onDelete, saveLabel }: {
  mode: 'add' | 'edit';
  initial: PaintValue;
  productId?: Id;
  /** Returns what happened (shown after an add), or null when nothing was saved. `estimated`: the colour is the AI's estimate. */
  onSave: (v: PaintValue, estimated: boolean) => Promise<string | null>;
  onCancel?: () => void;
  onDelete?: () => void;
  saveLabel?: string;
}) {
  const { ai } = useApp();
  const status = useAiStatus();
  const [v, setV] = useState<PaintValue>(initial);
  const [aiFilled, setAiFilled] = useState<ImportField[]>([]);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const current = useRef(v);
  current.current = v;
  const ids = { maker: useId(), range: useId(), name: useId(), code: useId(), kind: useId(), finish: useId(), color: useId(), makers: useId(), ranges: useId(), finishes: useId() };
  useEffect(() => { if (mode === 'add') nameRef.current?.focus(); }, [mode]);

  const makers = useView((t) => makersIn(t).filter((m) => m.key).map((m) => m.name));
  const ranges = useView((t) => rangesFor(t, v.manufacturer || null), [v.manufacturer]);
  const makerOptions = useMemo(() => [...new Set([...makers, ...COMMON_MAKERS])], [makers]);
  // The same paint already in the catalogue (or hidden), other than the one being edited.
  const twin = useView((t) => {
    if (!v.name.trim()) return null;
    const others = { ...t.paint_product };
    if (productId) delete others[productId];
    const m = findProduct(others, { manufacturer: v.manufacturer || null, range_name: v.range_name || null, name: v.name, product_code: v.product_code || null });
    return m ? { product: m, ownership: ownershipOf(t, m.id) } : null;
  }, [v.manufacturer, v.range_name, v.name, v.product_code, productId]);

  const set = <K extends keyof PaintValue>(k: K, value: PaintValue[K]) => {
    setV((x) => ({ ...x, [k]: value }));
    setAiFilled((f) => f.filter((x) => x !== k));
    setSaved(null);
  };

  const fillWithAi = async () => {
    const text = [v.manufacturer, v.range_name, v.name, v.product_code].filter((x) => x.trim()).join(' ');
    if (!text.trim()) return;
    setAiBusy(true); setError(null); setAiNote(null);
    try {
      const r = await ai.readPaints({ mode: 'read', lines: [{ n: 1, text }], context: [], note: 'Brukeren skriver inn én maling i et skjema. Beskriv den ene malingen. Ikke still spørsmål; skriv tvil i "unsure".' });
      const p = r.paints[0];
      if (!p) { setAiNote(r.message || 'AI-en kjente ikke igjen malingen.'); return; }
      // Only empty fields are filled; what the user typed stays.
      const filled: ImportField[] = [];
      const next = { ...current.current };
      const fill = (k: 'manufacturer' | 'range_name' | 'product_code' | 'finish', value: string | null) => {
        if (!value || next[k].trim()) return;
        next[k] = value;
        filled.push(k);
      };
      fill('manufacturer', p.maker);
      fill('range_name', p.range);
      fill('product_code', p.code);
      fill('finish', p.finish);
      if (!next.swatch_hex && p.hex) { next.swatch_hex = p.hex; filled.push('swatch_hex'); }
      if (next.product_kind === 'other' && PRODUCT_KINDS.includes(p.kind as ProductKind) && p.kind !== 'other') { next.product_kind = p.kind as ProductKind; filled.push('product_kind'); }
      if (p.name && p.name !== next.name) { next.name = p.name; filled.push('name'); }
      setV(next);
      setAiFilled(filled);
      setAiNote(p.unsure ?? (filled.length ? null : 'AI-en hadde ingenting å legge til.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const submit = async () => {
    if (!v.name.trim()) { setError('Skriv navnet på malingen'); return; }
    setError(null);
    const result = await onSave(v, !!v.swatch_hex && aiFilled.includes('swatch_hex'));
    if (result === null) return;
    if (mode === 'add') {
      // Keep maker, range, type and ownership: the next paint is often from the same range.
      setSaved(result);
      setV((x) => ({ ...x, name: '', product_code: '', finish: '', swatch_hex: null }));
      setAiFilled([]);
      setAiNote(null);
      nameRef.current?.focus();
    }
  };

  const mark = (f: ImportField) => (aiFilled.includes(f) ? ' ai-filled' : '');

  return (
    <form className="paint-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="paint-form-grid">
        <div className={`pf-field${mark('manufacturer')}`}>
          <label htmlFor={ids.maker}>Produsent</label>
          <input id={ids.maker} list={ids.makers} value={v.manufacturer} placeholder="Citadel, Vallejo …" autoComplete="off" onChange={(e) => set('manufacturer', e.target.value)} />
          <datalist id={ids.makers}>{makerOptions.map((m) => <option key={m} value={m} />)}</datalist>
        </div>
        <div className={`pf-field${mark('range_name')}`}>
          <label htmlFor={ids.range}>Serie</label>
          <input id={ids.range} list={ids.ranges} value={v.range_name} placeholder="Base, Model Color …" autoComplete="off" onChange={(e) => set('range_name', e.target.value)} />
          <datalist id={ids.ranges}>{ranges.map((r) => <option key={r} value={r} />)}</datalist>
        </div>
        <div className={`pf-field pf-name${mark('name')}`}>
          <label htmlFor={ids.name}>Navn</label>
          <input id={ids.name} ref={nameRef} value={v.name} placeholder="Caliban Green" autoComplete="off" required onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className={`pf-field${mark('product_code')}`}>
          <label htmlFor={ids.code}>Kode</label>
          <input id={ids.code} value={v.product_code} placeholder="70.950" autoComplete="off" className="mono" onChange={(e) => set('product_code', e.target.value)} />
        </div>
        <div className={`pf-field${mark('product_kind')}`}>
          <label htmlFor={ids.kind}>Type</label>
          <select id={ids.kind} value={v.product_kind} onChange={(e) => set('product_kind', e.target.value as ProductKind)}>
            {PRODUCT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div className={`pf-field${mark('finish')}`}>
          <label htmlFor={ids.finish}>Finish</label>
          <input id={ids.finish} list={ids.finishes} value={v.finish} placeholder="matt" autoComplete="off" onChange={(e) => set('finish', e.target.value)} />
          <datalist id={ids.finishes}>{FINISHES.map((f) => <option key={f} value={f} />)}</datalist>
        </div>
        <div className={`pf-field pf-color${mark('swatch_hex')}`}>
          <label htmlFor={ids.color}>Farge</label>
          <div className="pf-color-row">
            <input id={ids.color} type="color" value={v.swatch_hex ?? '#888888'} className={v.swatch_hex ? '' : 'no-color'}
              onChange={(e) => set('swatch_hex', e.target.value)} aria-describedby={`${ids.color}-hint`} />
            <span id={`${ids.color}-hint`} className="small muted mono">{v.swatch_hex ?? 'ingen'}</span>
            {v.swatch_hex && <button type="button" className="link small" onClick={() => set('swatch_hex', null)}>Fjern</button>}
          </div>
        </div>
        <div className="pf-field pf-own">
          <span className="pf-label">Har du den?</span>
          <Segmented label="Eierskap" value={v.ownership} onChange={(o) => set('ownership', o)}
            options={(['owns', 'not_owned', 'unknown'] as Ownership[]).map((o) => ({ value: o, label: OWNERSHIP_LABEL[o] }))} />
        </div>
      </div>

      {aiFilled.length > 0 && (
        <p className="small ai-legend"><span className="ai-dot" aria-hidden /> Fylt inn av AI-en: {aiFilled.length} felt. Sjekk dem; endrer du et felt, er det ditt.</p>
      )}
      {aiNote && <p className="small tech-uncertain">{aiNote}</p>}
      {twin && (
        <p className="small paint-twin" role="status">
          {twin.product.deleted_at
            ? <>En skjult maling er den samme: <strong>{paintLabel(twin.product)}</strong>. {mode === 'add' ? 'Legger du den til, tas den i bruk igjen, og planer som bruker den, følger med.' : ''}</>
            : <>Finnes allerede: <strong>{paintLabel(twin.product)}</strong> <Badge tone={twin.ownership === 'owns' ? 'moss' : 'neutral'}>{OWNERSHIP_LABEL[twin.ownership]}</Badge>
                {mode === 'add' ? ' Legger du den til, får den eierstatusen du har valgt, og tomme felt fylles inn.' : ''}</>}
        </p>
      )}
      <ErrorNote error={error} onClose={() => setError(null)} />
      {saved && <p className="small paint-saved" role="status">✓ {saved} Skriv neste.</p>}

      <div className="paint-form-actions">
        {onDelete && <Button variant="danger" onClick={onDelete}>Skjul malingen</Button>}
        <span className="spacer" />
        {status === 'ready' && (
          <Button onClick={fillWithAi} disabled={aiBusy || !v.name.trim()} title="AI-en fyller inn produsent, serie, type, kode og omtrentlig farge">
            {aiBusy ? 'AI-en ser på det …' : 'Fyll ut med AI'}
          </Button>
        )}
        {onCancel && <Button onClick={onCancel}>{mode === 'add' ? 'Lukk' : 'Avbryt'}</Button>}
        <button type="submit" className="btn btn-primary" disabled={!v.name.trim()}>
          {saveLabel ?? (mode === 'add' ? 'Legg til' : 'Lagre')}
        </button>
      </div>
    </form>
  );
}
