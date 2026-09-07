import type { CanvasViewportState, CanvasViewContainer } from './types';

const canvasViewportByProject = new Map<string, CanvasViewportState>();
const canvasSidebarCollapsedByProject = new Map<string, boolean>();
const canvasSidebarWidthByProject = new Map<string, number>();

export function clearCanvasViewCleanup(container: HTMLElement): void {
  const host = container as CanvasViewContainer;
  if (!host.__pbCanvasCleanup) return;
  host.__pbCanvasCleanup();
  delete host.__pbCanvasCleanup;
}

export function readCanvasViewportState(projectId: string): CanvasViewportState | null {
  const state = canvasViewportByProject.get(projectId);
  if (!state) return null;
  return { ...state };
}

export function writeCanvasViewportState(projectId: string, state: CanvasViewportState): void {
  canvasViewportByProject.set(projectId, { ...state });
}

export function readCanvasSidebarCollapsedState(projectId: string): boolean {
  return canvasSidebarCollapsedByProject.get(projectId) ?? false;
}

export function writeCanvasSidebarCollapsedState(projectId: string, collapsed: boolean): void {
  canvasSidebarCollapsedByProject.set(projectId, collapsed);
}

export function readCanvasSidebarWidthState(projectId: string): number | null {
  const width = canvasSidebarWidthByProject.get(projectId);
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null;
  return width;
}

export function writeCanvasSidebarWidthState(projectId: string, width: number): void {
  if (!Number.isFinite(width) || width <= 0) return;
  canvasSidebarWidthByProject.set(projectId, width);
}
