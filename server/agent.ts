/**
 * Research agent turn: instructions, call to the Responses API, and parsing
 * of the reply into a message plus draft proposals. The server does not
 * write anything; the client validates proposals against the task scope.
 *
 * The reply format is requested in the instructions (JSON object) rather than
 * through structured-output parameters, because UiB's endpoint serves several
 * model families and support for those parameters is not confirmed.
 */
import type { ResponsesProvider } from './provider.ts';
import { UserError } from './credential-store.ts';

export interface TurnInput {
  context: unknown;
  messages: { role: 'user' | 'assistant'; content: string }[];
  result_types: string[];
  model?: string;
}

export interface TurnResult {
  message: string;
  proposals: unknown[];
  model: string;
  parse_warning: string | null;
}

const MAX_MESSAGES = 30;

export function buildInstructions(context: unknown, resultTypes: string[]): string {
  const allowed = resultTypes.join(', ') || 'ingen';
  return `Du er researchagenten i Paintrest, et personlig arbeidsverktøy for miniatyrmaling.
Du hjelper brukeren å kartlegge miniatyrer i et brettspillprosjekt og lage konkrete maleplaner med eksakte malingsprodukter.
Svar alltid på norsk bokmål.

Regler:
- Du foreslår. Brukeren godkjenner. Du kan ikke endre godkjente data; alt du lager er utkast.
- Du har ikke tilgang til internett eller kilder utover konteksten nedenfor. Ikke påstå at du har lest en kilde. Det du vet fra opplæringen, merkes "synthesized". Det du er usikker på, merkes "unresolved" og forklares i "uncertainty".
- Ikke dikt opp malingsnavn. Bruk eksakte produktnavn med produsent. Foretrekk malinger brukeren eier (ownership "owns" i konteksten). Hvis du foreslår en maling brukeren ikke har, skriv det i "uncertainty".
- Miniatyrer refereres med feltet "ref" (M1, M2 …). Bruk aldri andre id-er.
- En miniatyr med "plan" kan bare få ny plan når "open_for_revision" er true. Ellers: forklar at brukeren må åpne planen for revisjon.
- Tillatte forslagstyper i denne oppgaven: ${allowed}. Lag bare forslag av disse typene. Lag ett forslag per miniatyr eller per maleplan.
- Vil du endre et av dine egne ventende forslag (your_pending_proposals), sett "update_of" til forslagets ref (F1, F2 …) i stedet for å lage et nytt.
- Lag forslag bare når brukeren ber om det eller det tydelig hjelper. Ellers svar bare med en melding.

Svarformat: svar med ETT JSON-objekt og ingenting annet:
{
  "message": "Kort svar til brukeren (vanlig tekst).",
  "proposals": [
    {
      "type": "catalog_subject",
      "evidence": "documented | synthesized | unresolved",
      "uncertainty": [{"path": "physical_count", "reason": "…"}],
      "update_of": null,
      "payload": {"name": "…", "grouping": "single | group", "physical_count": 1, "expansion_name": null, "category_label": null, "count_basis": "documented | inferred | null", "grouping_basis": "documented | inferred | null", "note": null}
    },
    {
      "type": "paint_plan",
      "evidence": "synthesized",
      "uncertainty": [],
      "update_of": null,
      "payload": {
        "subject": "M1",
        "note": "Kort begrunnelse",
        "elements": [
          {"kind": "operation", "name": "Grunning", "steps": [
            {"instruction": "…", "materials": [{"product": {"manufacturer": "Citadel", "range": "Base", "name": "Caliban Green"}, "role": "base", "role_label": null}], "mix": null}
          ]},
          {"kind": "part", "name": "Kappe", "steps": [
            {"instruction": "…", "materials": [], "mix": {"label": "Glasur 1:3", "components": [{"product": {"manufacturer": "…", "range": null, "name": "…"}, "parts": 1}]}}
          ]}
        ]
      }
    }
  ]
}
"role" er en av: base, shade, layer, highlight, wash, glaze, mix, other. "kind" er operation (felles for hele figuren, som grunning og lakk) eller part (en del av figuren).
Felles operasjoner kommer først. Hvert steg har en konkret instruks.

Kontekst (det du kan lese; endres bare av brukeren):
${JSON.stringify(context)}`;
}

/** Finds the JSON object in the reply, also when the model wraps it in prose or a code fence. */
export function parseReply(text: string): { message: string; proposals: unknown[]; warning: string | null } {
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const m of text.matchAll(fence)) if (m[1]) candidates.push(m[1]);
  candidates.push(text);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    try {
      const v = JSON.parse(c.trim());
      if (v && typeof v === 'object' && !Array.isArray(v) && ('message' in v || 'proposals' in v)) {
        return {
          message: typeof v.message === 'string' ? v.message : '',
          proposals: Array.isArray(v.proposals) ? v.proposals : [],
          warning: null,
        };
      }
    } catch {
      // try the next candidate
    }
  }
  return { message: text.trim(), proposals: [], warning: 'Svaret var ikke i forventet format, så eventuelle forslag ble ikke lest inn.' };
}

export async function runTurn(provider: ResponsesProvider, input: TurnInput): Promise<TurnResult> {
  const messages = input.messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES);
  if (!messages.length || messages.at(-1)!.role !== 'user') throw new UserError('Siste melding må være fra brukeren');
  const r = await provider.respond(
    messages.map((m) => ({ role: m.role, content: m.content })),
    { model: input.model, instructions: buildInstructions(input.context, input.result_types), timeoutMs: 180_000 },
  );
  const parsed = parseReply(r.text);
  return { message: parsed.message, proposals: parsed.proposals, model: r.model, parse_warning: parsed.warning };
}
