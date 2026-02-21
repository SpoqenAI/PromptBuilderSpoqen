const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const NODE_COLOR_META_KEY = 'nodeColor';
export const DEFAULT_NODE_COLOR = '#23956F';

export const NODE_AUTO_COLORS: readonly string[] = [
  '#23956F',
  '#3B82F6',
  '#8B5CF6',
  '#F59E0B',
  '#EC4899',
  '#14B8A6',
  '#EF4444',
  '#6366F1',
] as const;

export interface NodeColorStyles {
  border: string;
  headerBackground: string;
  headerBorder: string;
  icon: string;
  footerBorder: string;
  tokenText: string;
  ring: string;
  minimapFill: string;
  minimapStroke: string;
}

export function getAutoNodeColor(index: number): string {
  const palette = NODE_AUTO_COLORS;
  return palette[Math.abs(index) % palette.length] ?? DEFAULT_NODE_COLOR;
}

export function normalizeNodeColor(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return null;
  if (trimmed.length === 4) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return trimmed.toUpperCase();
}

export function readNodeColorMeta(meta: Record<string, string> | null | undefined): string | null {
  if (!meta) return null;
  return normalizeNodeColor(meta[NODE_COLOR_META_KEY]);
}

export function withNodeColorMeta(
  meta: Record<string, string> | null | undefined,
  color: string | null | undefined,
): Record<string, string> {
  const nextMeta = { ...(meta ?? {}) };
  const normalized = normalizeNodeColor(color);
  if (!normalized) {
    delete nextMeta[NODE_COLOR_META_KEY];
    return nextMeta;
  }
  nextMeta[NODE_COLOR_META_KEY] = normalized;
  return nextMeta;
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const normalized = normalizeNodeColor(hex) ?? DEFAULT_NODE_COLOR;
  const raw = normalized.slice(1);
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

export function buildNodeColorStyles(color: string | null | undefined): NodeColorStyles {
  const base = normalizeNodeColor(color) ?? DEFAULT_NODE_COLOR;
  return {
    border: rgbaFromHex(base, 0.42),
    headerBackground: rgbaFromHex(base, 0.12),
    headerBorder: rgbaFromHex(base, 0.22),
    icon: base,
    footerBorder: rgbaFromHex(base, 0.16),
    tokenText: rgbaFromHex(base, 0.66),
    ring: rgbaFromHex(base, 0.3),
    minimapFill: rgbaFromHex(base, 0.45),
    minimapStroke: rgbaFromHex(base, 0.85),
  };
}
