/**
 * Client view of the AI key (skjema §4: clients never see the key).
 * The browser only ever sends the key once, when the user saves it,
 * and only ever receives the public view below.
 */
export interface AiCredentialView {
  id: string;
  provider: string;
  label: string;
  base_url: string;
  default_model: string | null;
  key_hint: string;
  created_at: string;
  updated_at: string;
}

export interface AiSettingsInput {
  label: string;
  base_url: string;
  /** Leave out to keep the stored key. */
  api_key?: string;
  default_model: string | null;
}

export interface AiTestResult {
  ok: true;
  model: string;
  text: string;
  latency_ms: number;
}

export interface AgentTurnInput {
  context: unknown;
  messages: { role: 'user' | 'assistant'; content: string }[];
  result_types: string[];
  model?: string;
}

export interface AgentTurnResult {
  message: string;
  /** Raw proposals from the model; validated on the client against the task scope. */
  proposals: unknown[];
  model: string;
  parse_warning: string | null;
}

export interface AiGateway {
  /** `unavailable` when the app runs without its server (e.g. a static preview). */
  getCredential(): Promise<{ status: 'ok'; credential: AiCredentialView | null } | { status: 'unavailable' }>;
  saveCredential(input: AiSettingsInput): Promise<AiCredentialView>;
  deleteCredential(): Promise<void>;
  listModels(): Promise<string[]>;
  test(model?: string): Promise<AiTestResult>;
  agentTurn(input: AgentTurnInput): Promise<AgentTurnResult>;
}
