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

/**
 * Count tokens in text.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  if (encoder) {
    return encoder.encode(text).length;
  }
  const matches = text.match(GPT2_PATTERN);
  return matches ? matches.length : 0;
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
