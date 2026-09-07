import { describe, expect, it } from 'vitest';
import { enforceSingleStartAndEndNodes, type TranscriptFlowNode, type TranscriptFlowConnection } from './transcript-flow';

describe('enforceSingleStartAndEndNodes', () => {
  it('merges multiple start nodes into exactly one start node and rewires connections', () => {
    const nodes: TranscriptFlowNode[] = [
      { id: 'start_1', label: 'Start A', type: 'start' },
      { id: 'start_2', label: 'Start B', type: 'start' },
      { id: 'p1', label: 'Process Greeting', type: 'process' },
      { id: 'end_1', label: 'End Call', type: 'end' },
    ];
    const connections: TranscriptFlowConnection[] = [
      { from: 'start_1', to: 'p1', label: 'Path 1' },
      { from: 'start_2', to: 'p1', label: 'Path 2' },
      { from: 'p1', to: 'end_1', label: 'Complete' },
    ];

    const result = enforceSingleStartAndEndNodes(nodes, connections);

    const startNodes = result.nodes.filter((n) => n.type === 'start');
    const endNodes = result.nodes.filter((n) => n.type === 'end');

    expect(startNodes.length).toBe(1);
    expect(endNodes.length).toBe(1);
    expect(startNodes[0].id).toBe('start_1');

    // Connections from start_2 should be rewired to start_1
    const startConnections = result.connections.filter((c) => c.from === 'start_1');
    expect(startConnections.length).toBeGreaterThanOrEqual(1);
    expect(result.connections.some((c) => c.from === 'start_2')).toBe(false);
  });

  it('merges multiple end nodes into exactly one end node and rewires incoming connections', () => {
    const nodes: TranscriptFlowNode[] = [
      { id: 'start_1', label: 'Start Call', type: 'start' },
      { id: 'd1', label: 'Check Inquiry Type', type: 'decision' },
      { id: 'end_1', label: 'Resolution A', type: 'end' },
      { id: 'end_2', label: 'Resolution B', type: 'end' },
      { id: 'end_3', label: 'Escalation Exit', type: 'end' },
    ];
    const connections: TranscriptFlowConnection[] = [
      { from: 'start_1', to: 'd1', label: '' },
      { from: 'd1', to: 'end_1', label: 'Billing' },
      { from: 'd1', to: 'end_2', label: 'Support' },
      { from: 'd1', to: 'end_3', label: 'Escalate' },
    ];

    const result = enforceSingleStartAndEndNodes(nodes, connections);

    const startNodes = result.nodes.filter((n) => n.type === 'start');
    const endNodes = result.nodes.filter((n) => n.type === 'end');

    expect(startNodes.length).toBe(1);
    expect(endNodes.length).toBe(1);
    expect(endNodes[0].id).toBe('end_1');

    // All decision branches should now point to end_1
    const branchesToEnd = result.connections.filter((c) => c.to === 'end_1');
    expect(branchesToEnd.length).toBe(3);
    expect(result.connections.some((c) => c.to === 'end_2' || c.to === 'end_3')).toBe(false);
  });

  it('creates a start node when missing and connects to the root process', () => {
    const nodes: TranscriptFlowNode[] = [
      { id: 'p1', label: 'Greeting & Verification', type: 'process' },
      { id: 'end_1', label: 'End Call', type: 'end' },
    ];
    const connections: TranscriptFlowConnection[] = [
      { from: 'p1', to: 'end_1', label: '' },
    ];

    const result = enforceSingleStartAndEndNodes(nodes, connections);

    const startNodes = result.nodes.filter((n) => n.type === 'start');
    expect(startNodes.length).toBe(1);
    expect(result.connections.some((c) => c.from === startNodes[0].id && c.to === 'p1')).toBe(true);
  });

  it('creates an end node when missing and connects dangling leaf nodes', () => {
    const nodes: TranscriptFlowNode[] = [
      { id: 'start_1', label: 'Start Call', type: 'start' },
      { id: 'p1', label: 'Take Message', type: 'process' },
      { id: 'p2', label: 'Provide Answer', type: 'process' },
    ];
    const connections: TranscriptFlowConnection[] = [
      { from: 'start_1', to: 'p1', label: 'Voicemail' },
      { from: 'start_1', to: 'p2', label: 'Direct Q' },
    ];

    const result = enforceSingleStartAndEndNodes(nodes, connections);

    const endNodes = result.nodes.filter((n) => n.type === 'end');
    expect(endNodes.length).toBe(1);

    const singleEnd = endNodes[0];
    // Both dangling processes should connect to the new single end node
    expect(result.connections.some((c) => c.from === 'p1' && c.to === singleEnd.id)).toBe(true);
    expect(result.connections.some((c) => c.from === 'p2' && c.to === singleEnd.id)).toBe(true);
  });

  it('preserves clean single-start and single-end topologies', () => {
    const nodes: TranscriptFlowNode[] = [
      { id: 'start_1', label: 'Start', type: 'start' },
      { id: 'p1', label: 'Process', type: 'process' },
      { id: 'end_1', label: 'End', type: 'end' },
    ];
    const connections: TranscriptFlowConnection[] = [
      { from: 'start_1', to: 'p1', label: '' },
      { from: 'p1', to: 'end_1', label: '' },
    ];

    const result = enforceSingleStartAndEndNodes(nodes, connections);

    expect(result.nodes.filter((n) => n.type === 'start').length).toBe(1);
    expect(result.nodes.filter((n) => n.type === 'end').length).toBe(1);
    expect(result.connections.length).toBe(2);
  });
});

