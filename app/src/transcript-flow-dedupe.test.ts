import { describe, expect, it } from 'vitest';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'with', 'and', 'or',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'customer', 'caller', 'user', 'agent',
]);

function canonicalNodeKey(label: string, type: string): string {
  const tokens = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  tokens.sort();
  return `${tokens.join(' ')}|${type}`;
}

function tokenJaccard(a: string, b: string): number {
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

interface FlowNode {
  id: string;
  label: string;
  type: string;
  content: string;
}

interface FlowConnection {
  from: string;
  to: string;
  reason: string;
}

function deduplicateNodes(
  nodes: FlowNode[],
  connections: FlowConnection[],
): { nodes: FlowNode[]; connections: FlowConnection[] } {
  const groups = new Map<string, FlowNode[]>();
  for (const node of nodes) {
    const key = canonicalNodeKey(node.label, node.type);
    const group = groups.get(key);
    if (group) {
      group.push(node);
    } else {
      groups.set(key, [node]);
    }
  }

  const mergeMap = new Map<string, string>();

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const canonical = group[0];
    for (let i = 1; i < group.length; i++) {
      const dup = group[i];
      const keyA = canonicalNodeKey(canonical.label, canonical.type);
      const keyB = canonicalNodeKey(dup.label, dup.type);
      const tokensA = keyA.split('|')[0];
      const tokensB = keyB.split('|')[0];
      if (tokenJaccard(tokensA, tokensB) < 0.8) continue;
      mergeMap.set(dup.id, canonical.id);
    }
  }

  if (mergeMap.size === 0) {
    return { nodes, connections };
  }

  const resolve = (id: string): string => mergeMap.get(id) ?? id;
  const keptIds = new Set<string>();
  const dedupedNodes: FlowNode[] = [];
  for (const node of nodes) {
    if (mergeMap.has(node.id)) continue;
    if (keptIds.has(node.id)) continue;
    keptIds.add(node.id);
    dedupedNodes.push(node);
  }

  const seenConns = new Set<string>();
  const dedupedConns: FlowConnection[] = [];
  for (const conn of connections) {
    const from = resolve(conn.from);
    const to = resolve(conn.to);
    if (from === to) continue;
    const key = `${from}->${to}->${(conn.reason ?? '').toLowerCase().trim()}`;
    if (seenConns.has(key)) continue;
    seenConns.add(key);
    dedupedConns.push({ ...conn, from, to });
  }

  return { nodes: dedupedNodes, connections: dedupedConns };
}

describe('canonicalNodeKey', () => {
  it('normalizes labels by removing stopwords and sorting tokens', () => {
    expect(canonicalNodeKey('Verify Caller Identity', 'process'))
      .toBe('identity verify|process');
    expect(canonicalNodeKey('Verify Customer Identity', 'process'))
      .toBe('identity verify|process');
  });

  it('strips punctuation', () => {
    expect(canonicalNodeKey('Offer (discount)', 'process'))
      .toBe('discount offer|process');
  });

  it('differentiates by node type', () => {
    expect(canonicalNodeKey('Check Status', 'process'))
      .not.toBe(canonicalNodeKey('Check Status', 'decision'));
  });
});

describe('tokenJaccard', () => {
  it('returns 1 for identical token sets', () => {
    expect(tokenJaccard('verify identity', 'verify identity')).toBe(1);
  });

  it('returns 0 for completely disjoint sets', () => {
    expect(tokenJaccard('verify identity', 'offer discount')).toBe(0);
  });

  it('returns correct partial overlap', () => {
    expect(tokenJaccard('verify identity check', 'verify identity')).toBeCloseTo(2 / 3);
  });
});

describe('deduplicateNodes', () => {
  it('merges nodes with the same canonical key', () => {
    const nodes: FlowNode[] = [
      { id: 'n1', label: 'Start', type: 'start', content: '' },
      { id: 'n2', label: 'Verify Caller Identity', type: 'process', content: 'Step A' },
      { id: 'n3', label: 'Verify Customer Identity', type: 'process', content: 'Step B' },
      { id: 'n4', label: 'End Call', type: 'end', content: '' },
    ];
    const connections: FlowConnection[] = [
      { from: 'n1', to: 'n2', reason: 'Next' },
      { from: 'n1', to: 'n3', reason: 'Alt' },
      { from: 'n2', to: 'n4', reason: 'Done' },
      { from: 'n3', to: 'n4', reason: 'Done' },
    ];

    const result = deduplicateNodes(nodes, connections);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n4']);
    expect(result.connections.find((c) => c.from === 'n1' && c.to === 'n3')).toBeUndefined();
    expect(result.connections.filter((c) => c.to === 'n2')).toHaveLength(2);
  });

  it('removes self-loops created by merging', () => {
    const nodes: FlowNode[] = [
      { id: 'n1', label: 'Verify Identity', type: 'process', content: '' },
      { id: 'n2', label: 'Verify Identity', type: 'process', content: '' },
    ];
    const connections: FlowConnection[] = [
      { from: 'n1', to: 'n2', reason: 'Next' },
    ];

    const result = deduplicateNodes(nodes, connections);
    expect(result.nodes).toHaveLength(1);
    expect(result.connections).toHaveLength(0);
  });

  it('does not merge nodes of different types', () => {
    const nodes: FlowNode[] = [
      { id: 'n1', label: 'Check Status', type: 'process', content: '' },
      { id: 'n2', label: 'Check Status', type: 'decision', content: '' },
    ];
    const connections: FlowConnection[] = [
      { from: 'n1', to: 'n2', reason: 'Next' },
    ];

    const result = deduplicateNodes(nodes, connections);
    expect(result.nodes).toHaveLength(2);
  });

  it('deduplicates connections after merging', () => {
    const nodes: FlowNode[] = [
      { id: 'n1', label: 'Start', type: 'start', content: '' },
      { id: 'n2', label: 'Verify Identity', type: 'process', content: '' },
      { id: 'n3', label: 'Verify Identity', type: 'process', content: '' },
      { id: 'n4', label: 'End', type: 'end', content: '' },
    ];
    const connections: FlowConnection[] = [
      { from: 'n2', to: 'n4', reason: 'Done' },
      { from: 'n3', to: 'n4', reason: 'Done' },
    ];

    const result = deduplicateNodes(nodes, connections);
    expect(result.connections.filter((c) => c.from === 'n2' && c.to === 'n4')).toHaveLength(1);
  });

  it('returns unchanged nodes/connections when there are no duplicates', () => {
    const nodes: FlowNode[] = [
      { id: 'n1', label: 'Start', type: 'start', content: '' },
      { id: 'n2', label: 'Process Payment', type: 'process', content: '' },
      { id: 'n3', label: 'End Call', type: 'end', content: '' },
    ];
    const connections: FlowConnection[] = [
      { from: 'n1', to: 'n2', reason: 'Next' },
      { from: 'n2', to: 'n3', reason: 'Done' },
    ];

    const result = deduplicateNodes(nodes, connections);
    expect(result.nodes).toBe(nodes);
    expect(result.connections).toBe(connections);
  });

  it('handles flow with repeated intent nodes merging to single node with multiple incoming edges', () => {
    const nodes: FlowNode[] = [
      { id: 'n1', label: 'Start', type: 'start', content: '' },
      { id: 'n2', label: 'Identity Check', type: 'process', content: 'First check' },
      { id: 'n3', label: 'Process request', type: 'process', content: '' },
      { id: 'n4', label: 'Identity Check', type: 'process', content: 'Second check' },
      { id: 'n5', label: 'End', type: 'end', content: '' },
    ];
    const connections: FlowConnection[] = [
      { from: 'n1', to: 'n2', reason: 'Start' },
      { from: 'n2', to: 'n3', reason: 'Verified' },
      { from: 'n3', to: 'n4', reason: 'Re-verify' },
      { from: 'n4', to: 'n5', reason: 'Done' },
    ];

    const result = deduplicateNodes(nodes, connections);
    expect(result.nodes.filter((n) => n.label === 'Identity Check')).toHaveLength(1);
    const checkNode = result.nodes.find((n) => n.label === 'Identity Check')!;
    const incoming = result.connections.filter((c) => c.to === checkNode.id);
    expect(incoming.length).toBeGreaterThanOrEqual(2);
  });
});
