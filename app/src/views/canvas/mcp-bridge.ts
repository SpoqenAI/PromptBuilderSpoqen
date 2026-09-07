import type { McpRelayConfig } from './types';

export function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function normalizeRelayBaseUrl(rawValue: string): URL | null {
  try {
    const url = new URL(rawValue, window.location.origin);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

export function buildRelaySocketUrl(segment: 'canvas-sync' | 'agent-relay', baseUrl: URL | null): string {
  if (!baseUrl) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/${segment}`;
  }

  const relayUrl = new URL(baseUrl.toString());
  relayUrl.protocol = relayUrl.protocol === 'https:' || relayUrl.protocol === 'wss:' ? 'wss:' : 'ws:';

  const normalizedPath = relayUrl.pathname.replace(/\/+$/, '');
  const hasSegmentPath = normalizedPath === `/${segment}` || normalizedPath.endsWith(`/${segment}`);
  if (hasSegmentPath) {
    relayUrl.pathname = normalizedPath || `/${segment}`;
  } else {
    const pathPrefix = normalizedPath && normalizedPath !== '/' ? normalizedPath : '';
    relayUrl.pathname = `${pathPrefix}/${segment}`.replace(/\/{2,}/g, '/');
  }

  relayUrl.search = '';
  relayUrl.hash = '';
  return relayUrl.toString();
}

export function resolveMcpRelayConfig(): McpRelayConfig {
  const enabledByEnv = parseBooleanEnv(import.meta.env.NEXT_PUBLIC_ENABLE_MCP_RELAY, import.meta.env.DEV);
  if (!enabledByEnv) {
    return {
      enabled: false,
      canvasSyncUrl: null,
      agentRelayUrl: null,
      reason: 'MCP relay is disabled. Set NEXT_PUBLIC_ENABLE_MCP_RELAY=true to enable agent sync.',
    };
  }

  const rawRelayUrl = import.meta.env.NEXT_PUBLIC_MCP_RELAY_URL?.trim();
  const relayBaseUrl = rawRelayUrl ? normalizeRelayBaseUrl(rawRelayUrl) : null;
  if (rawRelayUrl && !relayBaseUrl) {
    return {
      enabled: false,
      canvasSyncUrl: null,
      agentRelayUrl: null,
      reason: 'Invalid NEXT_PUBLIC_MCP_RELAY_URL. Use an http(s) or ws(s) URL.',
    };
  }

  return {
    enabled: true,
    canvasSyncUrl: buildRelaySocketUrl('canvas-sync', relayBaseUrl),
    agentRelayUrl: buildRelaySocketUrl('agent-relay', relayBaseUrl),
    reason: null,
  };
}
