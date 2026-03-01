import { describe, expect, it } from 'vitest';
import {
  GENERATING_THOUGHT_POOL,
  GENERATING_THOUGHTS_VISIBLE,
} from './constants';
import { buildGeneratingThoughtSequence } from './generating-thoughts';

describe('transcript import generating thoughts', () => {
  it('returns at most the visible thought count', () => {
    const thoughts = buildGeneratingThoughtSequence(() => 0.5);
    expect(thoughts.length).toBeLessThanOrEqual(GENERATING_THOUGHTS_VISIBLE);
  });

  it('returns only values from the source pool', () => {
    const thoughts = buildGeneratingThoughtSequence(() => 0.25);
    expect(
      thoughts.every((thought) => (GENERATING_THOUGHT_POOL as readonly string[]).includes(thought)),
    ).toBe(true);
  });
});
