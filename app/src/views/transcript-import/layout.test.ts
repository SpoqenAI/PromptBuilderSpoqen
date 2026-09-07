import { describe, expect, it } from 'vitest';
import {
  buildFlowRenderState,
  cloneLayout,
  defaultNodeSize,
  edgeGeometry,
  nodeSize,
} from './layout';
import type { TranscriptFlowResult } from '../../transcript-flow';

describe('transcript layout engine', () => {
  const sampleFlow: TranscriptFlowResult = {
    summary: 'Test diagram',
    nodes: [
      { id: 'start-1', type: 'start', label: 'Call Started', description: '' },
      { id: 'proc-1', type: 'process', label: 'Verify Identity', description: '' },
      { id: 'dec-1', type: 'decision', label: 'Verified?', description: '' },
      { id: 'end-1', type: 'end', label: 'Call Ended', description: '' },
    ],
    connections: [
      { id: 'c1', from: 'start-1', to: 'proc-1' },
      { id: 'c2', from: 'proc-1', to: 'dec-1' },
      { id: 'c3', from: 'dec-1', to: 'end-1', label: 'Yes' },
    ],
  };

  it('computes hierarchical layout with top-down flow', () => {
    const state = buildFlowRenderState(sampleFlow, {});
    expect(state.layout['start-1']).toBeDefined();
    expect(state.layout['proc-1']).toBeDefined();
    expect(state.layout['dec-1']).toBeDefined();
    expect(state.layout['end-1']).toBeDefined();

    // In top-down layout, start node y < process y < decision y < end y
    expect(state.layout['start-1'].y).toBeLessThan(state.layout['proc-1'].y);
    expect(state.layout['proc-1'].y).toBeLessThan(state.layout['dec-1'].y);
    expect(state.layout['dec-1'].y).toBeLessThan(state.layout['end-1'].y);

    expect(state.geometry.width).toBeGreaterThanOrEqual(960);
    expect(state.geometry.height).toBeGreaterThanOrEqual(500);
  });

  it('respects manual position overrides', () => {
    const overrides = {
      'proc-1': { x: 555, y: 777 },
    };
    const state = buildFlowRenderState(sampleFlow, overrides);
    expect(state.layout['proc-1']).toEqual({ x: 555, y: 777 });
  });

  it('clones layout independently', () => {
    const original = {
      nodeA: { x: 10, y: 20 },
    };
    const cloned = cloneLayout(original);
    expect(cloned).toEqual(original);
    cloned.nodeA.x = 999;
    expect(original.nodeA.x).toBe(10);
  });

  it('returns expected node dimensions by type', () => {
    expect(nodeSize('start')).toEqual({ width: 160, height: 70 });
    expect(nodeSize('end')).toEqual({ width: 160, height: 70 });
    expect(nodeSize('process')).toEqual({ width: 200, height: 70 });
    expect(nodeSize('decision')).toEqual({ width: 160, height: 100 });
    expect(defaultNodeSize()).toEqual({ width: 200, height: 70 });
  });

  it('computes edge bezier geometry from bottom to top', () => {
    const from = { x: 100, y: 100 };
    const fromSize = { width: 160, height: 70 };
    const to = { x: 100, y: 300 };
    const toSize = { width: 160, height: 70 };

    const edge = edgeGeometry(from, fromSize, to, toSize);
    expect(edge.fromX).toBe(180);
    expect(edge.fromY).toBe(170);
    expect(edge.toX).toBe(180);
    expect(edge.toY).toBe(300);
    expect(edge.curve).toContain('M 180 170 C');
  });
});


