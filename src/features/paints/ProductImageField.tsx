import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useApp, useCommand, useView } from '../../app/context';
import { useAiStatus } from '../../app/ai-status';
import { runs, useRuns } from '../../app/runs';
import type { Run } from '../../app/runs';
import type { PaintImage } from '../../domain/ai';
import type { Id, PaintProduct } from '../../domain/types';
import { Badge, Button, ErrorNote, FileImage, ImagePicker } from '../../ui/components';
import { LiveSteps } from '../agent/AgentPanel';
import { applyProductImage, productImageResult, startProductImageSearch } from './productImage';
import '../game/game.css';

const SOURCE_LABEL: Record<PaintImage['source_kind'], string> = { maker: 'Produsenten', shop: 'Butikk', other: 'Annen side' };
const SURE: Record<'high' | 'medium' | 'low', string> = { high: 'Sikker', medium: 'Trolig', low: 'Usikker' };

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

/**
 * The product picture of one paint (O-15): the one you have, with its source, and «Finn med AI»,
 * which shows the agent's pictures. Nothing is stored before you choose one.
 */
export function ProductImageField({ productId }: { productId: Id }) {
  const app = useApp();
  const aiStatus = useAiStatus();
  const { run, error, clearError } = useCommand();
  const product = useView((t) => t.paint_product[productId], [productId]);
  const search = useRuns((r) => r.get(productId, 'paintimage'));
  if (!product) return null;
  const busy = search?.status === 'running';
  return (
    <section className="product-image" aria-label="Produktbilde">
      <div className="product-image-row">
        <FileImage fileId={product.image_file_id} alt={`Produktbilde av ${product.name}`} className="product-image-big"
          fallback={<span className="small muted">Ingen bilde</span>} />
        <div className="product-image-info">
          <strong>Produktbilde</strong>
          {product.image_source ? (
            <span className="small">Fra <a href={product.image_source.page_url} target="_blank" rel="noreferrer" title={product.image_source.page_title ?? product.image_source.page_url}>
              {hostOf(product.image_source.page_url)} ↗</a>. Lagret for personlig bruk.</span>
          ) : product.image_file_id ? <span className="small muted">Lastet opp av deg.</span>
            : <span className="small muted">Agenten kan finne et bilde hos produsenten eller en butikk. Du velger før noe lagres.</span>}
          <div className="product-image-actions">
            {aiStatus === 'ready' && (
              <Button onClick={() => startProductImageSearch(app, product)} disabled={busy}>{busy ? 'Agenten leter …' : 'Finn med AI'}</Button>
            )}
            <ImagePicker onPick={(f) => run((c) => c.setProductImage(product.id, f, null))}>Last opp</ImagePicker>
            {product.image_file_id && <button type="button" className="link small" onClick={() => run((c) => c.setProductImage(product.id, null))}>Fjern bildet</button>}
          </div>
          {(aiStatus === 'no-key' || aiStatus === 'no-server') && (
            <span className="small muted">
              {aiStatus === 'no-key' ? <>AI-søket krever en nøkkel. Legg den inn under <Link to="/innstillinger">AI og nettsøk</Link>.</> : 'AI-søket krever Paintrest-serveren.'}
            </span>
          )}
        </div>
      </div>
      <ErrorNote error={error} onClose={clearError} />
      {search && <SearchPanel run={search} product={product} imageUrl={(u) => app.ai.imageProxyUrl(u)}
        onStop={() => runs.stop(product.id, 'paintimage')} onClose={() => runs.dismiss(product.id, 'paintimage')}
        onApply={(img) => applyProductImage(app, product, img)} />}
    </section>
  );
}

function SearchPanel({ run, product, imageUrl, onStop, onClose, onApply }: {
  run: Run; product: PaintProduct; imageUrl: (u: string) => string; onStop: () => void; onClose: () => void;
  onApply: (img: PaintImage) => Promise<void>;
}) {
  const result = productImageResult(run);
  const [choice, setChoice] = useState<PaintImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    setChoice(null);
    setFailed(null);
  }, [run.finished_at]);

  if (run.status === 'running') {
    return <div className="lookup lookup-live" aria-label="Agenten leter etter produktbilder"><LiveSteps events={run.events} onStop={onStop} /></div>;
  }
  const head = run.status === 'done' ? 'Forslag fra AI' : run.status === 'stopped' ? 'Søket ble stoppet' : 'Søket feilet';
  return (
    <div className="lookup product-image-lookup">
      <div className="lookup-head">
        <div>
          <span className="eyebrow">{head}{result?.model ? ` · ${result.model}` : ''}</span>
          {result?.message && <p className="lookup-msg small">{result.message}</p>}
        </div>
        <button type="button" className="link small" onClick={onClose}>Lukk</button>
      </div>
      {run.error && !result && <ErrorNote error={run.error} />}
      {failed && <ErrorNote error={failed} onClose={() => setFailed(null)} />}
      {result && (result.images.length === 0 ? (
        <p className="small muted">Agenten fant ingen bilder som Paintrest kunne sjekke. Last opp et bilde selv, eller prøv igjen.</p>
      ) : (
        <div className="lookup-images" role="radiogroup" aria-label="Velg produktbilde">
          {result.images.map((img) => {
            const on = choice?.image_url === img.image_url;
            return (
              <label key={img.image_url} className={`lookup-img ${on ? 'on' : ''}`}>
                <input type="radio" name={`pimg-${product.id}`} checked={on} onChange={() => setChoice(img)} />
                <img src={imageUrl(img.thumbnail_url ?? img.image_url)} alt={img.caption ?? ''} loading="lazy"
                  onError={(e) => {
                    const el = e.currentTarget;
                    if (img.thumbnail_url && !el.dataset.fallback) { el.dataset.fallback = '1'; el.src = imageUrl(img.image_url); } else el.classList.add('broken');
                  }} />
                <span className="lookup-img-meta">
                  <Badge tone={img.source_kind === 'maker' ? 'moss' : 'neutral'}>{SOURCE_LABEL[img.source_kind]}</Badge>
                  {img.confidence && <span className="small muted">{SURE[img.confidence]}</span>}
                </span>
                {img.caption && <span className="small lookup-cap">{img.caption}</span>}
                <a className="small" href={img.page_url} target="_blank" rel="noreferrer" title={img.page_title ?? img.page_url}>{img.site || hostOf(img.page_url)} ↗</a>
              </label>
            );
          })}
        </div>
      ))}
      {result?.uncertainty && <p className="small lookup-warn">Usikkert: {result.uncertainty}</p>}
      {result && result.warnings.length > 0 && (
        <details className="small lookup-checks">
          <summary>Paintrest sin kontroll ({result.warnings.length})</summary>
          <ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
      {result && result.images.length > 0 && (
        <div className="lookup-actions">
          <Button variant="primary" disabled={!choice || busy} onClick={async () => {
            if (!choice) return;
            setBusy(true);
            setFailed(null);
            try { await onApply(choice); onClose(); } catch (e) { setFailed(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
          }}>{busy ? 'Henter bildet …' : product.image_file_id ? 'Bytt til dette bildet' : 'Bruk bildet'}</Button>
        </div>
      )}
    </div>
  );
}
