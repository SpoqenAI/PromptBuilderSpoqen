export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface StructuredJsonRequest {
  messages: LlmMessage[];
  schema: Record<string, unknown>;
  schemaName: string;
  temperature?: number | null;
  maxTokens?: number;
  groqModel?: string;
  openAiModel?: string;
}

export interface StructuredJsonResult {
  provider: 'groq' | 'openai';
  model: string;
  payload: unknown;
}

interface ProviderAttempt {
  provider: 'groq' | 'openai';
  model: string;
  apiKey: string;
}

const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_OPENAI_MODEL = 'gpt-5-nano';

export function resolveDefaultGroqModel(): string {
  return (Deno.env.get('GROQ_MODEL') ?? DEFAULT_GROQ_MODEL).trim() || DEFAULT_GROQ_MODEL;
}

export function resolveDefaultOpenAiModel(): string {
  return (Deno.env.get('OPENAI_TRANSCRIPT_MODEL') ?? DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
}

export async function generateStructuredJson(request: StructuredJsonRequest): Promise<StructuredJsonResult> {
  const attempts = buildAttempts(request);
  if (attempts.length === 0) {
    throw new Error('No LLM API key configured (expected GROQ_API_KEY or OPENAI_API_KEY).');
  }

  const failures: string[] = [];

  for (const attempt of attempts) {
    try {
      const content = attempt.provider === 'groq'
        ? await callGroqJson(request, attempt)
        : await callOpenAiJson(request, attempt);
      const payload = JSON.parse(content) as unknown;
      return {
        provider: attempt.provider,
        model: attempt.model,
        payload,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${attempt.provider}/${attempt.model}: ${message}`);
    }
  }

  throw new Error(`All LLM providers failed: ${failures.join(' | ')}`);
}

function buildAttempts(request: StructuredJsonRequest): ProviderAttempt[] {
  const attempts: ProviderAttempt[] = [];
  const groqKey = (Deno.env.get('GROQ_API_KEY') ?? '').trim();
  const openAiKey = (Deno.env.get('OPENAI_API_KEY') ?? '').trim();

  if (groqKey) {
    attempts.push({
      provider: 'groq',
      model: (request.groqModel ?? resolveDefaultGroqModel()).trim() || DEFAULT_GROQ_MODEL,
      apiKey: groqKey,
    });
  }
  if (openAiKey) {
    attempts.push({
      provider: 'openai',
      model: (request.openAiModel ?? resolveDefaultOpenAiModel()).trim() || DEFAULT_OPENAI_MODEL,
      apiKey: openAiKey,
    });
  }

  return attempts;
}

async function callGroqJson(request: StructuredJsonRequest, attempt: ProviderAttempt): Promise<string> {
  const body: Record<string, unknown> = {
    model: attempt.model,
    messages: request.messages,
    response_format: { type: 'json_object' },
  };
  if (typeof request.maxTokens === 'number' && Number.isFinite(request.maxTokens) && request.maxTokens > 0) {
    body.max_tokens = Math.trunc(request.maxTokens);
  }
  if (typeof request.temperature === 'number' && Number.isFinite(request.temperature)) {
    body.temperature = request.temperature;
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${attempt.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(extractProviderError(payload) ?? `Groq request failed with status ${response.status}.`);
  }

  const content = extractAssistantContent(payload);
  if (!content) {
    throw new Error('Groq response did not contain JSON content.');
  }
  return content;
}

async function callOpenAiJson(request: StructuredJsonRequest, attempt: ProviderAttempt): Promise<string> {
  const body: Record<string, unknown> = {
    model: attempt.model,
    messages: request.messages,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: request.schemaName,
        strict: true,
        schema: request.schema,
      },
    },
  };
  if (typeof request.temperature === 'number' && Number.isFinite(request.temperature)) {
    body.temperature = request.temperature;
  }
  if (typeof request.maxTokens === 'number' && Number.isFinite(request.maxTokens) && request.maxTokens > 0) {
    body.max_completion_tokens = Math.trunc(request.maxTokens);
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${attempt.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(extractProviderError(payload) ?? `OpenAI request failed with status ${response.status}.`);
  }

  const content = extractAssistantContent(payload);
  if (!content) {
    throw new Error('OpenAI response did not contain JSON content.');
  }
  return content;
}

function extractProviderError(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const directError = payload.error;
  if (isRecord(directError) && typeof directError.message === 'string' && directError.message.trim().length > 0) {
    return directError.message;
  }
  if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
    return payload.message;
  }
  return null;
}

function extractAssistantContent(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return null;
  }

  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    return null;
  }

  const content = choice.message.content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }

  if (!Array.isArray(content)) return null;

  const textParts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    const text = typeof part.text === 'string' ? part.text : '';
    if (text.trim().length > 0) {
      textParts.push(text);
    }
  }
  return textParts.length > 0 ? textParts.join('') : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
