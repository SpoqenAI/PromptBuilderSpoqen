import type { NodeType } from './models';

export const DEFAULT_NODE_ICON_BY_TYPE: Readonly<Record<NodeType, string>> = {
  'core-persona': 'psychology',
  'mission-objective': 'flag',
  'tone-guidelines': 'record_voice_over',
  'language-model': 'translate',
  'logic-branch': 'alt_route',
  termination: 'call_end',
  'vector-db': 'storage',
  'static-context': 'article',
  'memory-buffer': 'history',
  webhook: 'integration_instructions',
  transcriber: 'mic',
  'llm-brain': 'psychology',
  'voice-synth': 'record_voice_over',
  'style-module': 'palette',
  custom: 'widgets',
};

const CURATED_NODE_ICONS: readonly string[] = [
  'psychology',
  'flag',
  'record_voice_over',
  'translate',
  'alt_route',
  'call_end',
  'storage',
  'article',
  'history',
  'integration_instructions',
  'mic',
  'widgets',
  'hub',
  'schema',
  'bolt',
  'smart_toy',
  'terminal',
  'code',
  'memory',
  'science',
  'auto_awesome',
  'construction',
  'cloud',
  'dns',
  'extension',
  'flare',
  'functions',
  'grid_view',
  'insights',
  'key',
  'lightbulb',
  'link',
  'model_training',
  'network_check',
  'offline_bolt',
  'pending',
  'policy',
  'query_stats',
  'robot',
  'settings',
  'speed',
  'star',
  'sync',
  'timeline',
  'track_changes',
  'transform',
  'tune',
  'visibility',
  'warning',
  'wifi',
  'work',
];

const ALLOWED_NODE_ICONS = new Set<string>([
  ...CURATED_NODE_ICONS,
  ...Object.values(DEFAULT_NODE_ICON_BY_TYPE),
]);

export function normalizeIconName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

export function resolveNodeIcon(rawIcon: unknown, type: NodeType): string {
  if (typeof rawIcon === 'string') {
    const normalized = normalizeIconName(rawIcon);
    if (normalized.length > 0 && normalized.length <= 32 && ALLOWED_NODE_ICONS.has(normalized)) {
      return normalized;
    }
  }

  return DEFAULT_NODE_ICON_BY_TYPE[type];
}
