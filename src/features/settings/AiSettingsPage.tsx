/**
 * AI-nøkkel. The key is sent once to the app's server, encrypted there and
 * never shown again (datamodell v3 §4). The app works fully without a key.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAi } from '../../app/context';
import type { AiCredentialView, AiTestResult, HostedSearchSetting, HostedSearchTest, SearchCredentialView } from '../../domain/ai';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Segmented } from '../../ui/components';
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
  const [hosted, setHosted] = useState<HostedSearchSetting>('web_search');
  const [hostedTest, setHostedTest] = useState<HostedSearchTest | null>(null);
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
    setHosted(c?.hosted_search ?? 'web_search');
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
      label, base_url: baseUrl, default_model: model || null, hosted_search: hosted,
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
          <h1>AI, nettsøk og data</h1>
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
              <div className="field">
                <span className="field-label">Nettsøk via UiB</span>
                <Segmented
                  label="Nettsøk via UiB"
                  value={hosted}
                  onChange={(v) => { setHosted(v); setHostedTest(null); }}
                  options={[{ value: 'web_search', label: 'web_search' }, { value: 'web_search_preview', label: 'web_search_preview' }, { value: 'off', label: 'Av' }]}
                />
                <p className="small muted">
                  Lar modellen søke selv gjennom UiB sitt API (OpenAIs innebygde søkeverktøy). Virker det ikke for modellen,
                  bruker agenten Tavily eller Brave hvis det er satt opp nedenfor, ellers svarer den uten nettsøk.
                </p>
              </div>
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
                <Button
                  onClick={() => run('test', async () => { setHostedTest(null); setHostedTest(await ai.testHostedSearch(model || undefined, hosted === 'off' ? 'web_search' : hosted)); })}
                  disabled={!!busy || !credential || !(model || credential.default_model)}
                >{busy === 'test' ? 'Tester …' : 'Test nettsøk via UiB'}</Button>
                {credential && <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={!!busy}>Fjern nøkkel</Button>}
              </div>
            </form>
            {hostedTest && (
              <div className="test-result" role="status">
                {hostedTest.citations.length || hostedTest.searches.length
                  ? <Badge tone="moss">Nettsøk via UiB virker</Badge>
                  : <Badge tone="warn">Svar uten kilder</Badge>}
                <span>
                  {hostedTest.model} med {hostedTest.tool}: {hostedTest.searches.length} søk, {hostedTest.citations.length} kilder på {(hostedTest.latency_ms / 1000).toFixed(1)} s.
                  {!hostedTest.citations.length && ' Modellen svarte, men uten sitater. Søket er trolig ikke slått på for denne modellen.'}
                </span>
                {hostedTest.citations.length > 0 && (
                  <ul className="sources">
                    {hostedTest.citations.map((c) => <li key={c.url}><a href={c.url} target="_blank" rel="noreferrer">{c.title}</a></li>)}
                  </ul>
                )}
              </div>
            )}
            {test && (
              <div className="test-result" role="status">
                <Badge tone="moss">Tilkoblingen virker</Badge>
                <span>{test.model} svarte «{test.text.trim().slice(0, 80)}» på {(test.latency_ms / 1000).toFixed(1)} s</span>
              </div>
            )}
          </Card>
        </>
      )}

      {load.state === 'ready' && <SearchSettings />}
      <DataSettings />

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

/** Search key for the agent's web research. Stored and encrypted on the server like the AI key. */
function SearchSettings() {
  const ai = useAi();
  const [cred, setCred] = useState<SearchCredentialView | null | undefined>(undefined);
  const [provider, setProvider] = useState<'tavily' | 'brave'>('tavily');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    ai.getSearchCredential().then((c) => { setCred(c); if (c) setProvider(c.provider); }).catch((e) => setError(msg(e)));
  }, [ai]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setResult(null);
    try { await fn(); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="search-settings">
        <div className="status-row">
          <h3>Bildesøk: Brave eller Tavily</h3>
          {cred ? <Badge tone="moss">{cred.label} · {cred.key_hint}</Badge> : <Badge>Ikke satt opp</Badge>}
        </div>
        <p className="small muted">
          Gir agenten bildesøk når den leter etter bilder av miniatyrer. Brave har et eget bildesøk og gir best resultat.
          Brukes også til vanlig nettsøk når UiB-søket er slått av eller ikke virker.
        </p>
        <div className="field">
          <span className="field-label">Søketjeneste</span>
          <Segmented label="Søketjeneste" value={provider} onChange={setProvider}
            options={[{ value: 'brave', label: 'Brave Search' }, { value: 'tavily', label: 'Tavily' }]} />
        </div>
        <Field label="Nøkkel" hint={cred && cred.provider === provider ? `En nøkkel er lagret (${cred.key_hint}). La feltet stå tomt for å beholde den.` : 'Lim inn API-nøkkelen fra søketjenesten.'}>
          {(id) => <input id={id} type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Lim inn nøkkelen" />}
        </Field>
        <div className="settings-actions">
          <Button variant="primary" disabled={busy || (!key.trim() && (!cred || cred.provider !== provider))} onClick={() => run(async () => {
            setCred(await ai.saveSearchCredential({ provider, ...(key.trim() ? { api_key: key.trim() } : {}) }));
            setKey('');
            setResult('Lagret.');
          })}>Lagre</Button>
          <Button disabled={busy || !cred} onClick={() => run(async () => {
            const r = await ai.testSearch('Zombicide miniatures painted');
            setResult(`Søket virker: ${r.count} treff på ${(r.latency_ms / 1000).toFixed(1)} s${r.first ? `, første: ${r.first.title}` : ''}.`);
          })}>{busy ? 'Vent …' : 'Test søket'}</Button>
          {cred && <Button variant="danger" disabled={busy} onClick={() => run(async () => { await ai.deleteSearchCredential(); setCred(null); })}>Fjern</Button>}
        </div>
        {result && <p className="notice" role="status">{result}</p>}
        <ErrorNote error={error} onClose={() => setError(null)} />
      </div>
    </Card>
  );
}

/** Where the data lives on disk, and backups (server data folder). */
function DataSettings() {
  const [info, setInfo] = useState<{ data_dir: string; revision: number; saved_at: string | null; backups: number; latest_backup: string | null; files: number; bytes: number } | null | 'none'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(() => {
    fetch('/api/data/info').then(async (r) => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return setInfo('none');
      setInfo(await r.json());
    }).catch(() => setInfo('none'));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  if (info === null) return null;
  return (
    <Card>
      <div className="search-settings">
        <div className="status-row">
          <h3>Data</h3>
          {info === 'none' ? <Badge tone="warn">Bare i denne nettleseren</Badge> : <Badge tone="moss">I datamappen</Badge>}
        </div>
        {info === 'none' ? (
          <p className="small muted">Paintrest-serveren kjører ikke, så dataene lagres bare i denne nettleseren. Start appen med <code>npm run dev</code> for å bruke datamappen.</p>
        ) : (
          <>
            <p>Alt lagres i <code>{info.data_dir}</code>: prosjektene i <code>data.json</code>, bildene i <code>files/</code> og sikkerhetskopier i <code>backups/</code>. Mappen kan tas med i Time Machine eller kopieres til en ny maskin.</p>
            <dl className="data-facts">
              <dt>Revisjon</dt><dd>{info.revision}</dd>
              <dt>Sist lagret</dt><dd>{info.saved_at ? new Date(info.saved_at).toLocaleString('nb-NO') : '–'}</dd>
              <dt>Størrelse</dt><dd>{(info.bytes / 1024 / 1024).toFixed(1)} MB data · {info.files} filer</dd>
              <dt>Sikkerhetskopier</dt><dd>{info.backups} (de 30 siste beholdes){info.latest_backup ? ` · siste: ${info.latest_backup}` : ''}</dd>
            </dl>
            <div className="settings-actions">
              <Button onClick={async () => {
                await fetch('/api/data/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                setNotice('Sikkerhetskopi tatt.');
                refresh();
              }}>Ta sikkerhetskopi nå</Button>
            </div>
            <p className="small muted">Gjenoppretting: stopp appen, kopier ønsket fil fra <code>backups/</code> til <code>data.json</code> og start på nytt. Bildene ligger i <code>files/</code> og slettes aldri; de flyttes til <code>files/trash/</code>.</p>
            {notice && <p className="notice" role="status">{notice}</p>}
          </>
        )}
      </div>
    </Card>
  );
}
