import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useCommand } from '../app/context';
import type { Id, Ownership, PaintProduct } from '../domain/types';
import './components.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'moss' | 'danger';

export function Button({ variant = 'secondary', icon, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} {...rest}>
      {children}
      {icon && <span className="btn-icon" aria-hidden>{icon}</span>}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'moss' | 'warn' | 'dark'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ErrorNote({ error, onClose }: { error: string | null; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-note" role="alert">
      <span>{error}</span>
      {onClose && <button type="button" className="link" onClick={onClose}>Lukk</button>}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, footer, wide }:
  { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'dialog-wide' : ''}`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <div className="dialog-body">
          <h2>{title}</h2>
          <div className="dialog-content">{children}</div>
          {footer && <div className="dialog-footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="small muted">{hint}</p>}
    </div>
  );
}

export function Stepper({ value, min = 0, max, onChange, label }:
  { value: number; min?: number; max?: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Færre" disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="Flere" disabled={max !== undefined && value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }:
  { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.value === value && <span aria-hidden>✓ </span>}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Loads a stored file as an object URL. Shows `fallback` when there is no file. */
export function FileImage({ fileId, alt, className = '', fallback }:
  { fileId: Id | null | undefined; alt: string; className?: string; fallback?: ReactNode }) {
  const { cmd } = useCommand();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (fileId) cmd.getFileUrl(fileId).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [fileId, cmd]);
  if (!fileId || !url) return <div className={`img-fallback ${className}`} role="img" aria-label={alt}>{fallback}</div>;
  return <img src={url} alt={alt} className={className} draggable={false} />;
}

export function Swatch({ hex, size = 18 }: { hex: string | null; size?: number }) {
  return (
    <span
      className={`swatch ${hex ? '' : 'swatch-empty'}`}
      style={{ width: size, height: size, background: hex ?? undefined }}
      aria-hidden
    />
  );
}

const OWN_LABEL: Record<Ownership, string> = { owns: 'Eier', not_owned: 'Eier ikke', unknown: 'Ukjent' };

export function OwnershipFlag({ ownership }: { ownership: Ownership }) {
  return <span className={`own own-${ownership}`}>{OWN_LABEL[ownership]}</span>;
}

/** Exact product identity: manufacturer · range · name (spesifikasjon §1). */
export function ProductName({ product, compact }: { product: PaintProduct; compact?: boolean }) {
  const meta = [product.manufacturer ?? 'Ukjent produsent', product.range_name].filter(Boolean).join(' · ');
  return (
    <span className="product-name">
      <strong>{product.name}</strong>
      {!compact && <span className="small muted"> {meta}</span>}
      {product.identity_status === 'unconfirmed' && <Badge tone="warn">Ubekreftet</Badge>}
    </span>
  );
}

export function ImagePicker({ onPick, children, variant = 'ghost' }:
  { onPick: (file: File) => void; children: ReactNode; variant?: Variant }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant={variant} onClick={() => ref.current?.click()}>{children}</Button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
    </>
  );
}

/** Click-to-edit text. Saves on Enter or blur, cancels on Escape. */
export function InlineText({ value, onSave, label, as: Tag = 'span', className = '' }:
  { value: string; onSave: (v: string) => Promise<unknown> | void; label: string; as?: 'span' | 'h1' | 'h2' | 'h3'; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editing) {
    return (
      <Tag className={`inline-text ${className}`}>
        {value}
        <button type="button" className="inline-edit" aria-label={`Endre ${label.toLowerCase()}`} onClick={() => setEditing(true)}>✎</button>
      </Tag>
    );
  }
  const commit = async () => {
    setEditing(false);
    if (draft.trim() && draft !== value) await onSave(draft);
    else setDraft(value);
  };
  return (
    <input
      className={`inline-input ${className}`}
      aria-label={label}
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
    />
  );
}
