/**
 * AI-nøkkel. The key is sent once to the app's server, encrypted there and
 * never shown again (datamodell v3 §4). The app works fully without a key.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAi } from '../../app/context';
import type { AiCredentialView, AiTestResult } from '../../domain/ai';
import { Badge, Button, Card, Dialog, ErrorNote, Field } from '../../ui/components';
import './settings.css';

/** UiB's Responses API (oppgitt av brukeren 9. november 2026). */
export const UIB_BASE_URL = 'https://models.api.uib.no/v1';

type Load =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'ready'; credential: AiCredentialView | null };

export function AiSettingsPage() {
  const ai = useAi();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [label, setLabel] = useState('UiB');
  const [baseUrl, setBaseUrl] = useState(UIB_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'models' | 'test' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<AiTestResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fill = (c: AiCredentialView | null) => {
    setLabel(c?.label ?? 'UiB');
    setBaseUrl(c?.base_url ?? UIB_BASE_URL);
    setModel(c?.default_model ?? '');
  };

  const refresh = useCallback(async () => {
    try {
      const r = await ai.getCredential();
      if (r.status === 'unavailable') return setLoad({ state: 'unavailable' });
      setLoad({ state: 'ready', credential: r.credential });
      fill(r.credential);
    } catch (e) {
      setError(msg(e));
      setLoad({ state: 'unavailable' });
    }
  }, [ai]);

  useEffect(() => { refresh(); }, [refresh]);

  const run = async <T,>(kind: NonNullable<typeof busy>, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      setError(msg(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const credential = load.state === 'ready' ? load.credential : null;

  const save = () => run('save', async () => {
    const c = await ai.saveCredential({
      label, base_url: baseUrl, default_model: model || null,
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
    });
    setApiKey('');
    setTest(null);
    setLoad({ state: 'ready', credential: c });
    fill(c);
    setNotice('Lagret. Nøkkelen er kryptert på serveren og vises ikke igjen.');
    // Fetching the model list right away also tells the user whether the key works.
    if (!c.default_model) {
      try {
        setModels(await ai.listModels());
      } catch (e) {
        setError(`Nøkkelen er lagret, men modellene kunne ikke hentes: ${msg(e)}`);
      }
    }
    return c;
  });

  const fetchModels = () => run('models', async () => {
    const list = await ai.listModels();
    setModels(list);
    if (!list.length) setNotice('Tjenesten oppga ingen modeller. Skriv modellnavnet selv.');
  });

  return (
    <main className="page settings">
      <div className="page-head">
        <div>
          <span className="eyebrow">Innstillinger</span>
          <h1>AI-nøkkel</h1>
          <p className="muted">Paintrest virker fullt ut uten AI. Nøkkelen trengs bare for researchagenten.</p>
        </div>
      </div>

      {load.state === 'loading' && <p className="muted">Henter status …</p>}

      {load.state === 'unavailable' && (
        <Card className="settings-status warn">
          <h3>Serveren kjører ikke</h3>
          <p>
            Nøkkelen lagres på Paintrest-serveren, ikke i nettleseren. Denne versjonen av appen kjører uten server,
            så nøkkelen kan ikke legges inn her. Start appen lokalt med <code>npm run dev</code> og åpne denne siden der.
          </p>
        </Card>
      )}

      {load.state === 'ready' && (
        <>
          <Card className="settings-status">
            {credential ? (
              <div className="status-row">
                <Badge tone="moss">Koblet til</Badge>
                <span><strong>{credential.label}</strong> · nøkkel {credential.key_hint} · standardmodell {credential.default_model ?? <em>ikke valgt</em>}</span>
              </div>
            ) : (
              <div className="status-row">
                <Badge>Ingen nøkkel</Badge>
                <span className="muted">Legg inn adresse og nøkkel fra UiB nedenfor.</span>
              </div>
            )}
          </Card>

          <ErrorNote error={error} onClose={() => setError(null)} />
          {notice && <p className="notice" role="status">{notice}</p>}

          <Card>
            <form className="settings-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <Field label="Navn">{(id) => <input id={id} value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
              <Field label="Adresse til API-et" hint="Fylt ut med UiB sin adresse. Paintrest kaller …/models og …/responses med nøkkelen som Bearer-token.">
                {(id) => <input id={id} type="url" inputMode="url" value={baseUrl} placeholder="https://…/v1" onChange={(e) => setBaseUrl(e.target.value)} autoComplete="off" spellCheck={false} />}
              </Field>
              <Field
                label="API-nøkkel"
                hint={credential ? `En nøkkel er lagret (${credential.key_hint}). La feltet stå tomt for å beholde den.` : 'Prosjektnøkkelen fra UiB. Behandle den som et passord. Den sendes én gang til serveren og vises aldri igjen.'}
              >
                {(id) => (
                  <input
                    id={id}
                    type="password"
                    value={apiKey}
                    placeholder={credential ? 'Lim inn ny nøkkel for å bytte' : 'Lim inn nøkkelen'}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
              <Field label="Standardmodell" hint="Modellen agenten bruker hvis ikke noe annet er valgt.">
                {(id) => models && models.length > 0 ? (
                  <select id={id} value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="">Velg modell</option>
                    {models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input id={id} value={model} placeholder="Modellnavn" onChange={(e) => setModel(e.target.value)} autoComplete="off" spellCheck={false} />
                )}
              </Field>
              <div className="settings-actions">
                <Button variant="primary" type="submit" disabled={!!busy || !baseUrl.trim() || (!credential && !apiKey.trim())}>
                  {busy === 'save' ? 'Lagrer …' : 'Lagre'}
                </Button>
                <Button onClick={fetchModels} disabled={!!busy || !credential}>{busy === 'models' ? 'Henter …' : 'Hent modeller'}</Button>
                <Button
                  onClick={() => run('test', async () => setTest(await ai.test(model || undefined)))}
                  disabled={!!busy || !credential || !(model || credential.default_model)}
                >{busy === 'test' ? 'Tester …' : 'Test tilkoblingen'}</Button>
                {credential && <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={!!busy}>Fjern nøkkel</Button>}
              </div>
            </form>
            {test && (
              <div className="test-result" role="status">
                <Badge tone="moss">Tilkoblingen virker</Badge>
                <span>{test.model} svarte «{test.text.trim().slice(0, 80)}» på {(test.latency_ms / 1000).toFixed(1)} s</span>
              </div>
            )}
          </Card>
        </>
      )}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Fjerne nøkkelen?"
        footer={<>
          <Button onClick={() => setConfirmDelete(false)}>Avbryt</Button>
          <Button variant="primary" onClick={async () => {
            await run('delete', async () => {
              await ai.deleteCredential();
              setLoad({ state: 'ready', credential: null });
              fill(null);
              setModels(null);
              setTest(null);
            });
            setConfirmDelete(false);
          }}>Fjern</Button>
        </>}
      >
        <p>Nøkkelen slettes fra serveren. Prosjektene dine påvirkes ikke, og appen virker videre uten AI.</p>
      </Dialog>
    </main>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
