/**
 * Top-down hierarchical layout engine for flowchart diagrams.
 *
 * Places the start node at top-center, flows downward through process and
 * decision nodes, and positions end nodes at the bottom. Decision branches
 * spread horizontally.
 */

import type {
  TranscriptFlowNode,
  TranscriptFlowResult,
} from '../../transcript-flow';
import type {
  FlowRenderState,
  LayoutMap,
  LayoutPosition,
  NodeSizeMap,
  NodeVisualSize,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_SIZES: Record<string, NodeVisualSize> = {
  start:    { width: 160, height: 70 },
  end:      { width: 160, height: 70 },
  process:  { width: 200, height: 70 },
  decision: { width: 160, height: 100 },
};

const X_GAP = 120;
const Y_GAP = 120;
const CANVAS_PADDING = 140;
const MIN_CANVAS_WIDTH = 960;
const MIN_CANVAS_HEIGHT = 500;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildFlowRenderState(
  flow: TranscriptFlowResult,
  overrides: LayoutMap,
): FlowRenderState {
  const nodeSizes = computeNodeSizes(flow);
  const autoLayout = computeHierarchicalLayout(flow, nodeSizes);
  const layout = cloneLayout(autoLayout);

  for (const node of flow.nodes) {
    const override = overrides[node.id];
    if (!override) continue;
    layout[node.id] = { x: override.x, y: override.y };
  }

  return {
    layout,
    nodeSizes,
    geometry: computeCanvasGeometry(layout, nodeSizes),
  };
}

export function cloneLayout(layout: LayoutMap): LayoutMap {
  const cloned: LayoutMap = {};
  for (const [nodeId, position] of Object.entries(layout)) {
    cloned[nodeId] = { x: position.x, y: position.y };
  }
  return cloned;
}

export function defaultNodeSize(): NodeVisualSize {
  return NODE_SIZES.process;
}

export function nodeSize(type: string): NodeVisualSize {
  return NODE_SIZES[type] ?? NODE_SIZES.process;
}

// ---------------------------------------------------------------------------
// Edge Geometry
// ---------------------------------------------------------------------------

export function edgeGeometry(
  from: LayoutPosition,
  fromSize: NodeVisualSize,
  to: LayoutPosition,
  toSize: NodeVisualSize,
): { fromX: number; fromY: number; toX: number; toY: number; curve: string } {
  // Flow is top-down: edges exit from bottom-center and enter top-center
  const fromX = from.x + fromSize.width / 2;
  const fromY = from.y + fromSize.height;
  const toX = to.x + toSize.width / 2;
  const toY = to.y;

  // Vertical bezier curve
  const dy = Math.abs(toY - fromY) * 0.4;
  return {
    fromX,
    fromY,
    toX,
    toY,
    curve: `M ${fromX} ${fromY} C ${fromX} ${fromY + dy}, ${toX} ${toY - dy}, ${toX} ${toY}`,
  };
}

// ---------------------------------------------------------------------------
// Layout Computation
// ---------------------------------------------------------------------------

function computeNodeSizes(flow: TranscriptFlowResult): NodeSizeMap {
  const sizes: NodeSizeMap = {};
  for (const node of flow.nodes) {
    sizes[node.id] = nodeSize(node.type);
  }
  return sizes;
}

function computeHierarchicalLayout(
  flow: TranscriptFlowResult,
  nodeSizes: NodeSizeMap,
): LayoutMap {
  if (flow.nodes.length === 0) return {};

  // Build adjacency
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const nodeMap = new Map(flow.nodes.map((node) => [node.id, node]));
  for (const node of flow.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
    incomingCount.set(node.id, 0);
  }
  for (const conn of flow.connections) {
    if (!outgoing.has(conn.from) || !incomingCount.has(conn.to)) continue;
    outgoing.get(conn.from)!.push(conn.to);
    incoming.get(conn.to)!.push(conn.from);
    incomingCount.set(conn.to, (incomingCount.get(conn.to) ?? 0) + 1);
  }

  // BFS level assignment (top-down)
  const levelByNode = new Map<string, number>();

  // Find start node or use nodes with no incoming edges
  const startNode = flow.nodes.find((n) => n.type === 'start');
  const roots = startNode
    ? [startNode.id]
    : flow.nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0).map((n) => n.id);

  if (roots.length === 0 && flow.nodes.length > 0) {
    roots.push(flow.nodes[0].id);
  }

  const queue: string[] = [...roots];
  for (const root of roots) {
    levelByNode.set(root, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levelByNode.get(current) ?? 0;
    for (const target of outgoing.get(current) ?? []) {
      const existingLevel = levelByNode.get(target);
      if (existingLevel === undefined || existingLevel < currentLevel + 1) {
        levelByNode.set(target, currentLevel + 1);
        queue.push(target);
      }
    }
  }

  // Assign any unvisited nodes to the last level
  const maxLevel = levelByNode.size > 0 ? Math.max(...levelByNode.values()) : 0;
  for (const node of flow.nodes) {
    if (!levelByNode.has(node.id)) {
      levelByNode.set(node.id, maxLevel);
    }
  }

  // Group by level
  const groups = new Map<number, TranscriptFlowNode[]>();
  for (const node of flow.nodes) {
    const level = levelByNode.get(node.id) ?? 0;
    const group = groups.get(level) ?? [];
    group.push(node);
    groups.set(level, group);
  }

  const levels = Array.from(groups.keys()).sort((a, b) => a - b);
  const layout: LayoutMap = {};
  const orderScore = computeOrderScores({
    levels,
    groups,
    incoming,
    outgoing,
    nodeMap,
  });
  const rowWidths = new Map<number, number>();
  const sortedNodesByLevel = new Map<number, TranscriptFlowNode[]>();

  for (const level of levels) {
    const nodesAtLevel = [...(groups.get(level) ?? [])].sort((a, b) => {
      const scoreDelta = (orderScore.get(a.id) ?? 0) - (orderScore.get(b.id) ?? 0);
      if (Math.abs(scoreDelta) > 0.001) {
        return scoreDelta;
      }
      return a.label.localeCompare(b.label);
    });
    sortedNodesByLevel.set(level, nodesAtLevel);
    const rowWidth = nodesAtLevel.reduce((sum, node, index) => {
      const size = nodeSizes[node.id] ?? defaultNodeSize();
      return sum + size.width + (index > 0 ? X_GAP : 0);
    }, 0);
    rowWidths.set(level, rowWidth);
  }

  const contentWidth = Math.max(
    MIN_CANVAS_WIDTH - 2 * CANVAS_PADDING,
    ...Array.from(rowWidths.values()),
  );

  let currentY = CANVAS_PADDING;

  for (const level of levels) {
    const nodesAtLevel = sortedNodesByLevel.get(level) ?? [];
    const levelHeight = Math.max(
      ...nodesAtLevel.map((n) => (nodeSizes[n.id] ?? defaultNodeSize()).height),
    );
    const levelWidth = rowWidths.get(level) ?? 0;
    let currentX = CANVAS_PADDING + Math.max(0, (contentWidth - levelWidth) / 2);

    for (const node of nodesAtLevel) {
      const size = nodeSizes[node.id] ?? defaultNodeSize();
      layout[node.id] = {
        x: currentX,
        y: currentY + (levelHeight - size.height) / 2,
      };
      currentX += size.width + X_GAP;
    }

    currentY += levelHeight + Y_GAP;
  }

  return layout;
}

function computeOrderScores(args: {
  levels: number[];
  groups: Map<number, TranscriptFlowNode[]>;
  incoming: Map<string, string[]>;
  outgoing: Map<string, string[]>;
  nodeMap: Map<string, TranscriptFlowNode>;
}): Map<string, number> {
  const scores = new Map<string, number>();

  for (const level of args.levels) {
    const nodesAtLevel = args.groups.get(level) ?? [];
    if (level === 0) {
      nodesAtLevel.forEach((node, index) => scores.set(node.id, index * 10));
      continue;
    }

    for (const node of nodesAtLevel) {
      const parents = (args.incoming.get(node.id) ?? [])
        .map((parentId) => args.nodeMap.get(parentId))
        .filter((parent): parent is TranscriptFlowNode => Boolean(parent));

      if (parents.length === 0) {
        scores.set(node.id, (scores.size + 1) * 10);
        continue;
      }

      let total = 0;
      let count = 0;
      for (const parent of parents) {
        const siblings = (args.outgoing.get(parent.id) ?? [])
          .map((siblingId) => args.nodeMap.get(siblingId))
          .filter((sibling): sibling is TranscriptFlowNode => Boolean(sibling));
        const siblingIndex = Math.max(0, siblings.findIndex((sibling) => sibling.id === node.id));
        const centeredIndex = siblingIndex - (siblings.length - 1) / 2;
        const siblingSpread = parent.type === 'decision' ? 8 : 4;
        total += (scores.get(parent.id) ?? 0) + centeredIndex * siblingSpread;
        count += 1;
      }

      scores.set(node.id, count > 0 ? total / count : (scores.size + 1) * 10);
    }
  }

  return scores;
}

function computeCanvasGeometry(
  layout: LayoutMap,
  nodeSizes: NodeSizeMap,
): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;

  for (const [nodeId, position] of Object.entries(layout)) {
    const size = nodeSizes[nodeId] ?? defaultNodeSize();
    maxX = Math.max(maxX, position.x + size.width);
    maxY = Math.max(maxY, position.y + size.height);
  }

  return {
    width: Math.max(maxX + CANVAS_PADDING, MIN_CANVAS_WIDTH),
    height: Math.max(maxY + CANVAS_PADDING, MIN_CANVAS_HEIGHT),
  };
}

export function computeCanvasGeometryPublic(
  layout: LayoutMap,
  nodeSizes: NodeSizeMap,
  _connections?: ReadonlyArray<{ from: string; to: string }>,
): { width: number; height: number } {
  return computeCanvasGeometry(layout, nodeSizes);
}
