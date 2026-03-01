import { describe, expect, it } from 'vitest';
import { transcriptWorkspaceTestUtils } from './transcript-workspace';

describe('transcript workspace helpers', () => {
  it('normalizes transcript set names', () => {
    expect(transcriptWorkspaceTestUtils.buildTranscriptSetName('RV Support')).toBe('RV Support Transcript Set');
    expect(transcriptWorkspaceTestUtils.buildTranscriptSetName('')).toBe('Transcript Set');
  });

  it('strips transcript set suffix from display names', () => {
    expect(transcriptWorkspaceTestUtils.stripTranscriptSetSuffix('RV Support Transcript Set')).toBe('RV Support');
    expect(transcriptWorkspaceTestUtils.stripTranscriptSetSuffix('Dental Ops')).toBe('Dental Ops');
  });

  it('scopes canonical node ids by transcript set', () => {
    expect(transcriptWorkspaceTestUtils.buildScopedCanonicalNodeId('set-a', 'start')).toBe('set-a::start');
    expect(transcriptWorkspaceTestUtils.buildScopedCanonicalNodeId('set-b', 'start')).toBe('set-b::start');
  });

  it('reads and writes layout overrides in node metadata', () => {
    const merged = transcriptWorkspaceTestUtils.mergeNodeMetaWithLayout({ intent: 'booking' }, { x: 121, y: 305 });
    expect(merged.layoutX).toBe('121');
    expect(merged.layoutY).toBe('305');
    expect(transcriptWorkspaceTestUtils.readLayoutOverride(merged)).toEqual({ x: 121, y: 305 });
  });

  it('parses support metrics from metadata safely', () => {
    expect(transcriptWorkspaceTestUtils.parseNodeSupportCount({ callSupport: '14/20' })).toBe(14);
    expect(transcriptWorkspaceTestUtils.parseNodeSupportCount({ callSupport: 'n/a' })).toBe(0);
    expect(transcriptWorkspaceTestUtils.parseNodeConfidence({ callSupportPercent: '65%' })).toBe(0.65);
    expect(transcriptWorkspaceTestUtils.parseNodeConfidence({ callSupportPercent: 'foo' })).toBe(0);
  });

  it('coalesces duplicate edge pairs for canonical storage', () => {
    const rows = transcriptWorkspaceTestUtils.buildCanonicalEdgeRows({
      transcriptSetId: 'set-1',
      connections: [
        { from: 'n1', to: 'n2', reason: 'Yes', supportCount: 3, supportRate: 0.6 },
        { from: 'n1', to: 'n2', reason: 'No', supportCount: 1, supportRate: 0.2 },
        { from: 'n1', to: 'n2', reason: 'Next', supportCount: 2, supportRate: 0.5 },
        { from: 'n2', to: 'n3', reason: 'Proceed', supportCount: 4, supportRate: 0.7 },
      ],
      externalNodeIds: new Set(['n1', 'n2', 'n3']),
      storageIdByExternalId: new Map([
        ['n1', 'set-1::n1'],
        ['n2', 'set-1::n2'],
        ['n3', 'set-1::n3'],
      ]),
    });

    expect(rows).toEqual([
      {
        transcript_set_id: 'set-1',
        from_node_id: 'set-1::n1',
        to_node_id: 'set-1::n2',
        reason: 'Yes / No',
        support_count: 3,
        transition_rate: 0.6,
      },
      {
        transcript_set_id: 'set-1',
        from_node_id: 'set-1::n2',
        to_node_id: 'set-1::n3',
        reason: 'Proceed',
        support_count: 4,
        transition_rate: 0.7,
      },
    ]);
  });
});
