import {
  GENERATING_THOUGHT_POOL,
  GENERATING_THOUGHTS_VISIBLE,
} from './constants';

export function buildGeneratingThoughtSequence(
  random: () => number = Math.random,
): string[] {
  const pool = [...GENERATING_THOUGHT_POOL];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, Math.min(GENERATING_THOUGHTS_VISIBLE, pool.length));
}
