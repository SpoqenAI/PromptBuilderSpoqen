import { describe, expect, it } from 'vitest';
import type { TranscriptFlowResult } from '../../transcript-flow';
import {
  buildFlowRenderState,
  computeFlowLayout,
  defaultNodeSize,
  edgeGeometry,
} from './layout';

function flowFixture(): TranscriptFlowResult {
  return {
    title: 'Flow',
    summary: 'Summary',
    model: 'GPT-4o',
    usedFallback: false,
    warning: null,
    nodes: [
      { id: 'a', label: 'Start', type: 'custom', icon: 'play_arrow', content: 'a', meta: {} },
      { id: 'b', label: 'B', type: 'custom', icon: 'call', content: 'b', meta: {} },
      { id: 'c', label: 'C', type: 'custom', icon: 'check', content: 'c', meta: {} },
      { id: 'd', label: 'Detached', type: 'custom', icon: 'help', content: 'd', meta: {} },
    ],
    connections: [
      { from: 'a', to: 'b', reason: 'to b' },
      { from: 'a', to: 'c', reason: 'to c' },
    ],
  };
}

describe('transcript import layout', () => {
  it('assigns downstream nodes to later columns', () => {
    const flow = flowFixture();
    const renderState = buildFlowRenderState(flow, {});
    const layout = computeFlowLayout(flow, renderState.nodeSizes);
    expect(layout.b.x).toBeGreaterThan(layout.a.x);
    expect(layout.c.x).toBeGreaterThan(layout.a.x);
  });

  it('keeps disconnected nodes placed in layout', () => {
    const flow = flowFixture();
    const renderState = buildFlowRenderState(flow, {});
    expect(renderState.layout.d).toBeDefined();
    expect(renderState.geometry.width).toBeGreaterThan(0);
    expect(renderState.geometry.height).toBeGreaterThan(0);
  });

  it('applies manual position overrides', () => {
    const flow = flowFixture();
    const renderState = buildFlowRenderState(flow, { c: { x: 999, y: 111 } });
    expect(renderState.layout.c).toEqual({ x: 999, y: 111 });
  });

  it('computes bezier edge geometry from node centers', () => {
    const fromSize = defaultNodeSize();
    const toSize = defaultNodeSize();
    const geometry = edgeGeometry({ x: 10, y: 20 }, fromSize, { x: 300, y: 220 }, toSize);
    expect(geometry.fromX).toBe(10 + fromSize.width);
    expect(geometry.toX).toBe(300);
    expect(geometry.curve.startsWith('M ')).toBe(true);
  });
});
