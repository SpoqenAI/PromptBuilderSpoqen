import { describe, expect, it } from 'vitest';
import {
  normalizeLineEndings,
  shortId,
  trimForPreview,
  esc,
} from './format';

describe('transcript import format helpers', () => {
  it('normalizes windows line endings', () => {
    expect(normalizeLineEndings('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('shortens long ids consistently', () => {
    expect(shortId('12345678')).toBe('12345678');
    expect(shortId('1234567890abcdef')).toBe('1234...cdef');
  });

  it('trims text previews at limit', () => {
    expect(trimForPreview('short', 10)).toBe('short');
    expect(trimForPreview('1234567890', 6)).toBe('12345...');
  });

  it('escapes html in non-dom context', () => {
    expect(esc('<script>"x"&\'y\'</script>')).toContain('&lt;script&gt;');
  });
});
