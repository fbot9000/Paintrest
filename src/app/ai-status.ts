/**
 * Whether the agent can run here: the Paintrest server answers and a key is saved.
 * One check is shared by every screen for 30 seconds; settings clear it when the key changes.
 */
import { useEffect, useState } from 'react';
import type { AiGateway } from '../domain/ai';
import { useApp } from './context';

export type AiStatus = 'checking' | 'no-server' | 'no-key' | 'ready';

let cached: { at: number; ai: AiGateway; result: Promise<AiStatus> } | null = null;

function checkAi(ai: AiGateway): Promise<AiStatus> {
  if (cached && cached.ai === ai && Date.now() - cached.at < 30_000) return cached.result;
  const result = ai.getCredential()
    .then((r): AiStatus => (r.status === 'unavailable' ? 'no-server' : r.credential ? 'ready' : 'no-key'))
    .catch((): AiStatus => 'no-server');
  cached = { at: Date.now(), ai, result };
  return result;
}

/** Call after the key is saved or deleted. */
export function forgetAiStatus(): void {
  cached = null;
}

export function useAiStatus(): AiStatus {
  const { ai } = useApp();
  const [status, setStatus] = useState<AiStatus>('checking');
  useEffect(() => {
    let live = true;
    checkAi(ai).then((s) => live && setStatus(s));
    return () => { live = false; };
  }, [ai]);
  return status;
}
