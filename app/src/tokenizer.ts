/**
 * Tokenizer — Real OpenAI BPE tokenization via tiktoken (cl100k_base / GPT-4).
 * Falls back to regex approximation while WASM loads.
 */
import { init, get_encoding, type Tiktoken } from 'tiktoken/init';

// ── WASM lazy initialization ──────────────────────────────
let encoder: Tiktoken | null = null;
let initStarted = false;
let onReady: (() => void) | null = null;

/** Promise that resolves once tiktoken WASM is ready. */
export const tiktokenReady: Promise<void> = new Promise((resolve) => {
  onReady = resolve;
});

async function ensureEncoder(): Promise<void> {
  if (encoder || initStarted) return;
  initStarted = true;
  try {
    // Fetch the WASM binary from node_modules via Vite
    const wasmModule = await import('tiktoken/tiktoken_bg.wasm?url');
    const wasmUrl: string = wasmModule.default;
    await init(async (imports: WebAssembly.Imports) => {
      const res = await fetch(wasmUrl);
      return WebAssembly.instantiate(await res.arrayBuffer(), imports);
    });
    encoder = get_encoding('cl100k_base');
    onReady?.();
  } catch (e) {
    console.warn('tiktoken WASM init failed, using regex fallback:', e);
    onReady?.();
  }
}

// Start loading immediately on module load
ensureEncoder();

// ── Fallback regex (GPT-2 BPE pre-tokenization pattern) ──
const GPT2_PATTERN =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

export interface Token {
  text: string;
  index: number;
  colorClass: string;
}

const COLOR_CLASSES = ['token-1', 'token-2', 'token-3', 'token-4', 'token-5', 'token-6'];

/**
 * Tokenize text into displayable tokens.
 * Uses real tiktoken if WASM is loaded, regex fallback otherwise.
 */
export function tokenize(text: string): Token[] {
  if (!text) return [];

  if (encoder) {
    // Real tiktoken tokenization
    const ids = encoder.encode(text);
    const tokens: Token[] = [];
    for (let i = 0; i < ids.length; i++) {
      const bytes = encoder.decode_single_token_bytes(ids[i]);
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      tokens.push({
        text: decoded,
        index: i,
        colorClass: COLOR_CLASSES[i % COLOR_CLASSES.length],
      });
    }
    return tokens;
  }

  // Regex fallback
  const matches = text.match(GPT2_PATTERN);
  if (!matches) return [];
  return matches.map((tok, i) => ({
    text: tok,
    index: i,
    colorClass: COLOR_CLASSES[i % COLOR_CLASSES.length],
  }));
}

export type ModelTokenFamily = 'cl100k' | 'o200k' | 'gemini' | 'llama' | 'claude';

export function detectModelFamily(model?: string): ModelTokenFamily {
  if (!model) return 'cl100k';
  const m = model.toLowerCase();
  if (m.includes('gpt-4o') || m.includes('o1') || m.includes('o3') || m.includes('o200k')) return 'o200k';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('llama') || m.includes('groq')) return 'llama';
  if (m.includes('claude') || m.includes('anthropic')) return 'claude';
  return 'cl100k';
}

/**
 * Relative token efficiency ratio compared to cl100k_base baseline.
 * Values < 1.0 mean fewer tokens are generated for the same text (denser vocabulary).
 */
export function getModelTokenRatio(model?: string): number {
  const family = detectModelFamily(model);
  switch (family) {
    case 'o200k':
      return 0.88; // o200k vocab produces ~12% fewer tokens on average
    case 'gemini':
      return 0.95; // 256k vocab is slightly more compact
    case 'llama':
      return 0.96; // 128k vocab
    case 'claude':
      return 1.02;
    case 'cl100k':
    default:
      return 1.0;
  }
}

/**
 * Count tokens in text, optionally scaled for specific model tokenizers.
 */
export function countTokens(text: string, model?: string): number {
  if (!text) return 0;
  let baseCount = 0;
  if (encoder) {
    baseCount = encoder.encode(text).length;
  } else {
    const matches = text.match(GPT2_PATTERN);
    baseCount = matches ? matches.length : 0;
  }

  if (model) {
    const ratio = getModelTokenRatio(model);
    return Math.max(1, Math.round(baseCount * ratio));
  }
  return baseCount;
}


/** Whether real tiktoken is active (WASM loaded). */
export function isRealTokenizer(): boolean {
  return encoder !== null;
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Render text as highlighted token spans. Newlines become <br/>.
 */
export function toHighlightedHTML(text: string, active: boolean): string {
  if (!text) return '';
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!active) return escapeHTML(normalized).replace(/\n/g, '<br/>');
  const tokens = tokenize(normalized);
  return tokens
    .map((t) => {
      const escaped = escapeHTML(t.text);
      const html = escaped.replace(/\n/g, '<br/>');
      return `<span class="${t.colorClass}" title="Token ${t.index}">${html}</span>`;
    })
    .join('');
}
