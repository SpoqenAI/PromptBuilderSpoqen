import { describe, expect, it } from 'vitest';
import { storeTestUtils } from './store';
import type { PromptNode, Connection } from './models';

describe('store graph assembly and helpers', () => {
  const createMockNode = (id: string, label: string, type = 'core-persona'): PromptNode => ({
    id,
    label,
    type: type as any,
    icon: 'user',
    x: 0,
    y: 0,
    content: `Content of ${label}`,
    meta: {},
  });

  describe('buildGraphAssemblyPlan', () => {
    it('orders nodes topologically in a directed acyclic graph', () => {
      const nodeA = createMockNode('a', 'Start');
      const nodeB = createMockNode('b', 'Middle');
      const nodeC = createMockNode('c', 'End');

      const connections: Connection[] = [
        { id: 'c1', from: 'a', to: 'b' },
        { id: 'c2', from: 'b', to: 'c' },
      ];

      const plan = storeTestUtils.buildGraphAssemblyPlan({
        nodes: [nodeC, nodeA, nodeB], // scrambled initial order
        connections,
      });

      expect(plan.hasCycle).toBe(false);
      expect(plan.orderedNodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
      expect(plan.outgoingByFrom.get('a')).toHaveLength(1);
      expect(plan.incomingByTo.get('c')).toHaveLength(1);
    });

    it('detects cycles and still includes all nodes', () => {
      const nodeA = createMockNode('a', 'Node A');
      const nodeB = createMockNode('b', 'Node B');

      const connections: Connection[] = [
        { id: 'c1', from: 'a', to: 'b' },
        { id: 'c2', from: 'b', to: 'a' },
      ];

      const plan = storeTestUtils.buildGraphAssemblyPlan({
        nodes: [nodeA, nodeB],
        connections,
      });

      expect(plan.hasCycle).toBe(true);
      expect(plan.orderedNodes).toHaveLength(2);
    });

    it('handles disconnected nodes gracefully', () => {
      const nodeA = createMockNode('a', 'Node A');
      const nodeB = createMockNode('b', 'Node B');
      const nodeC = createMockNode('c', 'Isolated Node');

      const connections: Connection[] = [
        { id: 'c1', from: 'a', to: 'b' },
      ];

      const plan = storeTestUtils.buildGraphAssemblyPlan({
        nodes: [nodeA, nodeB, nodeC],
        connections,
      });

      expect(plan.hasCycle).toBe(false);
      expect(plan.orderedNodes).toHaveLength(3);
      expect(plan.orderedNodes.map((n) => n.id)).toContain('c');
    });
  });

  describe('formatting and normalization', () => {
    it('formats connection targets with and without branch labels', () => {
      const nodeMap = new Map<string, PromptNode>([
        ['target', createMockNode('target', 'Target Step')],
      ]);

      const connWithLabel: Connection = { id: 'c1', from: 'source', to: 'target', label: 'If Approved' };
      expect(storeTestUtils.formatConnectionTarget(connWithLabel, nodeMap)).toBe('[If Approved] -> Target Step');

      const connNoLabel: Connection = { id: 'c2', from: 'source', to: 'target' };
      expect(storeTestUtils.formatConnectionTarget(connNoLabel, nodeMap)).toBe('-> Target Step');
    });

    it('normalizes connection labels cleanly', () => {
      expect(storeTestUtils.normalizeConnectionLabel('   Option A   ')).toBe('Option A');
      expect(storeTestUtils.normalizeConnectionLabel('Line 1\n  Line 2')).toBe('Line 1 Line 2');
      expect(storeTestUtils.normalizeConnectionLabel(null)).toBe('');
      expect(storeTestUtils.normalizeConnectionLabel(undefined)).toBe('');
    });

    it('normalizes node identity labels with fallbacks', () => {
      expect(storeTestUtils.normalizeNodeIdentityLabel('Custom Label', 'custom')).toBe('Custom Label');
      expect(storeTestUtils.normalizeNodeIdentityLabel('', 'core-persona')).toBe('core-persona');
      expect(storeTestUtils.normalizeNodeIdentityLabel(null, null)).toBe('N/A');
    });

    it('validates node types accurately', () => {
      expect(storeTestUtils.isNodeType('core-persona')).toBe(true);
      expect(storeTestUtils.isNodeType('logic-branch')).toBe(true);
      expect(storeTestUtils.isNodeType('custom')).toBe(true);
      expect(storeTestUtils.isNodeType('invalid-type')).toBe(false);
      expect(storeTestUtils.isNodeType('')).toBe(false);
    });

    it('provides helpful persistence hints based on error message', () => {
      expect(storeTestUtils.getPersistenceHint('Error: no authenticated session')).toContain('Sign in to your account');
      expect(storeTestUtils.getPersistenceHint('anonymous sign-ins are disabled')).toContain('Enable Anonymous auth');
      expect(storeTestUtils.getPersistenceHint('violates row-level security policy')).toContain('Check RLS policies');
      expect(storeTestUtils.getPersistenceHint('connections_from_node_id_fkey')).toContain('retries and queues writes');
      expect(storeTestUtils.getPersistenceHint('some unrelated error')).toBeNull();
    });
  });
});
