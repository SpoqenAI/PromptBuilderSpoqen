/**
 * Gemini 2.5 Flash Lite provider with tool-calling (function-calling) support.
 *
 * Uses the Google Generative Language REST API directly (no SDK needed in Deno).
 * Implements a multi-turn agent loop: the model emits `functionCall` parts,
 * the caller executes them and feeds `functionResponse` parts back, repeating
 * until the model produces a text response or a hard iteration cap is hit.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export type GeminiPart =
  | { text: string }
  | { functionCall: GeminiFunctionCall }
  | { functionResponse: GeminiFunctionResponse };

export interface GeminiAgentRequest {
  /** System instruction (injected as `systemInstruction`). */
  systemPrompt: string;
  /** Initial user message (the transcript + instructions). */
  userMessage: string;
  /** Tool declarations the model may call. */
  tools: GeminiTool[];
  /**
   * Called for each `functionCall` the model emits.
   * Must return a JSON-serialisable result object.
   */
  executeTool: (call: GeminiFunctionCall) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Hard cap on agent iterations (default 30). */
  maxIterations?: number;
  /** Temperature (default 0.3). */
  temperature?: number;
  /**
   * Optional callback fired after each iteration with the current tool-call
   * exchange, useful for logging or progress reporting.
   */
  onIteration?: (iteration: number, calls: GeminiFunctionCall[]) => void;
}

export interface GeminiAgentResult {
  /** Final text response from the model (empty string if loop exhausted). */
  text: string;
  /** Total number of agent loop iterations executed. */
  iterations: number;
  /** Every tool call made during the session, in order. */
  toolCallLog: GeminiFunctionCall[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_MAX_ITERATIONS = 30;
const DEFAULT_TEMPERATURE = 0.3;
const EMPTY_RESPONSE_RETRY_LIMIT = 2;
const EMPTY_RESPONSE_RETRY_DELAY_MS = 250;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs an agent loop against Gemini.
 *
 * 1. Sends the system prompt + user message + tool declarations.
 * 2. If the model replies with `functionCall` parts, executes them via
 *    `executeTool` and appends `functionResponse` parts.
 * 3. Repeats until the model replies with text or the iteration cap is hit.
 */
export async function runGeminiAgentLoop(request: GeminiAgentRequest): Promise<GeminiAgentResult> {
  const apiKey = resolveApiKey();
  const model = resolveModel();
  const maxIterations = request.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const temperature = request.temperature ?? DEFAULT_TEMPERATURE;

  const conversationHistory: GeminiMessage[] = [
    {
      role: 'user',
      parts: [{ text: request.userMessage }],
    },
  ];

  const toolCallLog: GeminiFunctionCall[] = [];
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;

    const body = buildRequestBody({
      systemPrompt: request.systemPrompt,
      history: conversationHistory,
      tools: request.tools,
      temperature,
    });

    const parts = await requestResponseParts(model, apiKey, body);
    const functionCalls = extractFunctionCalls(parts);
    const textParts = extractTextParts(parts);

    // If the model returned text (no function calls), we're done.
    if (functionCalls.length === 0) {
      return {
        text: textParts.join('\n').trim(),
        iterations,
        toolCallLog,
      };
    }

    // Append the model's function-call turn to history.
    conversationHistory.push({
      role: 'model',
      parts: functionCalls.map((fc) => ({ functionCall: fc })),
    });

    // Execute each tool call and collect responses.
    const responseParts: GeminiPart[] = [];
    for (const call of functionCalls) {
      toolCallLog.push(call);
      try {
        const result = await request.executeTool(call);
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: result,
          },
        });
      } catch (err) {
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              error: err instanceof Error ? err.message : String(err),
            },
          },
        });
      }
    }

    // Append tool results as a user turn.
    conversationHistory.push({
      role: 'user',
      parts: responseParts,
    });

    request.onIteration?.(iterations, functionCalls);
  }

  // Max iterations exhausted — return whatever we have.
  return {
    text: '',
    iterations,
    toolCallLog,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface GeminiApiResponse {
  promptFeedback?: {
    blockReason?: string;
    blockReasonMessage?: string;
  };
  candidates?: Array<{
    finishReason?: string;
    finishMessage?: string;
    content?: {
      parts?: Array<Record<string, unknown>>;
    };
  }>;
}

async function requestResponseParts(
  model: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  for (let attempt = 0; attempt <= EMPTY_RESPONSE_RETRY_LIMIT; attempt++) {
    const response = await fetch(
      `${API_BASE}/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as GeminiApiResponse;
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (Array.isArray(parts)) {
      return parts;
    }

    const emptyResponseError = describeEmptyResponse(data);
    if (!emptyResponseError.retryable || attempt === EMPTY_RESPONSE_RETRY_LIMIT) {
      throw new Error(emptyResponseError.message);
    }

    await delay(EMPTY_RESPONSE_RETRY_DELAY_MS * (attempt + 1));
  }

  throw new Error('Gemini returned an empty response with no content parts.');
}

function describeEmptyResponse(data: GeminiApiResponse): { message: string; retryable: boolean } {
  const candidate = data.candidates?.[0];
  const blockReason = normalizeReason(data.promptFeedback?.blockReason);
  const blockMessage = normalizeReason(data.promptFeedback?.blockReasonMessage);
  if (blockReason) {
    const details = blockMessage ? `: ${blockMessage}` : '';
    return {
      message: `Gemini blocked the transcript-flow request (${blockReason})${details}.`,
      retryable: false,
    };
  }

  const finishReason = normalizeReason(candidate?.finishReason);
  const finishMessage = normalizeReason(candidate?.finishMessage);
  if (finishReason) {
    const details = finishMessage ? `: ${finishMessage}` : '';
    return {
      message: `Gemini returned no content parts (finish reason: ${finishReason})${details}.`,
      retryable: false,
    };
  }

  return {
    message: 'Gemini returned an empty response with no content parts.',
    retryable: true,
  };
}

function normalizeReason(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveApiKey(): string {
  const key = (Deno.env.get('GEMINI_API_KEY') ?? '').trim();
  if (!key) {
    throw new Error('Missing GEMINI_API_KEY environment variable.');
  }
  return key;
}

function resolveModel(): string {
  const override = (Deno.env.get('GEMINI_MODEL') ?? '').trim();
  return override || DEFAULT_MODEL;
}

function buildRequestBody(args: {
  systemPrompt: string;
  history: GeminiMessage[];
  tools: GeminiTool[];
  temperature: number;
}): Record<string, unknown> {
  return {
    systemInstruction: {
      parts: [{ text: args.systemPrompt }],
    },
    contents: args.history,
    tools: [
      {
        functionDeclarations: args.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    ],
    generationConfig: {
      temperature: args.temperature,
    },
  };
}

function extractFunctionCalls(parts: Array<Record<string, unknown>>): GeminiFunctionCall[] {
  const calls: GeminiFunctionCall[] = [];
  for (const part of parts) {
    if (part.functionCall && typeof part.functionCall === 'object') {
      const fc = part.functionCall as Record<string, unknown>;
      const name = typeof fc.name === 'string' ? fc.name : '';
      const args = (typeof fc.args === 'object' && fc.args !== null && !Array.isArray(fc.args))
        ? fc.args as Record<string, unknown>
        : {};
      if (name) {
        calls.push({ name, args });
      }
    }
  }
  return calls;
}

function extractTextParts(parts: Array<Record<string, unknown>>): string[] {
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part.text === 'string' && part.text.trim().length > 0) {
      texts.push(part.text);
    }
  }
  return texts;
}
