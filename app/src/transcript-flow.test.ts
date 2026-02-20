import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
    },
  },
}));

type TestUtils = {
  normalizeMaxNodes: (value: number | undefined) => number | undefined;
  normalizeNodeType: (value: unknown) => string;
  toTranscriptConnections: (
    rawConnections: unknown,
    validNodeIds: ReadonlySet<string>,
  ) => Array<{ from: string; to: string; reason: string }>;
};

let utils: TestUtils;

beforeAll(async () => {
  const mod = await import('./transcript-flow');
  utils = mod.transcriptFlowTestUtils as unknown as TestUtils;
});

describe('transcript flow normalization', () => {
  it('normalizes max node values to allowed bounds', () => {
    expect(utils.normalizeMaxNodes(undefined)).toBeUndefined();
    expect(utils.normalizeMaxNodes(Number.NaN)).toBe(18);
    expect(utils.normalizeMaxNodes(2)).toBe(6);
    expect(utils.normalizeMaxNodes(90)).toBe(40);
    expect(utils.normalizeMaxNodes(19.8)).toBe(19);
  });

  it('maps known node type aliases', () => {
    expect(utils.normalizeNodeType('decision')).toBe('logic-branch');
    expect(utils.normalizeNodeType('assistant')).toBe('llm-brain');
    expect(utils.normalizeNodeType('user')).toBe('transcriber');
    expect(utils.normalizeNodeType('end')).toBe('termination');
    expect(utils.normalizeNodeType('unknown')).toBe('custom');
  });

  it('keeps only valid, unique transcript connections', () => {
    const validIds = new Set(['n1', 'n2', 'n3']);
    const raw = [
      { from: 'n1', to: 'n2', reason: 'handoff' },
      { from: 'n1', to: 'n2', reason: 'duplicate should drop' },
      { from: 'n2', to: 'n2', reason: 'self loop drop' },
      { from: 'n2', to: 'missing', reason: 'unknown target drop' },
      { from: 'n2', to: 'n3', reason: 42 },
      { from: '', to: 'n3', reason: 'empty from drop' },
    ];

    expect(utils.toTranscriptConnections(raw, validIds)).toEqual([
      { from: 'n1', to: 'n2', reason: 'handoff' },
      { from: 'n2', to: 'n3', reason: '' },
    ]);
  });
});
