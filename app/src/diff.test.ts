import { describe, expect, it } from 'vitest';
import { computeDiff, toSideBySideHTML, toUnifiedHTML } from './diff';

describe('Myers diff engine', () => {
  it('handles empty inputs', () => {
    expect(computeDiff('', '')).toEqual([]);
  });

  it('handles addition from empty old text', () => {
    const diff = computeDiff('', 'hello\nworld');
    expect(diff).toEqual([
      { type: 'add', line: 'hello' },
      { type: 'add', line: 'world' },
    ]);
  });

  it('handles deletion to empty new text', () => {
    const diff = computeDiff('hello\nworld', '');
    expect(diff).toEqual([
      { type: 'remove', line: 'hello' },
      { type: 'remove', line: 'world' },
    ]);
  });

  it('detects completely equal texts', () => {
    const text = 'line 1\nline 2\nline 3';
    const diff = computeDiff(text, text);
    expect(diff.every((d) => d.type === 'equal')).toBe(true);
    expect(diff.map((d) => d.line)).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('accurately identifies edits in the middle of text', () => {
    const oldText = 'alpha\nbeta\ngamma';
    const newText = 'alpha\nbeta modified\ngamma';
    const diff = computeDiff(oldText, newText);

    expect(diff).toEqual([
      { type: 'equal', line: 'alpha' },
      { type: 'remove', line: 'beta' },
      { type: 'add', line: 'beta modified' },
      { type: 'equal', line: 'gamma' },
    ]);
  });

  it('generates side-by-side HTML panels and correct statistics', () => {
    const oldText = 'keep\nold line';
    const newText = 'keep\nnew line';
    const diff = computeDiff(oldText, newText);
    const { leftHTML, rightHTML, stats } = toSideBySideHTML(diff);

    expect(stats.unchanged).toBe(1);
    expect(stats.removed).toBe(1);
    expect(stats.added).toBe(1);
    expect(leftHTML).toContain('old line');
    expect(rightHTML).toContain('new line');
  });

  it('generates unified diff HTML with correct line indicators', () => {
    const diff = computeDiff('alpha', 'beta');
    const unified = toUnifiedHTML(diff);

    expect(unified).toContain('diff-remove');
    expect(unified).toContain('diff-add');
    expect(unified).toContain('-</span>');
    expect(unified).toContain('+</span>');
  });
});
