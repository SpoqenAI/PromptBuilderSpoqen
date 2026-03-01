import {
  cloneLayout,
  computeCanvasGeometry,
  defaultNodeSize,
  edgeGeometry,
} from './layout';
import type { LayoutMap, NodeSizeMap } from './types';

interface WireFlowViewportOptions {
  container: HTMLElement;
  latestRenderedLayout: LayoutMap;
  latestRenderedNodeSizes: NodeSizeMap;
  nodePositionOverrides: LayoutMap;
  savedViewport: {
    zoom: number | null;
    panX: number | null;
    panY: number | null;
  };
  suppressNextNodeClick: { value: boolean };
  onNodeDragCommitted: () => void;
}

export function wireFlowViewport(
  options: WireFlowViewportOptions,
): (() => void) | null {
  const viewport = options.container.querySelector<HTMLElement>('#flow-viewport');
  const world = options.container.querySelector<HTMLElement>('#flow-world');
  if (!viewport || !world) return null;
  const worldEl: HTMLElement = world;

  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 2.5;
  let zoom: number;
  let panX: number;
  let panY: number;
  const liveLayout = cloneLayout(options.latestRenderedLayout);

  if (
    options.savedViewport.zoom !== null
    && options.savedViewport.panX !== null
    && options.savedViewport.panY !== null
  ) {
    zoom = options.savedViewport.zoom;
    panX = options.savedViewport.panX;
    panY = options.savedViewport.panY;
  } else {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const ww = parseFloat(worldEl.style.width) || 760;
    const wh = parseFloat(worldEl.style.height) || 420;
    const fitScale = Math.min(vw / ww, vh / wh, 1);
    zoom = Math.max(MIN_ZOOM, Math.min(fitScale * 0.85, MAX_ZOOM));
    panX = Math.max(20, (vw - ww * zoom) / 2);
    panY = Math.max(40, (vh - wh * zoom) / 2);
  }

  function applyTransform(): void {
    worldEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    options.savedViewport.zoom = zoom;
    options.savedViewport.panX = panX;
    options.savedViewport.panY = panY;
  }
  applyTransform();

  const svg = worldEl.querySelector<SVGSVGElement>('#flow-connections-svg');

  const updateEdgeGeometry = (): void => {
    worldEl.querySelectorAll<SVGGElement>('[data-flow-edge]').forEach((edgeEl) => {
      const fromId = edgeEl.dataset.fromId ?? '';
      const toId = edgeEl.dataset.toId ?? '';
      const from = liveLayout[fromId];
      const to = liveLayout[toId];
      if (!from || !to) return;

      const fromSize = options.latestRenderedNodeSizes[fromId] ?? defaultNodeSize();
      const toSize = options.latestRenderedNodeSizes[toId] ?? defaultNodeSize();
      const geometry = edgeGeometry(from, fromSize, to, toSize);

      const pathEl = edgeEl.querySelector<SVGPathElement>('[data-flow-edge-path]');
      if (pathEl) pathEl.setAttribute('d', geometry.curve);

      const fromDot = edgeEl.querySelector<SVGCircleElement>('[data-flow-edge-from-dot]');
      if (fromDot) {
        fromDot.setAttribute('cx', String(geometry.fromX));
        fromDot.setAttribute('cy', String(geometry.fromY));
      }

      const toDot = edgeEl.querySelector<SVGCircleElement>('[data-flow-edge-to-dot]');
      if (toDot) {
        toDot.setAttribute('cx', String(geometry.toX));
        toDot.setAttribute('cy', String(geometry.toY));
      }

      const motion = edgeEl.querySelector<SVGAnimateMotionElement>('[data-flow-edge-motion]');
      if (motion) motion.setAttribute('path', geometry.curve);
    });
  };

  const updateWorldGeometry = (): void => {
    const geometry = computeCanvasGeometry(liveLayout, options.latestRenderedNodeSizes);
    worldEl.style.width = `${geometry.width}px`;
    worldEl.style.height = `${geometry.height}px`;
    if (svg) {
      svg.setAttribute('width', String(geometry.width));
      svg.setAttribute('height', String(geometry.height));
      svg.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
    }
  };

  let isPanning = false;
  let panStartMouseX = 0;
  let panStartMouseY = 0;
  let panStartX = 0;
  let panStartY = 0;
  let isDraggingNode = false;
  let activeDragNodeId: string | null = null;
  let activeDragNodeEl: HTMLElement | null = null;
  let dragStartMouseX = 0;
  let dragStartMouseY = 0;
  let dragStartNodeX = 0;
  let dragStartNodeY = 0;
  let dragMoved = false;

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  const onViewportMouseDown = (event: MouseEvent): void => {
    if (event.button !== 2) return;
    if (isDraggingNode) return;
    isPanning = true;
    panStartMouseX = event.clientX;
    panStartMouseY = event.clientY;
    panStartX = panX;
    panStartY = panY;
    viewport.classList.add('cursor-grabbing');
    event.preventDefault();
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (isDraggingNode && activeDragNodeId && activeDragNodeEl) {
      const deltaX = (event.clientX - dragStartMouseX) / zoom;
      const deltaY = (event.clientY - dragStartMouseY) / zoom;
      const nextX = Math.round((dragStartNodeX + deltaX) / 20) * 20;
      const nextY = Math.round((dragStartNodeY + deltaY) / 20) * 20;

      if (
        Math.abs(nextX - dragStartNodeX) > 1
        || Math.abs(nextY - dragStartNodeY) > 1
      ) {
        dragMoved = true;
      }

      liveLayout[activeDragNodeId] = { x: nextX, y: nextY };
      options.nodePositionOverrides[activeDragNodeId] = { x: nextX, y: nextY };
      activeDragNodeEl.style.left = `${nextX}px`;
      activeDragNodeEl.style.top = `${nextY}px`;
      updateWorldGeometry();
      updateEdgeGeometry();
      return;
    }

    if (!isPanning) return;
    panX = panStartX + (event.clientX - panStartMouseX);
    panY = panStartY + (event.clientY - panStartMouseY);
    applyTransform();
  };

  const onMouseUp = (): void => {
    if (isDraggingNode) {
      isDraggingNode = false;
      if (dragMoved) {
        options.suppressNextNodeClick.value = true;
        setTimeout(() => {
          options.suppressNextNodeClick.value = false;
        }, 0);
        options.onNodeDragCommitted();
      }
      viewport.classList.remove('cursor-grabbing');
      activeDragNodeId = null;
      activeDragNodeEl = null;
      return;
    }

    if (!isPanning) return;
    isPanning = false;
    viewport.classList.remove('cursor-grabbing');
  };

  const nodeDragCleanup: Array<() => void> = [];
  options.container
    .querySelectorAll<HTMLElement>('[data-flow-node-id]')
    .forEach((nodeEl) => {
      const handle = nodeEl.querySelector<HTMLElement>('.node-header') ?? nodeEl;
      const onNodeMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest('button,input,select,textarea,a')) return;
        const nodeId = nodeEl.dataset.flowNodeId;
        if (!nodeId) return;

        const startPosition = liveLayout[nodeId] ?? options.latestRenderedLayout[nodeId];
        if (!startPosition) return;

        isDraggingNode = true;
        activeDragNodeId = nodeId;
        activeDragNodeEl = nodeEl;
        dragStartMouseX = event.clientX;
        dragStartMouseY = event.clientY;
        dragStartNodeX = startPosition.x;
        dragStartNodeY = startPosition.y;
        dragMoved = false;
        viewport.classList.add('cursor-grabbing');
        event.preventDefault();
        event.stopPropagation();
      };

      handle.addEventListener('mousedown', onNodeMouseDown);
      nodeDragCleanup.push(() => {
        handle.removeEventListener('mousedown', onNodeMouseDown);
      });
    });

  viewport.addEventListener('contextmenu', onContextMenu);
  viewport.addEventListener('mousedown', onViewportMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const focalX = event.clientX - rect.left;
    const focalY = event.clientY - rect.top;
    const delta =
      event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * window.innerHeight
          : event.deltaY;
    const sensitivity = event.ctrlKey ? 0.0025 : 0.0012;
    const next = Math.max(
      MIN_ZOOM,
      Math.min(zoom * Math.exp(-delta * sensitivity), MAX_ZOOM),
    );
    if (next === zoom) return;
    const wx = (focalX - panX) / zoom;
    const wy = (focalY - panY) / zoom;
    panX = focalX - wx * next;
    panY = focalY - wy * next;
    zoom = next;
    applyTransform();
  };
  viewport.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    viewport.removeEventListener('contextmenu', onContextMenu);
    viewport.removeEventListener('mousedown', onViewportMouseDown);
    viewport.removeEventListener('wheel', onWheel);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    nodeDragCleanup.forEach((cleanup) => cleanup());
  };
}
