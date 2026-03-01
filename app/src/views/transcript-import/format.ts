import type { MessageTone } from './types';

export function renderModelOptions(selectedModel: string): string {
  const models = ['GPT-4o', 'Claude 3.5', 'GPT-4 Turbo', 'Llama 3'];
  return models
    .map((model) => `<option value="${model}" ${model === selectedModel ? 'selected' : ''}>${model}</option>`)
    .join('');
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function messageClass(tone: MessageTone): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-200';
    case 'error':
      return 'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-200';
    default:
      return 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200';
  }
}

export function shortId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function formatIsoDate(value: string | null): string {
  if (!value) return 'unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function trimForPreview(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

export function esc(value: string): string {
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
