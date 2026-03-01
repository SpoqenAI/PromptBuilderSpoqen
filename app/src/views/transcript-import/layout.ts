import type {
  TranscriptFlowNode,
  TranscriptFlowResult,
} from '../../transcript-flow';
import {
  TRANSCRIPT_NODE_DECORATION_WIDTH,
  TRANSCRIPT_NODE_HEIGHT,
  TRANSCRIPT_NODE_MIN_WIDTH,
  TRANSCRIPT_NODE_X_GAP,
  TRANSCRIPT_NODE_Y_GAP,
} from './constants';
import { shortId } from './format';
import type {
  FlowRenderState,
  LayoutMap,
  LayoutPosition,
  NodeSizeMap,
  NodeVisualSize,
} from './types';

const nodeLabelMeasureCanvas =
  typeof document !== 'undefined' ? document.createElement('canvas') : null;
const nodeLabelMeasureContext = nodeLabelMeasureCanvas?.getContext('2d') ?? null;

export function buildFlowRenderState(
  flow: TranscriptFlowResult,
  overrides: LayoutMap,
): FlowRenderState {
  const nodeSizes = computeNodeVisualSizes(flow);
  const autoLayout = computeFlowLayout(flow, nodeSizes);
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
  return {
    width: TRANSCRIPT_NODE_MIN_WIDTH,
    height: TRANSCRIPT_NODE_HEIGHT,
  };
}

export function computeNodeVisualSizes(flow: TranscriptFlowResult): NodeSizeMap {
  const sizes: NodeSizeMap = {};
  for (const node of flow.nodes) {
    const label =
      node.label.trim().length > 0 ? node.label.trim() : `Step ${shortId(node.id)}`;
    sizes[node.id] = {
      width: Math.max(
        TRANSCRIPT_NODE_MIN_WIDTH,
        estimateTranscriptNodeLabelWidth(label) + TRANSCRIPT_NODE_DECORATION_WIDTH,
      ),
      height: TRANSCRIPT_NODE_HEIGHT,
    };
  }
  return sizes;
}

export function estimateTranscriptNodeLabelWidth(label: string): number {
  const text = label.trim().length > 0 ? label.trim() : 'Node';
  if (!nodeLabelMeasureContext) return text.length * 7;
  nodeLabelMeasureContext.font = '700 12px system-ui, -apple-system, sans-serif';
  return Math.ceil(nodeLabelMeasureContext.measureText(text).width);
}

export function computeCanvasGeometry(
  layout: LayoutMap,
  nodeSizes: NodeSizeMap,
): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;

  for (const [nodeId, position] of Object.entries(layout)) {
    const nodeSize = nodeSizes[nodeId] ?? defaultNodeSize();
    maxX = Math.max(maxX, position.x + nodeSize.width);
    maxY = Math.max(maxY, position.y + nodeSize.height);
  }

  return {
    width: Math.max(maxX + 120, 760),
    height: Math.max(maxY + 120, 420),
  };
}

export function computeFlowLayout(
  flow: TranscriptFlowResult,
  nodeSizes: NodeSizeMap,
): LayoutMap {
  const levelByNode = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const incomingCounts = new Map<string, number>();

  for (const node of flow.nodes) {
    incomingCounts.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const connection of flow.connections) {
    if (!incomingCounts.has(connection.to) || !outgoing.has(connection.from)) continue;
    outgoing.get(connection.from)?.push(connection.to);
    incomingCounts.set(connection.to, (incomingCounts.get(connection.to) ?? 0) + 1);
  }

  const sourceIds = flow.nodes
    .filter((node) => (incomingCounts.get(node.id) ?? 0) === 0)
    .map((node) => node.id);

  const queue =
    sourceIds.length > 0
      ? [...sourceIds]
      : [flow.nodes[0]?.id].filter((id): id is string => Boolean(id));
  for (const sourceId of queue) {
    levelByNode.set(sourceId, 0);
  }

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;

    const currentLevel = levelByNode.get(currentId) ?? 0;
    const targets = outgoing.get(currentId) ?? [];
    for (const targetId of targets) {
      if (!levelByNode.has(targetId)) {
        levelByNode.set(targetId, currentLevel + 1);
        queue.push(targetId);
      }
    }
  }

  const fallbackLevel = levelByNode.size > 0 ? Math.max(...levelByNode.values()) : 0;

  flow.nodes.forEach((node) => {
    if (!levelByNode.has(node.id)) {
      levelByNode.set(node.id, fallbackLevel);
    }
  });

  const groups = new Map<number, TranscriptFlowNode[]>();
  for (const node of flow.nodes) {
    const level = levelByNode.get(node.id) ?? 0;
    const group = groups.get(level) ?? [];
    group.push(node);
    groups.set(level, group);
  }

  const levels = Array.from(groups.keys()).sort((left, right) => left - right);
  const layout: LayoutMap = {};

  const startX = 60;
  const startY = 50;
  const ySpacing = TRANSCRIPT_NODE_Y_GAP;
  let currentX = startX;

  const maxNodesInAPillar = Math.max(
    ...levels.map((level) => (groups.get(level) ?? []).length),
  );
  const expectedMaxHeight = maxNodesInAPillar * ySpacing;
  const viewportCenterY = startY + expectedMaxHeight / 2;

  for (const level of levels) {
    const nodesAtLevel = groups.get(level) ?? [];
    const levelWidth = Math.max(
      TRANSCRIPT_NODE_MIN_WIDTH,
      ...nodesAtLevel.map((node) => (nodeSizes[node.id] ?? defaultNodeSize()).width),
    );

    const pillarHeight = Math.max(0, (nodesAtLevel.length - 1) * ySpacing);
    let currentY = viewportCenterY - pillarHeight / 2;

    nodesAtLevel.forEach((node) => {
      layout[node.id] = {
        x: currentX,
        y: currentY,
      };
      currentY += ySpacing;
    });

    currentX += levelWidth + TRANSCRIPT_NODE_X_GAP;
  }

  return layout;
}

export function edgeGeometry(
  from: LayoutPosition,
  fromSize: NodeVisualSize,
  to: LayoutPosition,
  toSize: NodeVisualSize,
): { fromX: number; fromY: number; toX: number; toY: number; curve: string } {
  const fromX = from.x + fromSize.width;
  const fromY = from.y + fromSize.height / 2;
  const toX = to.x;
  const toY = to.y + toSize.height / 2;
  const dx = Math.abs(toX - fromX) * 0.5;
  return {
    fromX,
    fromY,
    toX,
    toY,
    curve: `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`,
  };
}
