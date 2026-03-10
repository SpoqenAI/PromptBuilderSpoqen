export interface FlowValidationIssue {
  code: 'cycle' | 'orphan' | 'dangling';
  nodeId: string;
  detail: string;
}

export interface FlowValidationResult {
  isValid: boolean;
  issues: FlowValidationIssue[];
}

interface MinimalNode {
  id: string;
  type: string;
  label?: string;
}

interface MinimalConnection {
  from: string;
  to: string;
}

const START_TYPES = new Set(['start', 'core-persona']);
const END_TYPES = new Set(['end', 'termination']);

/**
 * Validates a flow graph for structural issues: cycles, orphans (unreachable
 * from start), and dangling non-terminal nodes with no outgoing edges.
 */
export function validateFlowGraph(
  nodes: MinimalNode[],
  connections: MinimalConnection[],
): FlowValidationResult {
  if (nodes.length === 0) return { isValid: true, issues: [] };

  const issues: FlowValidationIssue[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const conn of connections) {
    if (!nodeIds.has(conn.from) || !nodeIds.has(conn.to)) continue;
    outgoing.get(conn.from)!.push(conn.to);
    incoming.get(conn.to)!.push(conn.from);
  }

  // --- Cycle detection via DFS coloring ---
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, WHITE);

  const cycleEdges = new Set<string>();

  function dfs(nodeId: string): void {
    color.set(nodeId, GRAY);
    for (const neighbor of outgoing.get(nodeId) ?? []) {
      const key = `${nodeId}->${neighbor}`;
      if (color.get(neighbor) === GRAY && !cycleEdges.has(key)) {
        cycleEdges.add(key);
        issues.push({
          code: 'cycle',
          nodeId: neighbor,
          detail: `Cycle detected: edge from "${nodeId}" back to "${neighbor}" creates a loop.`,
        });
      } else if (color.get(neighbor) === WHITE) {
        dfs(neighbor);
      }
    }
    color.set(nodeId, BLACK);
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) dfs(id);
  }

  // --- Reachability from start node ---
  const startNode = nodes.find((n) => START_TYPES.has(n.type)) ?? nodes[0];
  const reachable = new Set<string>();
  const stack = [startNode.id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const neighbor of outgoing.get(current) ?? []) {
      if (!reachable.has(neighbor)) stack.push(neighbor);
    }
  }

  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      issues.push({
        code: 'orphan',
        nodeId: node.id,
        detail: `Node "${node.label ?? node.id}" is not reachable from the start node.`,
      });
    }
  }

  // --- Dangling non-terminal nodes ---
  for (const node of nodes) {
    if (END_TYPES.has(node.type)) continue;
    const out = outgoing.get(node.id) ?? [];
    if (out.length === 0) {
      issues.push({
        code: 'dangling',
        nodeId: node.id,
        detail: `Node "${node.label ?? node.id}" is not a terminal node but has no outgoing connections.`,
      });
    }
  }

  return { isValid: issues.length === 0, issues };
}
